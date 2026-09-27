package aws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/edermanoel94/aws-local-console/backend/internal/logging"
)

// FlociHealth is the parsed answer of Floci's GET /_floci/health.
type FlociHealth struct {
	Healthy   bool
	Version   string
	Edition   string
	Services  map[string]string
	Latency   time.Duration
	Error     string
	CheckedAt time.Time
}

// ServiceIDs returns the service ids in stable order.
func (h FlociHealth) ServiceIDs() []string {
	ids := make([]string, 0, len(h.Services))
	for id := range h.Services {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// Running reports whether Floci lists the service as running.
func (h FlociHealth) Running(flociID string) bool {
	return h.Services[flociID] == "running"
}

// FlociMonitor fetches Floci health and caches it briefly so that listing
// services does not hit Floci on every request.
type FlociMonitor struct {
	endpoint string
	client   *http.Client
	ttl      time.Duration
	logger   *slog.Logger

	mu   sync.Mutex
	last *FlociHealth
}

// NewFlociMonitor returns a monitor for the Floci endpoint.
func NewFlociMonitor(f *Factory, ttl time.Duration, logger *slog.Logger) *FlociMonitor {
	return &FlociMonitor{endpoint: f.Endpoint(), client: f.HTTPClient(), ttl: ttl, logger: logger}
}

// Endpoint returns the monitored endpoint.
func (m *FlociMonitor) Endpoint() string { return m.endpoint }

// Cached returns a recent health result, refreshing it when older than the TTL.
func (m *FlociMonitor) Cached(ctx context.Context) FlociHealth {
	m.mu.Lock()
	if m.last != nil && time.Since(m.last.CheckedAt) < m.ttl {
		health := *m.last
		m.mu.Unlock()
		return health
	}
	m.mu.Unlock()
	return m.Check(ctx)
}

// Check queries Floci now and stores the result.
func (m *FlociMonitor) Check(ctx context.Context) FlociHealth {
	health := m.fetch(ctx)
	m.mu.Lock()
	previous := m.last
	m.last = &health
	m.mu.Unlock()
	m.log(ctx, previous, health)
	return health
}

// log reports every check at TRACE, and changes of reachability at WARNING
// (Floci went down, or is down at the first check) and INFO (Floci is back).
func (m *FlociMonitor) log(ctx context.Context, previous *FlociHealth, health FlociHealth) {
	logging.Trace(ctx, m.logger, "floci health checked",
		"endpoint", m.endpoint, "healthy", health.Healthy, "latencyMs", health.Latency.Milliseconds(), "error", health.Error)
	switch {
	case !health.Healthy && (previous == nil || previous.Healthy):
		m.logger.Warn("floci unreachable", "endpoint", m.endpoint, "error", health.Error)
	case health.Healthy && previous != nil && !previous.Healthy:
		m.logger.Info("floci reachable again", "endpoint", m.endpoint, "version", health.Version)
	case health.Healthy && previous == nil:
		m.logger.Info("floci reachable", "endpoint", m.endpoint, "version", health.Version, "edition", health.Edition)
	}
}

func (m *FlociMonitor) fetch(ctx context.Context) FlociHealth {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	health := FlociHealth{Services: map[string]string{}, CheckedAt: time.Now()}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.endpoint+"/_floci/health", nil)
	if err != nil {
		health.Error = err.Error()
		return health
	}
	start := time.Now()
	resp, err := m.client.Do(req)
	health.Latency = time.Since(start)
	if err != nil {
		health.Error = err.Error()
		return health
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		health.Error = fmt.Sprintf("floci health returned HTTP %d", resp.StatusCode)
		return health
	}
	var body struct {
		Version  string            `json:"version"`
		Edition  string            `json:"edition"`
		Services map[string]string `json:"services"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		health.Error = "invalid floci health payload: " + err.Error()
		return health
	}
	health.Healthy = true
	health.Version = body.Version
	health.Edition = body.Edition
	if body.Services != nil {
		health.Services = body.Services
	}
	return health
}
