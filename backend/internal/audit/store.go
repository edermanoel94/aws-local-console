package audit

import (
	"strings"
	"sync"
)

// ring is a fixed-capacity buffer that keeps the newest items.
type ring[T any] struct {
	items []T
	next  int
	full  bool
}

func newRing[T any](capacity int) *ring[T] {
	return &ring[T]{items: make([]T, capacity)}
}

func (r *ring[T]) add(item T) {
	r.items[r.next] = item
	r.next = (r.next + 1) % len(r.items)
	if r.next == 0 {
		r.full = true
	}
}

// newestFirst calls visit from newest to oldest until it returns false.
func (r *ring[T]) newestFirst(visit func(T) bool) {
	count := r.next
	if r.full {
		count = len(r.items)
	}
	for i := 0; i < count; i++ {
		index := (r.next - 1 - i + len(r.items)) % len(r.items)
		if !visit(r.items[index]) {
			return
		}
	}
}

// Store is the in-memory audit trail.
type Store struct {
	account func() string

	mu     sync.RWMutex
	logs   *ring[LogEntry]
	events *ring[ResourceEvent]
}

// NewStore returns a store keeping the newest capacity logs and events;
// account returns the target's account id, used in derived event ARNs.
func NewStore(capacity int, account func() string) *Store {
	return &Store{account: account, logs: newRing[LogEntry](capacity), events: newRing[ResourceEvent](capacity)}
}

// Record stores a log entry and, for successful mutating operations, the
// derived resource event.
func (s *Store) Record(entry LogEntry, mutating bool) {
	var event *ResourceEvent
	if mutating && entry.Status == StatusSuccess {
		derived := deriveEvent(entry, s.account())
		event = &derived
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logs.add(entry)
	if event != nil {
		s.events.add(*event)
	}
}

// LogFilter narrows ListLogs.
type LogFilter struct {
	Service, Operation, Status, Source, Query string
	Limit                                     int
}

// ListLogs returns matching logs, newest first.
func (s *Store) ListLogs(filter LogFilter) []LogEntry {
	limit := normalizeLimit(filter.Limit)
	query := strings.ToLower(strings.TrimSpace(filter.Query))
	result := []LogEntry{}
	s.mu.RLock()
	defer s.mu.RUnlock()
	s.logs.newestFirst(func(entry LogEntry) bool {
		if matchesLog(entry, filter, query) {
			result = append(result, entry)
		}
		return len(result) < limit
	})
	return result
}

func matchesLog(entry LogEntry, filter LogFilter, query string) bool {
	if filter.Service != "" && entry.Service != filter.Service {
		return false
	}
	if filter.Operation != "" && !strings.EqualFold(entry.Operation, filter.Operation) {
		return false
	}
	if filter.Status != "" && entry.Status != filter.Status {
		return false
	}
	if filter.Source != "" && entry.Source != filter.Source {
		return false
	}
	return query == "" || containsAny(query, entry.ID, entry.Service, entry.Operation, entry.ResourceName,
		entry.ErrorCode, entry.ErrorMessage, entry.RequestID, entry.Region)
}

// GetLog returns one log entry by id.
func (s *Store) GetLog(id string) (LogEntry, bool) {
	var found LogEntry
	ok := false
	s.mu.RLock()
	defer s.mu.RUnlock()
	s.logs.newestFirst(func(entry LogEntry) bool {
		if entry.ID == id {
			found, ok = entry, true
			return false
		}
		return true
	})
	return found, ok
}

// EventFilter narrows ListEvents.
type EventFilter struct {
	Service, Type, Query string
	Limit                int
}

// ListEvents returns matching events, newest first.
func (s *Store) ListEvents(filter EventFilter) []ResourceEvent {
	limit := normalizeLimit(filter.Limit)
	query := strings.ToLower(strings.TrimSpace(filter.Query))
	result := []ResourceEvent{}
	s.mu.RLock()
	defer s.mu.RUnlock()
	s.events.newestFirst(func(event ResourceEvent) bool {
		if matchesEvent(event, filter, query) {
			result = append(result, event)
		}
		return len(result) < limit
	})
	return result
}

func matchesEvent(event ResourceEvent, filter EventFilter, query string) bool {
	if filter.Service != "" && event.Service != filter.Service {
		return false
	}
	if filter.Type != "" && !strings.EqualFold(event.Type, filter.Type) {
		return false
	}
	if query == "" {
		return true
	}
	fields := []string{event.ID, event.Type, event.Operation, event.Service, event.ResourceName, event.ResourceARN, event.LogID}
	for _, related := range event.Related {
		fields = append(fields, related.Name, related.ARN, related.Service)
	}
	return containsAny(query, fields...)
}

func containsAny(query string, fields ...string) bool {
	for _, field := range fields {
		if strings.Contains(strings.ToLower(field), query) {
			return true
		}
	}
	return false
}

func normalizeLimit(limit int) int {
	if limit <= 0 {
		return 200
	}
	return min(limit, 2000)
}
