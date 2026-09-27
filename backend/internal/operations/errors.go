package operations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/aws/smithy-go"
	smithyhttp "github.com/aws/smithy-go/transport/http"

	"github.com/edermanoel94/aws-local-console/backend/internal/audit"
	consoleaws "github.com/edermanoel94/aws-local-console/backend/internal/aws"
	"github.com/edermanoel94/aws-local-console/backend/internal/environments"
)

// How Floci answers operations it does not implement (probed against Floci
// 2.1.0 community; every case below was observed with the AWS CLI and the SDK):
//
//   - JSON 1.0/1.1 protocols (DynamoDB, EventBridge, CloudWatch Logs):
//     HTTP 400 with __type UnknownOperationException ("Operation X is not
//     supported.") or UnsupportedOperation.
//   - Query protocols (SNS, IAM, SQS query mode): HTTP 400 with code
//     UnsupportedOperation ("Operation X is not supported by SNS.") and, for
//     unknown actions, InvalidAction.
//   - REST-JSON protocols (Lambda, API Gateway): the route does not exist, so
//     Floci answers HTTP 404 with an HTML body ("Resource not found") or HTTP
//     405/406 with an empty body, and no AWS error code. Lambda also answers
//     UnknownOperationException ("Unknown operation: GET /2025-11-30/...").
//   - S3: HTTP 501 NotImplemented for unimplemented sub-resources.
//
// Regular AWS errors (NoSuchBucket, ResourceNotFoundException, ...) always
// carry an AWS error code, which is what separates them from missing routes.
//
// Real AWS implements every operation of its SDK, so with TargetAWS these
// answers are regular AWS errors and nothing is classified as unsupported.
var unsupportedCodes = map[string]bool{
	"UnknownOperationException":     true,
	"UnknownOperation":              true,
	"UnsupportedOperation":          true,
	"UnsupportedOperationException": true,
	"NotImplemented":                true,
	"NotImplementedException":       true,
	"InvalidAction":                 true,
}

// classifiedError is the result of classifying an SDK call error.
type classifiedError struct {
	audit.Error
	httpStatus int
}

func classifyError(err error, exchange consoleaws.Exchange, target environments.Target) classifiedError {
	floci := target == environments.TargetFloci
	status := exchange.StatusCode
	var responseErr *smithyhttp.ResponseError
	if errors.As(err, &responseErr) && responseErr.Response != nil {
		status = responseErr.HTTPStatusCode()
	}

	var invalidParams smithy.InvalidParamsError
	if errors.As(err, &invalidParams) {
		return classifiedError{Error: audit.Error{Kind: audit.KindValidation, Code: "InvalidParameter", Message: invalidParams.Error()}}
	}

	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		code, message := apiErr.ErrorCode(), apiErr.ErrorMessage()
		if message == "" {
			// Some Floci error bodies use casing the SDK deserializer ignores
			// (Lambda answers {"__type": ..., "message": ...}); read it from the raw body.
			message = messageFromBody(exchange.ErrorBody)
		}
		if message == "" {
			message = strings.TrimSpace(apiErr.Error())
		}
		kind := audit.KindAWS
		if floci && isUnsupported(code, status, exchange) {
			kind = audit.KindUnsupported
			code, message = unsupportedCode(code, status), unsupportedMessage(message, status, exchange)
		}
		return classifiedError{Error: audit.Error{Kind: kind, Code: code, Message: message}, httpStatus: status}
	}

	if status > 0 {
		// The target answered but the SDK could not parse it (on Floci,
		// typically an HTML or empty body on a route that does not exist).
		if floci && isUnsupported("", status, exchange) {
			return classifiedError{Error: audit.Error{Kind: audit.KindUnsupported, Code: unsupportedCode("", status), Message: unsupportedMessage("", status, exchange)}, httpStatus: status}
		}
		if status >= 400 {
			return classifiedError{Error: audit.Error{Kind: audit.KindAWS, Code: "HTTP" + strconv.Itoa(status), Message: rootMessage(err)}, httpStatus: status}
		}
		return classifiedError{Error: audit.Error{Kind: audit.KindAWS, Code: "InvalidResponse", Message: target.DisplayName() + " returned a response the AWS SDK could not parse: " + rootMessage(err)}, httpStatus: status}
	}

	if reason, ok := credentialsError(err); ok && !exchange.Sent {
		return classifiedError{Error: audit.Error{Kind: audit.KindApplication, Code: "CredentialsError", Message: "could not load AWS credentials: " + reason}}
	}
	if isNetworkError(err) || exchange.Sent {
		return classifiedError{Error: audit.Error{Kind: audit.KindNetwork, Code: "NetworkError", Message: target.DisplayName() + " is unreachable at " + exchange.URL + ": " + rootMessage(err)}}
	}
	// The SDK refused to build the request (e.g. S3 Express operations need a
	// bucket-scoped session identity): nothing was sent.
	var operationErr *smithy.OperationError
	if errors.As(err, &operationErr) {
		return classifiedError{Error: audit.Error{Kind: audit.KindValidation, Code: "ClientError", Message: "the AWS SDK rejected the request before sending it: " + rootMessage(err)}}
	}
	return classifiedError{Error: audit.Error{Kind: audit.KindApplication, Code: "InternalError", Message: err.Error()}}
}

func isUnsupported(code string, status int, exchange consoleaws.Exchange) bool {
	if unsupportedCodes[code] || status == 501 {
		return true
	}
	if status != 404 && status != 405 && status != 406 {
		return false
	}
	// No AWS error code: the SDK falls back to the HTTP status text or "UnknownError".
	if code == "" || code == "UnknownError" || code == strconv.Itoa(status) || strings.EqualFold(code, "NotFound") {
		return true
	}
	contentType := strings.ToLower(exchange.ResponseHeaders["Content-Type"])
	return strings.Contains(contentType, "text/html")
}

func unsupportedCode(code string, status int) string {
	if unsupportedCodes[code] {
		return code
	}
	if status == 501 {
		return "NotImplemented"
	}
	return "UnsupportedOperation"
}

func unsupportedMessage(message string, status int, exchange consoleaws.Exchange) string {
	if message != "" && message != "UnknownError" && !strings.Contains(message, "<html") && !strings.HasPrefix(message, "api error") {
		return message
	}
	return fmt.Sprintf("Floci does not implement this operation (HTTP %d on %s %s)", status, exchange.Method, pathOf(exchange.URL))
}

func pathOf(url string) string {
	if _, rest, ok := strings.Cut(url, "://"); ok {
		if index := strings.Index(rest, "/"); index >= 0 {
			return rest[index:]
		}
	}
	return url
}

// messageFromBody extracts an error message from a raw JSON or XML error body.
func messageFromBody(body string) string {
	body = strings.TrimSpace(body)
	if body == "" {
		return ""
	}
	if strings.HasPrefix(body, "{") {
		var object map[string]any
		if json.Unmarshal([]byte(body), &object) == nil {
			for _, key := range []string{"message", "Message", "errorMessage", "error"} {
				if text, ok := object[key].(string); ok && text != "" {
					return text
				}
			}
		}
		return ""
	}
	if start := strings.Index(body, "<Message>"); start >= 0 {
		rest := body[start+len("<Message>"):]
		if end := strings.Index(rest, "</Message>"); end >= 0 {
			return rest[:end]
		}
	}
	return ""
}

// credentialsError returns why the SDK could not resolve the credentials to
// sign the request with. The SDK has no typed error for it: its GetIdentity
// middleware wraps the provider error as "get identity: ...".
func credentialsError(err error) (string, bool) {
	_, reason, found := strings.Cut(err.Error(), "get identity: ")
	return strings.TrimPrefix(reason, "get credentials: "), found
}

func isNetworkError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	var sendErr *smithyhttp.RequestSendError
	if errors.As(err, &sendErr) {
		return true
	}
	var netErr net.Error
	return errors.As(err, &netErr)
}

// rootMessage returns the innermost error message, without the SDK's
// "operation error S3: PutObject, https response error ..." prefixes.
func rootMessage(err error) string {
	for {
		next := errors.Unwrap(err)
		if next == nil {
			return err.Error()
		}
		err = next
	}
}
