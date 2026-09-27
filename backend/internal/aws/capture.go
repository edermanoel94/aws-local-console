package aws

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"

	"github.com/aws/smithy-go/middleware"
	smithyhttp "github.com/aws/smithy-go/transport/http"
)

// Exchange is the raw HTTP exchange of one SDK call, as seen on the wire.
type Exchange struct {
	Method          string
	URL             string
	RequestHeaders  map[string]string
	StatusCode      int
	ResponseHeaders map[string]string
	RequestID       string
	// ErrorBody is the raw body of error responses (HTTP >= 400), capped at 64 KiB.
	ErrorBody string
	// Sent is true once the request reached the transport.
	Sent bool
}

// Recorder collects the Exchange of one call; safe for concurrent use.
type Recorder struct {
	mu       sync.Mutex
	exchange Exchange
}

// Exchange returns a copy of what was recorded.
func (r *Recorder) Exchange() Exchange {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.exchange
}

// CaptureOption returns an APIOptions entry that records the raw HTTP
// request and response of the call into exchange.
//
// The middleware is added at the end of the Deserialize step, which makes it
// the innermost handler: the request is already built and signed, and the
// response is seen before the operation deserializer consumes it.
func CaptureOption(recorder *Recorder) func(*middleware.Stack) error {
	return func(stack *middleware.Stack) error {
		return stack.Deserialize.Add(middleware.DeserializeMiddlewareFunc("ConsoleHTTPCapture",
			func(ctx context.Context, in middleware.DeserializeInput, next middleware.DeserializeHandler) (middleware.DeserializeOutput, middleware.Metadata, error) {
				if req, ok := in.Request.(*smithyhttp.Request); ok {
					host := req.Host
					if host == "" {
						host = req.URL.Host
					}
					// Each retry attempt runs this middleware again: keep only the last attempt.
					recorder.mu.Lock()
					recorder.exchange = Exchange{
						Sent:           true,
						Method:         req.Method,
						URL:            req.URL.String(),
						RequestHeaders: flattenHeaders(req.Header, host),
					}
					recorder.mu.Unlock()
				}
				out, metadata, err := next.HandleDeserialize(ctx, in)
				if resp, ok := out.RawResponse.(*smithyhttp.Response); ok && resp != nil {
					recorder.mu.Lock()
					recorder.exchange.StatusCode = resp.StatusCode
					recorder.exchange.ResponseHeaders = flattenHeaders(resp.Header, "")
					recorder.exchange.RequestID = requestIDFromHeaders(resp.Header)
					if resp.StatusCode >= 400 && resp.Body != nil {
						recorder.exchange.ErrorBody = peekBody(resp)
					}
					recorder.mu.Unlock()
				}
				return out, metadata, err
			}), middleware.After)
	}
}

// peekBody reads the start of the response body and puts it back so the SDK
// deserializer still sees the full body.
func peekBody(resp *smithyhttp.Response) string {
	const limit = 64 << 10
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit))
	resp.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(data), resp.Body), resp.Body}
	if err != nil {
		return ""
	}
	return string(data)
}

// flattenHeaders joins multi-valued headers and redacts credentials.
func flattenHeaders(header http.Header, host string) map[string]string {
	flat := make(map[string]string, len(header)+1)
	if host != "" {
		flat["Host"] = host
	}
	keys := make([]string, 0, len(header))
	for key := range header {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := strings.Join(header[key], ", ")
		switch strings.ToLower(key) {
		case "authorization":
			value = redactAuthorization(value)
		case "x-amz-security-token":
			value = "REDACTED"
		}
		flat[key] = value
	}
	return flat
}

// redactAuthorization keeps the SigV4 algorithm and credential scope (useful to
// debug region/service mismatches) but removes the signature.
func redactAuthorization(value string) string {
	algorithm, _, _ := strings.Cut(value, " ")
	if strings.HasPrefix(algorithm, "AWS4-") {
		return algorithm + " REDACTED"
	}
	return "REDACTED"
}

func requestIDFromHeaders(header http.Header) string {
	for _, key := range []string{"X-Amzn-Requestid", "X-Amz-Request-Id", "X-Amzn-Request-Id", "X-Amz-Id-2"} {
		if value := header.Get(key); value != "" {
			return value
		}
	}
	return ""
}
