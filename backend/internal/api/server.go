// Package api exposes the HTTP API (/api/v1) consumed by the Next.js console.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/edermanoel94/aws-local-console/backend/internal/architecture"
	"github.com/edermanoel94/aws-local-console/backend/internal/audit"
	awsfloci "github.com/edermanoel94/aws-local-console/backend/internal/aws"
	"github.com/edermanoel94/aws-local-console/backend/internal/cli"
	"github.com/edermanoel94/aws-local-console/backend/internal/coverage"
	"github.com/edermanoel94/aws-local-console/backend/internal/environments"
	"github.com/edermanoel94/aws-local-console/backend/internal/operations"
	"github.com/edermanoel94/aws-local-console/backend/internal/resources"
	"github.com/edermanoel94/aws-local-console/backend/internal/services"
)

// Version is the API version reported by /health. Release builds set it with
// -ldflags "-X github.com/edermanoel94/aws-local-console/backend/internal/api.Version=<version>".
var Version = "dev"

// Dependencies are the components the HTTP layer uses.
type Dependencies struct {
	Config       environments.Config
	Factory      *awsfloci.Factory
	Registry     *services.Registry
	Catalog      *operations.Catalog
	Coverage     *coverage.Tracker
	Audit        *audit.Store
	Engine       *operations.Engine
	Discoverer   *resources.Discoverer
	Architecture *architecture.Builder
	CLI          *cli.Runner
	Floci        *awsfloci.FlociMonitor
	Logger       *slog.Logger
}

// Server holds the handlers.
type Server struct {
	Dependencies
}

// NewHandler returns the root HTTP handler with middleware applied.
func NewHandler(deps Dependencies) http.Handler {
	s := &Server{Dependencies: deps}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", s.health)
	mux.HandleFunc("GET /api/v1/floci/status", s.flociStatus)
	mux.HandleFunc("GET /api/v1/services", s.listServices)
	mux.HandleFunc("GET /api/v1/services/{service}", s.getService)
	mux.HandleFunc("GET /api/v1/services/{service}/operations", s.listOperations)
	mux.HandleFunc("GET /api/v1/services/{service}/operations/{operation}", s.getOperation)
	mux.HandleFunc("POST /api/v1/operations/execute", s.execute)
	mux.HandleFunc("GET /api/v1/resources", s.listResources)
	mux.HandleFunc("GET /api/v1/resources/{service}", s.listServiceResources)
	mux.HandleFunc("GET /api/v1/regions", s.listRegions)
	mux.HandleFunc("GET /api/v1/logs", s.listLogs)
	mux.HandleFunc("GET /api/v1/logs/{id}", s.getLog)
	mux.HandleFunc("GET /api/v1/events", s.listEvents)
	mux.HandleFunc("GET /api/v1/architecture", s.architecture)
	mux.HandleFunc("GET /api/v1/dashboard", s.dashboard)
	mux.HandleFunc("POST /api/v1/cli/execute", s.cliExecute)
	mux.HandleFunc("POST /api/v1/apigateway/invoke", s.apiGatewayInvoke)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "RouteNotFound", "no route for "+r.Method+" "+r.URL.Path)
	})
	return s.recoverer(s.logRequests(s.cors(mux)))
}

// errorBody is the error envelope of CONTRACT section 2.
type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var body errorBody
	body.Error.Code = code
	body.Error.Message = message
	writeJSON(w, status, body)
}

// decodeBody reads a JSON request body into target. The 16 MiB cap leaves
// room for base64 encoded object bodies and Lambda packages.
func decodeBody(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<20))
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "InvalidRequest", "request body is not valid JSON: "+err.Error())
		return false
	}
	return true
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (slices.Contains(s.Config.CORSOrigins, origin) || slices.Contains(s.Config.CORSOrigins, "*")) {
			header := w.Header()
			header.Set("Access-Control-Allow-Origin", origin)
			header.Add("Vary", "Origin")
			header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			header.Set("Access-Control-Allow-Headers", "Content-Type, X-Console-Source, Authorization")
			header.Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		s.Logger.Debug("http request", "method", r.Method, "path", r.URL.Path, "status", recorder.status, "durationMs", time.Since(started).Milliseconds())
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				if recovered == http.ErrAbortHandler {
					panic(recovered)
				}
				s.Logger.Error("handler panicked", "path", r.URL.Path, "panic", recovered)
				writeError(w, http.StatusInternalServerError, "InternalError", "unexpected internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func queryInt(r *http.Request, key string) int {
	value, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return 0
	}
	return value
}

// regionParam validates an optional region query parameter.
func (s *Server) regionParam(w http.ResponseWriter, r *http.Request) (string, bool) {
	region := strings.TrimSpace(r.URL.Query().Get("region"))
	if region == "" || region == "all" {
		return "", true
	}
	if _, _, _, err := s.Engine.Resolve("s3", "ListBuckets", region); err != nil {
		writeError(w, http.StatusBadRequest, "InvalidRegion", err.Error())
		return "", false
	}
	return region, true
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": Version})
}

func (s *Server) flociStatus(w http.ResponseWriter, r *http.Request) {
	health := s.Floci.Check(r.Context())
	type serviceStatus struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	body := struct {
		Endpoint  string          `json:"endpoint"`
		Healthy   bool            `json:"healthy"`
		Status    string          `json:"status"`
		Version   string          `json:"version,omitempty"`
		Edition   string          `json:"edition,omitempty"`
		Services  []serviceStatus `json:"services"`
		LatencyMs int64           `json:"latencyMs"`
		Error     string          `json:"error,omitempty"`
	}{
		Endpoint:  s.Floci.Endpoint(),
		Healthy:   health.Healthy,
		Status:    "Unreachable",
		Version:   health.Version,
		Edition:   health.Edition,
		Services:  []serviceStatus{},
		LatencyMs: health.Latency.Milliseconds(),
		Error:     health.Error,
	}
	if health.Healthy {
		body.Status = "Healthy"
	}
	for _, id := range health.ServiceIDs() {
		body.Services = append(body.Services, serviceStatus{ID: id, Status: health.Services[id]})
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) listRegions(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"regions": s.Config.Regions()})
}

func (s *Server) execute(w http.ResponseWriter, r *http.Request) {
	var req operations.ExecuteRequest
	if !decodeBody(w, r, &req) {
		return
	}
	if req.Service == "" || req.Operation == "" {
		writeError(w, http.StatusBadRequest, "InvalidRequest", "'service' and 'operation' are required")
		return
	}
	source := audit.NormalizeSource(r.Header.Get("X-Console-Source"))
	response, err := s.Engine.Execute(r.Context(), req, source)
	switch {
	case errors.Is(err, operations.ErrUnknownService):
		writeError(w, http.StatusNotFound, "ServiceNotFound", err.Error())
	case errors.Is(err, operations.ErrUnknownOperation):
		writeError(w, http.StatusNotFound, "OperationNotFound", err.Error())
	case errors.Is(err, operations.ErrInvalidRegion):
		writeError(w, http.StatusBadRequest, "InvalidRegion", err.Error())
	case err != nil:
		writeError(w, http.StatusInternalServerError, "InternalError", err.Error())
	default:
		writeJSON(w, http.StatusOK, response)
	}
}

func (s *Server) listLogs(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	logs := s.Audit.ListLogs(audit.LogFilter{
		Service:   query.Get("service"),
		Operation: query.Get("operation"),
		Status:    query.Get("status"),
		Source:    query.Get("source"),
		Query:     query.Get("q"),
		Limit:     queryInt(r, "limit"),
	})
	writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}

func (s *Server) getLog(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.Audit.GetLog(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "LogNotFound", "log entry '"+r.PathValue("id")+"' does not exist")
		return
	}
	writeJSON(w, http.StatusOK, entry)
}

func (s *Server) listEvents(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	events := s.Audit.ListEvents(audit.EventFilter{
		Service: query.Get("service"),
		Type:    query.Get("type"),
		Query:   query.Get("q"),
		Limit:   queryInt(r, "limit"),
	})
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) cliExecute(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Command string `json:"command"`
		Region  string `json:"region"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	writeJSON(w, http.StatusOK, s.CLI.Run(r.Context(), req.Command, req.Region))
}
