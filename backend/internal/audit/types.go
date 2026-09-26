// Package audit keeps the in-memory history of executed operations (LogEntry)
// and the resource lifecycle events derived from them (ResourceEvent).
package audit

// Execution status values.
const (
	StatusSuccess = "success"
	StatusError   = "error"
)

// ErrorKind values (CONTRACT section 3).
const (
	KindAWS         = "aws"
	KindUnsupported = "unsupported"
	KindValidation  = "validation"
	KindNetwork     = "network"
	KindApplication = "application"
)

// Source values.
const (
	SourceAPIExplorer = "api-explorer"
	SourceConsole     = "console"
	SourceCLI         = "cli"
	SourceSystem      = "system"
)

// NormalizeSource maps a header value to a known source, defaulting to api-explorer.
func NormalizeSource(value string) string {
	switch value {
	case SourceAPIExplorer, SourceConsole, SourceCLI, SourceSystem:
		return value
	}
	return SourceAPIExplorer
}

// Request describes what was sent to Floci.
type Request struct {
	Input   map[string]any    `json:"input"`
	Method  string            `json:"method,omitempty"`
	URL     string            `json:"url,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

// Response describes what Floci answered.
type Response struct {
	Output  any               `json:"output,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	// Body is the raw error body returned by Floci (only for HTTP >= 400).
	Body string `json:"body,omitempty"`
}

// Error is the classified error of a failed execution.
type Error struct {
	Kind    string `json:"kind"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// LogEntry is one executed operation.
type LogEntry struct {
	ID           string   `json:"id"`
	Timestamp    string   `json:"timestamp"`
	Service      string   `json:"service"`
	Operation    string   `json:"operation"`
	Region       string   `json:"region"`
	Status       string   `json:"status"`
	HTTPStatus   int      `json:"httpStatus"`
	DurationMs   int64    `json:"durationMs"`
	RequestID    string   `json:"requestId,omitempty"`
	ErrorKind    string   `json:"errorKind,omitempty"`
	ErrorCode    string   `json:"errorCode,omitempty"`
	ErrorMessage string   `json:"errorMessage,omitempty"`
	Source       string   `json:"source"`
	ResourceName string   `json:"resourceName,omitempty"`
	Request      Request  `json:"request"`
	Response     Response `json:"response"`
}

// RelatedResource is another resource involved in an event.
type RelatedResource struct {
	Service string `json:"service"`
	Name    string `json:"name"`
	ARN     string `json:"arn,omitempty"`
}

// ResourceEvent is a lifecycle event derived from a successful mutating operation.
type ResourceEvent struct {
	ID           string            `json:"id"`
	Timestamp    string            `json:"timestamp"`
	Service      string            `json:"service"`
	Type         string            `json:"type"`
	Operation    string            `json:"operation"`
	Region       string            `json:"region"`
	ResourceName string            `json:"resourceName,omitempty"`
	ResourceARN  string            `json:"resourceArn,omitempty"`
	LogID        string            `json:"logId"`
	Related      []RelatedResource `json:"related"`
	Detail       map[string]any    `json:"detail"`
}
