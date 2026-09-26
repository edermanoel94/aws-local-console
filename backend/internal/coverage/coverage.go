// Package coverage tracks, per operation, whether Floci implements it, based
// on the outcome of real executions (kept in memory).
package coverage

import "sync"

// Status values.
const (
	Supported   = "supported"
	Unsupported = "unsupported"
	Untested    = "untested"
)

// Counts is the per-service coverage summary.
type Counts struct {
	Supported   int `json:"supported"`
	Unsupported int `json:"unsupported"`
	Untested    int `json:"untested"`
}

// Tracker records the last observed coverage of each operation.
type Tracker struct {
	mu     sync.RWMutex
	status map[string]map[string]string
}

// NewTracker returns an empty tracker.
func NewTracker() *Tracker {
	return &Tracker{status: map[string]map[string]string{}}
}

// Observe records an execution outcome. Only supported/unsupported change the
// state; validation, network and application errors say nothing about Floci.
func (t *Tracker) Observe(service, operation, status string) {
	if status != Supported && status != Unsupported {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.status[service] == nil {
		t.status[service] = map[string]string{}
	}
	t.status[service][operation] = status
}

// Status returns the coverage of one operation.
func (t *Tracker) Status(service, operation string) string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if status, ok := t.status[service][operation]; ok {
		return status
	}
	return Untested
}

// Summary counts the coverage of the given operations of a service.
func (t *Tracker) Summary(service string, operations []string) Counts {
	t.mu.RLock()
	defer t.mu.RUnlock()
	counts := Counts{}
	for _, operation := range operations {
		switch t.status[service][operation] {
		case Supported:
			counts.Supported++
		case Unsupported:
			counts.Unsupported++
		default:
			counts.Untested++
		}
	}
	return counts
}
