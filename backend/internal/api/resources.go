package api

import (
	"net/http"
	"sort"

	"github.com/edermanoel94/aws-local-console/backend/internal/audit"
	"github.com/edermanoel94/aws-local-console/backend/internal/resources"
)

func (s *Server) listResources(w http.ResponseWriter, r *http.Request) {
	region, ok := s.regionParam(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	service := query.Get("service")
	if service != "" {
		if _, found := s.Registry.Get(service); !found {
			writeError(w, http.StatusNotFound, "ServiceNotFound", "service '"+service+"' is not registered")
			return
		}
	}
	writeJSON(w, http.StatusOK, s.Discoverer.Discover(r.Context(), resources.Query{
		Region:  region,
		Service: service,
		Type:    query.Get("type"),
		Text:    query.Get("q"),
		Tag:     query.Get("tag"),
	}))
}

func (s *Server) listServiceResources(w http.ResponseWriter, r *http.Request) {
	def, ok := s.lookupService(w, r)
	if !ok {
		return
	}
	region, ok := s.regionParam(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	writeJSON(w, http.StatusOK, s.Discoverer.Discover(r.Context(), resources.Query{
		Region:  region,
		Service: def.ID,
		Type:    query.Get("type"),
		Text:    query.Get("q"),
		Tag:     query.Get("tag"),
	}))
}

func (s *Server) architecture(w http.ResponseWriter, r *http.Request) {
	region, ok := s.regionParam(w, r)
	if !ok {
		return
	}
	if region == "" {
		region = s.Config.DefaultRegion
	}
	writeJSON(w, http.StatusOK, s.Architecture.Build(r.Context(), region))
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	region, ok := s.regionParam(w, r)
	if !ok {
		return
	}
	status := s.Monitor.Cached(r.Context())
	available := 0
	for _, def := range s.Registry.All() {
		if status.Available(def.FlociID) {
			available++
		}
	}
	list := s.Discoverer.Discover(r.Context(), resources.Query{Region: region})
	counts := map[string]int{}
	for _, resource := range list.Resources {
		counts[resource.Service]++
	}
	type serviceCount struct {
		Service string `json:"service"`
		Count   int    `json:"count"`
	}
	byService := []serviceCount{}
	for service, count := range counts {
		byService = append(byService, serviceCount{Service: service, Count: count})
	}
	sort.Slice(byService, func(i, j int) bool {
		if byService[i].Count != byService[j].Count {
			return byService[i].Count > byService[j].Count
		}
		return byService[i].Service < byService[j].Service
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"serviceCount":          len(s.Registry.All()),
		"availableServiceCount": available,
		"resourceCount":         list.Total,
		"regionCount":           len(s.Config.Regions()),
		"resourcesByService":    byService,
		"recentOperations":      s.Audit.ListLogs(audit.LogFilter{Limit: 10}),
		"errors":                list.Errors,
	})
}
