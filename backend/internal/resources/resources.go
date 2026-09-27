// Package resources discovers the resources that exist in Floci (buckets,
// queues, topics, tables, functions, APIs, buses, rules, log groups, roles)
// and filters them for the Resource Explorer.
package resources

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/edermanoel94/aws-local-console/backend/internal/services"
)

// GlobalRegion is the region of resources of global services (IAM).
const GlobalRegion = "global"

// Tag is a resource tag.
type Tag struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Resource is one discovered resource (CONTRACT section 3).
type Resource struct {
	ID         string         `json:"id"`
	ARN        string         `json:"arn"`
	Name       string         `json:"name"`
	Service    string         `json:"service"`
	Type       string         `json:"type"`
	Region     string         `json:"region"`
	CreatedAt  string         `json:"createdAt,omitempty"`
	Tags       []Tag          `json:"tags"`
	Attributes map[string]any `json:"attributes"`
}

// ServiceError is a discovery failure of one service.
type ServiceError struct {
	Service string `json:"service"`
	Message string `json:"message"`
}

// List is the Resource Explorer answer.
type List struct {
	Resources []Resource     `json:"resources"`
	Total     int            `json:"total"`
	Errors    []ServiceError `json:"errors"`
}

// ResourceID builds the stable id `${service}:${type}:${region}:${name}`.
func ResourceID(service, resourceType, region, name string) string {
	return service + ":" + resourceType + ":" + region + ":" + name
}

func newResource(service, resourceType, region, name, arn string) Resource {
	return Resource{
		ID:         ResourceID(service, resourceType, region, name),
		ARN:        arn,
		Name:       name,
		Service:    service,
		Type:       resourceType,
		Region:     region,
		Tags:       []Tag{},
		Attributes: map[string]any{},
	}
}

func tagsFromMap(tags map[string]string) []Tag {
	result := make([]Tag, 0, len(tags))
	for key, value := range tags {
		result = append(result, Tag{Key: key, Value: value})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Key < result[j].Key })
	return result
}

func formatTime(t *time.Time) string {
	if t == nil || t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// discoverFunc lists the resources of one service in the given regions.
type discoverFunc func(ctx context.Context, d *Discoverer, regions []string) ([]Resource, error)

// Discoverer lists resources from Floci.
type Discoverer struct {
	registry *services.Registry
	account  string
	regions  []string
	logger   *slog.Logger
	byID     map[string]discoverFunc
}

// NewDiscoverer returns a discoverer; regions are the regions scanned when a
// query does not name one.
func NewDiscoverer(registry *services.Registry, account string, regions []string, logger *slog.Logger) *Discoverer {
	return &Discoverer{
		registry: registry,
		account:  account,
		regions:  regions,
		logger:   logger,
		byID: map[string]discoverFunc{
			"s3":           discoverS3,
			"sqs":          regional(discoverSQS),
			"sns":          regional(discoverSNS),
			"dynamodb":     regional(discoverDynamoDB),
			"lambda":       regional(discoverLambda),
			"apigateway":   regional(discoverAPIGateway),
			"apigatewayv2": regional(discoverAPIGatewayV2),
			"events":       regional(discoverEventBridge),
			"logs":         regional(discoverLogs),
			"iam":          discoverIAM,
		},
	}
}

// Account returns the Floci account id.
func (d *Discoverer) Account() string { return d.account }

// Registry returns the service registry.
func (d *Discoverer) Registry() *services.Registry { return d.registry }

// Supports reports whether a service has resource discovery.
func (d *Discoverer) Supports(service string) bool {
	_, ok := d.byID[service]
	return ok
}

// Query selects and filters resources. Empty fields match everything.
type Query struct {
	Region  string
	Service string
	Type    string
	Text    string // matches name, ARN, type, service, tag keys and values
	Tag     string // "key=value" or "key"
}

// Discover lists resources matching the query. Services are scanned
// concurrently; failures of one service are reported in List.Errors.
func (d *Discoverer) Discover(ctx context.Context, query Query) List {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	regions := d.regions
	if query.Region != "" {
		regions = []string{query.Region}
	}
	serviceIDs := []string{}
	for _, def := range d.registry.All() {
		if _, ok := d.byID[def.ID]; ok && (query.Service == "" || query.Service == def.ID) {
			serviceIDs = append(serviceIDs, def.ID)
		}
	}

	var mu sync.Mutex
	var wg sync.WaitGroup
	list := List{Resources: []Resource{}, Errors: []ServiceError{}}
	for _, id := range serviceIDs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			found, err := d.byID[id](ctx, d, regions)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				d.logger.Warn("resource discovery failed", "service", id, "error", err)
				list.Errors = append(list.Errors, ServiceError{Service: id, Message: err.Error()})
			}
			list.Resources = append(list.Resources, found...)
		}()
	}
	wg.Wait()

	filtered := list.Resources[:0]
	for _, resource := range list.Resources {
		if matches(resource, query) {
			filtered = append(filtered, resource)
		}
	}
	list.Resources = filtered
	sort.Slice(list.Resources, func(i, j int) bool {
		a, b := list.Resources[i], list.Resources[j]
		if a.Service != b.Service {
			return a.Service < b.Service
		}
		if a.Type != b.Type {
			return a.Type < b.Type
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.Region < b.Region
	})
	sort.Slice(list.Errors, func(i, j int) bool { return list.Errors[i].Service < list.Errors[j].Service })
	list.Total = len(list.Resources)
	return list
}

func matches(resource Resource, query Query) bool {
	if query.Type != "" && !strings.EqualFold(resource.Type, query.Type) {
		return false
	}
	if query.Tag != "" {
		key, value, hasValue := strings.Cut(query.Tag, "=")
		found := false
		for _, tag := range resource.Tags {
			if strings.EqualFold(tag.Key, strings.TrimSpace(key)) && (!hasValue || tag.Value == strings.TrimSpace(value)) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	text := strings.ToLower(strings.TrimSpace(query.Text))
	if text == "" {
		return true
	}
	fields := []string{resource.Name, resource.ARN, resource.Type, resource.Service}
	for _, tag := range resource.Tags {
		fields = append(fields, tag.Key, tag.Value, tag.Key+"="+tag.Value)
	}
	for _, field := range fields {
		if strings.Contains(strings.ToLower(field), text) {
			return true
		}
	}
	return false
}

// regional adapts a per-region discovery function to scan several regions concurrently.
func regional(fn func(ctx context.Context, d *Discoverer, region string) ([]Resource, error)) discoverFunc {
	return func(ctx context.Context, d *Discoverer, regions []string) ([]Resource, error) {
		var mu sync.Mutex
		var wg sync.WaitGroup
		all := []Resource{}
		errs := []string{}
		for _, region := range regions {
			if region == GlobalRegion {
				continue
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				found, err := fn(ctx, d, region)
				mu.Lock()
				defer mu.Unlock()
				all = append(all, found...)
				if err != nil {
					errs = append(errs, fmt.Sprintf("%s: %v", region, err))
				}
			}()
		}
		wg.Wait()
		if len(errs) > 0 {
			sort.Strings(errs)
			return all, fmt.Errorf("%s", strings.Join(errs, "; "))
		}
		return all, nil
	}
}

// forEach runs fn for every item with bounded concurrency.
func forEach[T any](items []T, fn func(item T)) {
	const workers = 8
	semaphore := make(chan struct{}, workers)
	var wg sync.WaitGroup
	for _, item := range items {
		wg.Add(1)
		semaphore <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-semaphore }()
			fn(item)
		}()
	}
	wg.Wait()
}
