package operations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"time"

	awsmiddleware "github.com/aws/aws-sdk-go-v2/aws/middleware"
	"github.com/aws/smithy-go/middleware"

	"github.com/edermanoel94/aws-local-console/backend/internal/audit"
	awsfloci "github.com/edermanoel94/aws-local-console/backend/internal/aws"
	"github.com/edermanoel94/aws-local-console/backend/internal/coverage"
	"github.com/edermanoel94/aws-local-console/backend/internal/logging"
	"github.com/edermanoel94/aws-local-console/backend/internal/services"
)

// callTimeout bounds one AWS call. Lambda invocations on Floci may pull a
// runtime image on first use, so the bound is generous.
const callTimeout = 5 * time.Minute

// ExecuteRequest is the body of POST /operations/execute.
type ExecuteRequest struct {
	Service   string         `json:"service"`
	Operation string         `json:"operation"`
	Region    string         `json:"region,omitempty"`
	Input     map[string]any `json:"input,omitempty"`
}

// ExecuteResponse is the result of an execution (CONTRACT section 3).
type ExecuteResponse struct {
	ID         string         `json:"id"`
	Service    string         `json:"service"`
	Operation  string         `json:"operation"`
	Region     string         `json:"region"`
	Status     string         `json:"status"`
	HTTPStatus int            `json:"httpStatus"`
	DurationMs int64          `json:"durationMs"`
	RequestID  string         `json:"requestId,omitempty"`
	Timestamp  string         `json:"timestamp"`
	Request    audit.Request  `json:"request"`
	Response   audit.Response `json:"response"`
	Error      *audit.Error   `json:"error,omitempty"`
}

// Sentinel errors for requests that cannot be executed at all.
var (
	ErrUnknownService   = errors.New("unknown service")
	ErrUnknownOperation = errors.New("unknown operation")
	ErrInvalidRegion    = errors.New("invalid region")
)

// resolveError carries a readable message while matching a sentinel with errors.Is.
type resolveError struct {
	kind    error
	message string
}

func (e *resolveError) Error() string { return e.message }
func (e *resolveError) Unwrap() error { return e.kind }

func newResolveError(kind error, format string, args ...any) error {
	return &resolveError{kind: kind, message: fmt.Sprintf(format, args...)}
}

// Engine executes operations and records coverage and audit data.
type Engine struct {
	registry      *services.Registry
	catalog       *Catalog
	coverage      *coverage.Tracker
	audit         *audit.Store
	defaultRegion string
	logger        *slog.Logger
}

// NewEngine wires the engine.
func NewEngine(registry *services.Registry, catalog *Catalog, tracker *coverage.Tracker, store *audit.Store, defaultRegion string, logger *slog.Logger) *Engine {
	return &Engine{registry: registry, catalog: catalog, coverage: tracker, audit: store, defaultRegion: defaultRegion, logger: logger}
}

// Catalog returns the operation catalog.
func (e *Engine) Catalog() *Catalog { return e.catalog }

var regionPattern = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-\d{1,2}$`)

// Resolve validates service, operation and region.
func (e *Engine) Resolve(serviceID, operation, region string) (*services.Definition, *Operation, string, error) {
	def, ok := e.registry.Get(serviceID)
	if !ok {
		return nil, nil, "", newResolveError(ErrUnknownService, "service '%s' is not registered", serviceID)
	}
	op, ok := e.catalog.Find(def.ID, operation)
	if !ok {
		return nil, nil, "", newResolveError(ErrUnknownOperation, "operation '%s' does not exist in service '%s'", operation, serviceID)
	}
	if region == "" {
		region = e.defaultRegion
	}
	if !regionPattern.MatchString(region) {
		return nil, nil, "", newResolveError(ErrInvalidRegion, "'%s' is not a valid AWS region name", region)
	}
	return def, op, region, nil
}

// Execute runs one operation. It returns an error only when the request cannot
// be executed at all (unknown service/operation, invalid region); AWS and
// input errors are reported inside the ExecuteResponse and audited.
func (e *Engine) Execute(ctx context.Context, req ExecuteRequest, source string) (ExecuteResponse, error) {
	def, op, region, err := e.Resolve(req.Service, req.Operation, req.Region)
	if err != nil {
		return ExecuteResponse{}, err
	}
	input := req.Input
	if input == nil {
		input = map[string]any{}
	}
	result := e.run(ctx, def, op, region, input)
	e.record(result, op, source)
	return result, nil
}

func (e *Engine) run(ctx context.Context, def *services.Definition, op *Operation, region string, input map[string]any) (result ExecuteResponse) {
	started := time.Now()
	result = ExecuteResponse{
		ID:        audit.NewID("op_"),
		Service:   def.ID,
		Operation: op.Name,
		Region:    region,
		Timestamp: started.UTC().Format(time.RFC3339Nano),
		Request:   audit.Request{Input: input},
	}
	fail := func(kind, code, message string) {
		result.Status = audit.StatusError
		result.Error = &audit.Error{Kind: kind, Code: code, Message: message}
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			e.logger.Error("operation panicked", "service", def.ID, "operation", op.Name, "panic", recovered)
			fail(audit.KindApplication, "InternalError", fmt.Sprintf("unexpected failure while executing %s: %v", op.Name, recovered))
		}
		result.DurationMs = time.Since(started).Milliseconds()
	}()

	normalized, err := normalizeJSON(input)
	if err != nil {
		fail(audit.KindValidation, "InvalidInput", err.Error())
		return result
	}
	inputValue, err := decodeInput(op.inputType, normalized)
	if err != nil {
		var inputErr *InputError
		if errors.As(err, &inputErr) {
			fail(audit.KindValidation, "InvalidInput", err.Error())
		} else {
			fail(audit.KindApplication, "InternalError", err.Error())
		}
		return result
	}

	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	recorder := &awsfloci.Recorder{}
	var metadata middleware.Metadata
	output, callErr := op.call(ctx, e.registry.Client(def, region), inputValue, awsfloci.CaptureOption(recorder))
	wire := recorder.Exchange()
	result.Request.Method = wire.Method
	result.Request.URL = wire.URL
	result.Request.Headers = wire.RequestHeaders
	result.Response.Headers = wire.ResponseHeaders
	result.Response.Body = wire.ErrorBody
	result.HTTPStatus = wire.StatusCode
	result.RequestID = wire.RequestID

	if callErr != nil {
		classified := classifyError(callErr, wire)
		if classified.httpStatus != 0 {
			result.HTTPStatus = classified.httpStatus
		}
		fail(classified.Kind, classified.Code, classified.Message)
		return result
	}

	result.Status = audit.StatusSuccess
	if output.IsValid() && !output.IsNil() {
		if field := output.Elem().FieldByName("ResultMetadata"); field.IsValid() {
			metadata, _ = field.Interface().(middleware.Metadata)
		}
		result.Response.Output = encodeOutput(output)
	}
	if result.RequestID == "" {
		result.RequestID, _ = awsmiddleware.GetRequestIDMetadata(metadata)
	}
	return result
}

func (e *Engine) record(result ExecuteResponse, op *Operation, source string) {
	switch {
	case result.Status == audit.StatusSuccess:
		e.coverage.Observe(result.Service, result.Operation, coverage.Supported)
	case result.Error.Kind == audit.KindAWS:
		e.coverage.Observe(result.Service, result.Operation, coverage.Supported)
	case result.Error.Kind == audit.KindUnsupported:
		e.coverage.Observe(result.Service, result.Operation, coverage.Unsupported)
	}

	output, _ := result.Response.Output.(map[string]any)
	entry := audit.LogEntry{
		ID:           result.ID,
		Timestamp:    result.Timestamp,
		Service:      result.Service,
		Operation:    result.Operation,
		Region:       result.Region,
		Status:       result.Status,
		HTTPStatus:   result.HTTPStatus,
		DurationMs:   result.DurationMs,
		RequestID:    result.RequestID,
		Source:       source,
		ResourceName: audit.ResourceName(result.Service, result.Operation, result.Request.Input, output),
		Request:      result.Request,
		Response:     result.Response,
	}
	if result.Error != nil {
		entry.ErrorKind = result.Error.Kind
		entry.ErrorCode = result.Error.Code
		entry.ErrorMessage = result.Error.Message
	}
	e.audit.Record(entry, op.Mutating)
	e.log(result, source)
}

// log reports an executed operation: INFO when it succeeded, WARNING when AWS or
// the input rejected it, ERROR when Floci was unreachable or the console failed.
// TRACE adds the wire exchange and the payloads.
func (e *Engine) log(result ExecuteResponse, source string) {
	ctx := context.Background()
	attrs := []any{
		"id", result.ID, "service", result.Service, "operation", result.Operation, "region", result.Region,
		"status", result.Status, "httpStatus", result.HTTPStatus, "durationMs", result.DurationMs, "source", source,
	}
	level := slog.LevelInfo
	if result.Error != nil {
		attrs = append(attrs, "errorKind", result.Error.Kind, "errorCode", result.Error.Code, "error", result.Error.Message)
		level = slog.LevelWarn
		if result.Error.Kind == audit.KindNetwork || result.Error.Kind == audit.KindApplication {
			level = slog.LevelError
		}
	}
	e.logger.Log(ctx, level, "operation executed", attrs...)
	logging.Trace(ctx, e.logger, "operation exchange",
		"id", result.ID, "method", result.Request.Method, "url", result.Request.URL, "requestId", result.RequestID,
		"input", jsonAttr(result.Request.Input), "output", jsonAttr(result.Response.Output), "errorBody", result.Response.Body,
		"requestHeaders", result.Request.Headers, "responseHeaders", result.Response.Headers)
}

// jsonAttr renders a payload as compact JSON, only when the record is written.
func jsonAttr(value any) slog.LogValuer { return jsonValue{value} }

type jsonValue struct{ value any }

func (v jsonValue) LogValue() slog.Value {
	if v.value == nil {
		return slog.StringValue("")
	}
	encoded, err := json.Marshal(v.value)
	if err != nil {
		return slog.StringValue(fmt.Sprintf("%v", v.value))
	}
	return slog.StringValue(string(encoded))
}
