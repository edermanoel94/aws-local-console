// Package architecture builds the resource relationship graph of a region from
// real Floci state: event source mappings, SNS subscriptions, EventBridge rule
// targets, API Gateway integrations, S3 notifications, SQS dead-letter queues
// and Lambda environment variables that reference other resources.
package architecture

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"time"

	sdkaws "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/apigateway"
	"github.com/aws/aws-sdk-go-v2/service/apigatewayv2"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	"github.com/aws/aws-sdk-go-v2/service/lambda"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/edermanoel94/aws-local-console/backend/internal/audit"
	"github.com/edermanoel94/aws-local-console/backend/internal/resources"
	"github.com/edermanoel94/aws-local-console/backend/internal/services"
)

// Edge labels.
const (
	LabelEventSource  = "event source"
	LabelSubscription = "subscription"
	LabelRuleTarget   = "rule target"
	LabelRule         = "rule"
	LabelIntegration  = "integration"
	LabelNotification = "notification"
	LabelEnvReference = "env reference"
	LabelDeadLetter   = "dead-letter"
	LabelLogs         = "logs"
)

// Node is a resource in the graph (id = Resource.id).
type Node struct {
	ID      string `json:"id"`
	Service string `json:"service"`
	Type    string `json:"type"`
	Name    string `json:"name"`
	ARN     string `json:"arn"`
}

// Edge is a relationship between two nodes.
type Edge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label"`
}

// Graph is the ArchitectureGraph of CONTRACT section 3.
type Graph struct {
	Nodes  []Node                   `json:"nodes"`
	Edges  []Edge                   `json:"edges"`
	Errors []resources.ServiceError `json:"errors"`
}

// Builder builds graphs.
type Builder struct {
	discoverer *resources.Discoverer
	registry   *services.Registry
}

// NewBuilder returns a graph builder.
func NewBuilder(discoverer *resources.Discoverer) *Builder {
	return &Builder{discoverer: discoverer, registry: discoverer.Registry()}
}

// graph accumulates nodes and edges while resolving ARNs to nodes.
type graph struct {
	mu        sync.Mutex
	resources []resources.Resource
	byARN     map[string]string
	edges     map[string]Edge
}

func (g *graph) addEdge(source, target, label string) {
	if source == "" || target == "" || source == target {
		return
	}
	id := source + "->" + target + ":" + label
	g.mu.Lock()
	defer g.mu.Unlock()
	g.edges[id] = Edge{ID: id, Source: source, Target: target, Label: label}
}

// resolve maps an ARN (or queue URL) to a node id.
func (g *graph) resolve(arn string) string {
	if arn == "" {
		return ""
	}
	if id, ok := g.byARN[arn]; ok {
		return id
	}
	switch audit.ServiceFromARN(arn) {
	case "lambda":
		// Strip version/alias qualifiers: arn:aws:lambda:r:a:function:name:qualifier.
		parts := strings.Split(arn, ":")
		if len(parts) > 7 {
			return g.byARN[strings.Join(parts[:7], ":")]
		}
	case "dynamodb":
		// Stream ARN: arn:aws:dynamodb:r:a:table/name/stream/label.
		if index := strings.Index(arn, "/stream/"); index >= 0 {
			return g.byARN[arn[:index]]
		}
	}
	return ""
}

// Build returns the graph of a region.
func (b *Builder) Build(ctx context.Context, region string) Graph {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	list := b.discoverer.Discover(ctx, resources.Query{Region: region})
	g := &graph{byARN: map[string]string{}, edges: map[string]Edge{}}
	nodes := []Node{}
	for _, resource := range list.Resources {
		if resource.Region == resources.GlobalRegion {
			continue // IAM roles would connect to everything and hide the architecture
		}
		g.resources = append(g.resources, resource)
		nodes = append(nodes, Node{ID: resource.ID, Service: resource.Service, Type: resource.Type, Name: resource.Name, ARN: resource.ARN})
		if resource.ARN != "" {
			g.byARN[resource.ARN] = resource.ID
		}
		if queueURL, ok := resource.Attributes["url"].(string); ok {
			g.byARN[queueURL] = resource.ID
		}
	}

	collectors := []func(context.Context, *graph, string) error{
		b.eventSourceMappings,
		b.subscriptions,
		b.ruleTargets,
		b.restAPIIntegrations,
		b.httpAPIIntegrations,
		b.bucketNotifications,
		b.deadLetterQueues,
		b.environmentReferences,
		b.functionLogGroups,
	}
	var wg sync.WaitGroup
	var errMu sync.Mutex
	errs := append([]resources.ServiceError{}, list.Errors...)
	for _, collect := range collectors {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := collect(ctx, g, region); err != nil {
				errMu.Lock()
				errs = append(errs, resources.ServiceError{Service: "architecture", Message: err.Error()})
				errMu.Unlock()
			}
		}()
	}
	wg.Wait()

	edges := make([]Edge, 0, len(g.edges))
	for _, edge := range g.edges {
		edges = append(edges, edge)
	}
	sort.Slice(edges, func(i, j int) bool { return edges[i].ID < edges[j].ID })
	return Graph{Nodes: nodes, Edges: edges, Errors: errs}
}

func (g *graph) ofType(service, resourceType string) []resources.Resource {
	result := []resources.Resource{}
	for _, resource := range g.resources {
		if resource.Service == service && resource.Type == resourceType {
			result = append(result, resource)
		}
	}
	return result
}

func (b *Builder) eventSourceMappings(ctx context.Context, g *graph, region string) error {
	if len(g.ofType("lambda", "function")) == 0 {
		return nil
	}
	client := services.Typed[*lambda.Client](b.registry, "lambda", region)
	paginator := lambda.NewListEventSourceMappingsPaginator(client, &lambda.ListEventSourceMappingsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return err
		}
		for _, mapping := range page.EventSourceMappings {
			g.addEdge(g.resolve(sdkaws.ToString(mapping.EventSourceArn)), g.resolve(sdkaws.ToString(mapping.FunctionArn)), LabelEventSource)
		}
	}
	return nil
}

func (b *Builder) subscriptions(_ context.Context, g *graph, _ string) error {
	for _, topic := range g.ofType("sns", "topic") {
		subscriptions, _ := topic.Attributes["subscriptions"].([]map[string]any)
		for _, subscription := range subscriptions {
			endpoint, _ := subscription["endpoint"].(string)
			g.addEdge(topic.ID, g.resolve(endpoint), LabelSubscription)
		}
	}
	return nil
}

func (b *Builder) ruleTargets(ctx context.Context, g *graph, region string) error {
	client := services.Typed[*eventbridge.Client](b.registry, "events", region)
	buses := map[string]string{}
	for _, bus := range g.ofType("events", "event-bus") {
		buses[bus.Name] = bus.ID
	}
	var firstErr error
	var mu sync.Mutex
	rules := g.ofType("events", "rule")
	var wg sync.WaitGroup
	for _, rule := range rules {
		busName, _ := rule.Attributes["eventBusName"].(string)
		ruleName, _ := rule.Attributes["ruleName"].(string)
		g.addEdge(buses[busName], rule.ID, LabelRule)
		wg.Add(1)
		go func() {
			defer wg.Done()
			input := &eventbridge.ListTargetsByRuleInput{Rule: sdkaws.String(ruleName), EventBusName: sdkaws.String(busName)}
			for {
				page, err := client.ListTargetsByRule(ctx, input)
				if err != nil {
					mu.Lock()
					if firstErr == nil {
						firstErr = err
					}
					mu.Unlock()
					return
				}
				for _, target := range page.Targets {
					g.addEdge(rule.ID, g.resolve(sdkaws.ToString(target.Arn)), LabelRuleTarget)
				}
				if sdkaws.ToString(page.NextToken) == "" {
					return
				}
				input.NextToken = page.NextToken
			}
		}()
	}
	wg.Wait()
	return firstErr
}

// integrationTarget resolves API Gateway integration URIs:
// Lambda proxy (".../functions/{arn}/invocations"), a plain Lambda ARN, or an
// AWS service integration to SQS ("arn:aws:apigateway:{r}:sqs:path/{account}/{queue}").
func (g *graph) integrationTarget(uri, region, account string) string {
	if arn := audit.LambdaARNFromIntegrationURI(uri); arn != "" {
		return g.resolve(arn)
	}
	if strings.HasPrefix(uri, "arn:aws:lambda:") {
		return g.resolve(uri)
	}
	if _, path, ok := strings.Cut(uri, ":sqs:path/"); ok {
		parts := strings.Split(path, "/")
		if len(parts) >= 2 {
			return g.resolve("arn:aws:sqs:" + region + ":" + parts[0] + ":" + parts[1])
		}
	}
	return ""
}

var httpMethods = []string{"ANY", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}

func (b *Builder) restAPIIntegrations(ctx context.Context, g *graph, region string) error {
	client := services.Typed[*apigateway.Client](b.registry, "apigateway", region)
	var firstErr error
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, api := range g.ofType("apigateway", "restapi") {
		apiID, _ := api.Attributes["id"].(string)
		wg.Add(1)
		go func() {
			defer wg.Done()
			paginator := apigateway.NewGetResourcesPaginator(client, &apigateway.GetResourcesInput{RestApiId: sdkaws.String(apiID), Embed: []string{"methods"}})
			for paginator.HasMorePages() {
				page, err := paginator.NextPage(ctx)
				if err != nil {
					mu.Lock()
					if firstErr == nil {
						firstErr = err
					}
					mu.Unlock()
					return
				}
				for _, resource := range page.Items {
					methods := map[string]bool{}
					for httpMethod, method := range resource.ResourceMethods {
						if method.MethodIntegration != nil {
							g.addEdge(api.ID, g.integrationTarget(sdkaws.ToString(method.MethodIntegration.Uri), region, b.discoverer.Account()), LabelIntegration)
						} else {
							methods[httpMethod] = true
						}
					}
					// Floci does not return resourceMethods (not even with embed=methods),
					// so probe the integrations of every HTTP method.
					if len(resource.ResourceMethods) == 0 {
						for _, httpMethod := range httpMethods {
							methods[httpMethod] = true
						}
					}
					for httpMethod := range methods {
						integration, err := client.GetIntegration(ctx, &apigateway.GetIntegrationInput{
							RestApiId: sdkaws.String(apiID), ResourceId: resource.Id, HttpMethod: sdkaws.String(httpMethod),
						})
						if err == nil {
							g.addEdge(api.ID, g.integrationTarget(sdkaws.ToString(integration.Uri), region, b.discoverer.Account()), LabelIntegration)
						}
					}
				}
			}
		}()
	}
	wg.Wait()
	return firstErr
}

func (b *Builder) httpAPIIntegrations(ctx context.Context, g *graph, region string) error {
	apis := g.ofType("apigatewayv2", "api")
	if len(apis) == 0 {
		return nil
	}
	client := services.Typed[*apigatewayv2.Client](b.registry, "apigatewayv2", region)
	for _, api := range apis {
		apiID, _ := api.Attributes["id"].(string)
		page, err := client.GetIntegrations(ctx, &apigatewayv2.GetIntegrationsInput{ApiId: sdkaws.String(apiID)})
		if err != nil {
			return err
		}
		for _, integration := range page.Items {
			g.addEdge(api.ID, g.integrationTarget(sdkaws.ToString(integration.IntegrationUri), region, b.discoverer.Account()), LabelIntegration)
		}
	}
	return nil
}

func (b *Builder) bucketNotifications(ctx context.Context, g *graph, region string) error {
	client := services.Typed[*s3.Client](b.registry, "s3", region)
	defaultBus := g.resolve("arn:aws:events:" + region + ":" + b.discoverer.Account() + ":event-bus/default")
	var wg sync.WaitGroup
	for _, bucket := range g.ofType("s3", "bucket") {
		wg.Add(1)
		go func() {
			defer wg.Done()
			config, err := client.GetBucketNotificationConfiguration(ctx, &s3.GetBucketNotificationConfigurationInput{Bucket: sdkaws.String(bucket.Name)})
			if err != nil {
				return
			}
			for _, queue := range config.QueueConfigurations {
				g.addEdge(bucket.ID, g.resolve(sdkaws.ToString(queue.QueueArn)), LabelNotification)
			}
			for _, topic := range config.TopicConfigurations {
				g.addEdge(bucket.ID, g.resolve(sdkaws.ToString(topic.TopicArn)), LabelNotification)
			}
			for _, function := range config.LambdaFunctionConfigurations {
				g.addEdge(bucket.ID, g.resolve(sdkaws.ToString(function.LambdaFunctionArn)), LabelNotification)
			}
			if config.EventBridgeConfiguration != nil {
				g.addEdge(bucket.ID, defaultBus, LabelNotification)
			}
		}()
	}
	wg.Wait()
	return nil
}

func (b *Builder) deadLetterQueues(_ context.Context, g *graph, _ string) error {
	for _, queue := range g.ofType("sqs", "queue") {
		policy, _ := queue.Attributes["redrivePolicy"].(string)
		if policy == "" {
			continue
		}
		var redrive struct {
			DeadLetterTargetArn string `json:"deadLetterTargetArn"`
		}
		if json.Unmarshal([]byte(policy), &redrive) == nil {
			g.addEdge(queue.ID, g.resolve(redrive.DeadLetterTargetArn), LabelDeadLetter)
		}
	}
	return nil
}

// environmentReferences links a function to resources whose name, ARN or
// queue URL appears in one of its environment variables.
func (b *Builder) environmentReferences(_ context.Context, g *graph, _ string) error {
	for _, function := range g.ofType("lambda", "function") {
		variables, _ := function.Attributes["environment"].(map[string]string)
		for _, value := range variables {
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			for _, resource := range g.resources {
				if resource.ID == function.ID || resource.Type == "log-group" {
					continue
				}
				if referencesResource(value, resource) {
					g.addEdge(function.ID, resource.ID, LabelEnvReference)
				}
			}
		}
	}
	return nil
}

func referencesResource(value string, resource resources.Resource) bool {
	if value == resource.Name && len(resource.Name) >= 3 {
		return true
	}
	if resource.ARN != "" && strings.Contains(value, resource.ARN) {
		return true
	}
	if queueURL, ok := resource.Attributes["url"].(string); ok && strings.Contains(value, queueURL) {
		return true
	}
	return false
}

func (b *Builder) functionLogGroups(_ context.Context, g *graph, _ string) error {
	groups := map[string]string{}
	for _, group := range g.ofType("logs", "log-group") {
		groups[group.Name] = group.ID
	}
	for _, function := range g.ofType("lambda", "function") {
		g.addEdge(function.ID, groups["/aws/lambda/"+function.Name], LabelLogs)
	}
	return nil
}
