package api

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/edermanoel/aws-dash-local/backend/internal/audit"
	"github.com/edermanoel/aws-dash-local/backend/internal/resources"
)

// apiGatewayInvoke calls a deployed REST API stage through Floci's
// user-request endpoint: {FLOCI}/restapis/{id}/{stage}/_user_request_{path}.
// Floci does not implement TestInvokeMethod (HTTP 406), so this is how the
// console executes APIs. The call is audited as apigateway "Invoke".
func (s *Server) apiGatewayInvoke(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RestAPIID string            `json:"restApiId"`
		Stage     string            `json:"stage"`
		Method    string            `json:"method"`
		Path      string            `json:"path"`
		Headers   map[string]string `json:"headers"`
		Body      string            `json:"body"`
		Region    string            `json:"region"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	req.Method = strings.ToUpper(strings.TrimSpace(req.Method))
	if req.Method == "" {
		req.Method = http.MethodGet
	}
	if req.RestAPIID == "" || req.Stage == "" {
		writeError(w, http.StatusBadRequest, "InvalidRequest", "'restApiId' and 'stage' are required")
		return
	}
	if strings.ContainsAny(req.RestAPIID+req.Stage, "/?#") {
		writeError(w, http.StatusBadRequest, "InvalidRequest", "'restApiId' and 'stage' must not contain '/', '?' or '#'")
		return
	}
	if req.Region == "" {
		req.Region = s.Config.DefaultRegion
	}
	if !strings.HasPrefix(req.Path, "/") {
		req.Path = "/" + req.Path
	}
	target := resources.InvokeURL(s.Config.FlociEndpoint, url.PathEscape(req.RestAPIID), url.PathEscape(req.Stage)) + req.Path

	input := map[string]any{"restApiId": req.RestAPIID, "stage": req.Stage, "method": req.Method, "path": req.Path, "region": req.Region}
	if len(req.Headers) > 0 {
		input["headers"] = req.Headers
	}
	if req.Body != "" {
		input["body"] = req.Body
	}
	entry := audit.LogEntry{
		ID:           audit.NewID("op_"),
		Service:      "apigateway",
		Operation:    "Invoke",
		Region:       req.Region,
		Source:       audit.NormalizeSource(r.Header.Get("X-Console-Source")),
		ResourceName: req.RestAPIID,
		Request:      audit.Request{Input: input, Method: req.Method, URL: target},
	}
	started := time.Now()
	entry.Timestamp = started.UTC().Format(time.RFC3339Nano)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	var body io.Reader
	if req.Body != "" {
		body = bytes.NewReader([]byte(req.Body))
	}
	upstream, err := http.NewRequestWithContext(ctx, req.Method, target, body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "InvalidRequest", err.Error())
		return
	}
	for key, value := range req.Headers {
		upstream.Header.Set(key, value)
	}
	if req.Body != "" && upstream.Header.Get("Content-Type") == "" {
		upstream.Header.Set("Content-Type", "application/json")
	}
	entry.Request.Headers = flatten(upstream.Header)

	resp, err := s.Factory.HTTPClient().Do(upstream)
	if err != nil {
		entry.DurationMs = time.Since(started).Milliseconds()
		entry.Status = audit.StatusError
		entry.ErrorKind = audit.KindNetwork
		entry.ErrorCode = "NetworkError"
		entry.ErrorMessage = err.Error()
		s.Audit.Record(entry, true)
		writeError(w, http.StatusBadGateway, "FlociUnreachable", "could not reach Floci: "+err.Error())
		return
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	duration := time.Since(started).Milliseconds()

	headers := flatten(resp.Header)
	output := map[string]any{"status": resp.StatusCode, "headers": headers, "body": string(data)}
	entry.DurationMs = duration
	entry.HTTPStatus = resp.StatusCode
	entry.RequestID = firstHeader(resp.Header, "X-Amzn-Requestid", "X-Amz-Apigw-Id", "X-Amz-Request-Id")
	entry.Response = audit.Response{Output: output, Headers: headers}
	entry.Status = audit.StatusSuccess
	if resp.StatusCode >= 400 {
		entry.Status = audit.StatusError
		entry.ErrorKind = audit.KindAWS
		entry.ErrorCode = http.StatusText(resp.StatusCode)
		entry.ErrorMessage = strings.TrimSpace(string(data))
	}
	s.Audit.Record(entry, true)

	writeJSON(w, http.StatusOK, map[string]any{
		"status":     resp.StatusCode,
		"headers":    headers,
		"body":       string(data),
		"durationMs": duration,
		"url":        target,
		"logId":      entry.ID,
	})
}

func flatten(header http.Header) map[string]string {
	keys := make([]string, 0, len(header))
	for key := range header {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	flat := make(map[string]string, len(keys))
	for _, key := range keys {
		flat[key] = strings.Join(header[key], ", ")
	}
	return flat
}

func firstHeader(header http.Header, keys ...string) string {
	for _, key := range keys {
		if value := header.Get(key); value != "" {
			return value
		}
	}
	return ""
}
