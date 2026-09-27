package api

import (
	"net/http"

	"github.com/edermanoel94/aws-local-console/backend/internal/coverage"
	"github.com/edermanoel94/aws-local-console/backend/internal/operations"
	"github.com/edermanoel94/aws-local-console/backend/internal/services"
)

type serviceSummary struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	ShortName      string          `json:"shortName"`
	Description    string          `json:"description"`
	Category       string          `json:"category"`
	Available      bool            `json:"available"`
	ResourceTypes  []string        `json:"resourceTypes"`
	OperationCount int             `json:"operationCount"`
	Coverage       coverage.Counts `json:"coverage"`
	Capabilities   []string        `json:"capabilities"`
}

type serviceDetail struct {
	serviceSummary
	Operations []operationInfo `json:"operations"`
}

type operationInfo struct {
	Name         string                  `json:"name"`
	Service      string                  `json:"service"`
	Mutating     bool                    `json:"mutating"`
	Coverage     string                  `json:"coverage"`
	InputExample map[string]any          `json:"inputExample"`
	InputFields  []operations.InputField `json:"inputFields"`
}

func (s *Server) summary(def *services.Definition, available bool) serviceSummary {
	names := s.Catalog.Names(def.ID)
	return serviceSummary{
		ID:             def.ID,
		Name:           def.Name,
		ShortName:      def.ShortName,
		Description:    def.Description,
		Category:       string(def.Category),
		Available:      available,
		ResourceTypes:  def.ResourceTypes,
		OperationCount: len(names),
		Coverage:       s.Coverage.Summary(def.ID, names),
		Capabilities:   def.Capabilities,
	}
}

func (s *Server) operationInfo(op *operations.Operation) operationInfo {
	return operationInfo{
		Name:         op.Name,
		Service:      op.Service,
		Mutating:     op.Mutating,
		Coverage:     s.Coverage.Status(op.Service, op.Name),
		InputExample: op.Example(),
		InputFields:  op.InputFields(),
	}
}

func (s *Server) operationInfos(service string) []operationInfo {
	infos := []operationInfo{}
	for _, op := range s.Catalog.Operations(service) {
		infos = append(infos, s.operationInfo(op))
	}
	return infos
}

func (s *Server) lookupService(w http.ResponseWriter, r *http.Request) (*services.Definition, bool) {
	def, ok := s.Registry.Get(r.PathValue("service"))
	if !ok {
		writeError(w, http.StatusNotFound, "ServiceNotFound", "service '"+r.PathValue("service")+"' is not registered")
	}
	return def, ok
}

func (s *Server) listServices(w http.ResponseWriter, r *http.Request) {
	health := s.Floci.Cached(r.Context())
	summaries := []serviceSummary{}
	for _, def := range s.Registry.All() {
		summaries = append(summaries, s.summary(def, health.Running(def.FlociID)))
	}
	writeJSON(w, http.StatusOK, map[string]any{"services": summaries})
}

func (s *Server) getService(w http.ResponseWriter, r *http.Request) {
	def, ok := s.lookupService(w, r)
	if !ok {
		return
	}
	health := s.Floci.Cached(r.Context())
	writeJSON(w, http.StatusOK, serviceDetail{
		serviceSummary: s.summary(def, health.Running(def.FlociID)),
		Operations:     s.operationInfos(def.ID),
	})
}

func (s *Server) listOperations(w http.ResponseWriter, r *http.Request) {
	def, ok := s.lookupService(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"operations": s.operationInfos(def.ID)})
}

func (s *Server) getOperation(w http.ResponseWriter, r *http.Request) {
	def, ok := s.lookupService(w, r)
	if !ok {
		return
	}
	op, found := s.Catalog.Find(def.ID, r.PathValue("operation"))
	if !found {
		writeError(w, http.StatusNotFound, "OperationNotFound", "operation '"+r.PathValue("operation")+"' does not exist in service '"+def.ID+"'")
		return
	}
	writeJSON(w, http.StatusOK, s.operationInfo(op))
}
