// Package services is the service registry: metadata, resource types, UI
// capabilities and the SDK client constructor of every service the console
// exposes.
package services

import (
	"sort"

	sdkaws "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/apigateway"
	"github.com/aws/aws-sdk-go-v2/service/apigatewayv2"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	"github.com/aws/aws-sdk-go-v2/service/iam"
	"github.com/aws/aws-sdk-go-v2/service/lambda"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/sns"
	"github.com/aws/aws-sdk-go-v2/service/sqs"

	awsfloci "github.com/edermanoel/aws-dash-local/backend/internal/aws"
)

// Category groups services in the UI.
type Category string

// Service categories (CONTRACT section 3).
const (
	CategoryCompute                Category = "Compute"
	CategoryStorage                Category = "Storage"
	CategoryDatabase               Category = "Database"
	CategoryNetworking             Category = "Networking"
	CategorySecurity               Category = "Security"
	CategoryApplicationIntegration Category = "Application Integration"
	CategoryManagement             Category = "Management"
	CategoryAnalytics              Category = "Analytics"
)

// UI capabilities.
const (
	CapabilityConsole     = "console"
	CapabilityResources   = "resources"
	CapabilityAPIExplorer = "api-explorer"
)

// Definition describes one registered service.
type Definition struct {
	ID            string
	FlociID       string // key in Floci's /_floci/health services map
	Name          string
	ShortName     string
	Description   string
	Category      Category
	ResourceTypes []string
	Capabilities  []string
	// Global services (IAM) have a single endpoint and no regional resources.
	Global bool
	// NewClient builds the SDK client, e.g. s3.NewFromConfig.
	NewClient awsfloci.ClientBuilder
}

var consoleCapabilities = []string{CapabilityConsole, CapabilityResources, CapabilityAPIExplorer}
var explorerCapabilities = []string{CapabilityResources, CapabilityAPIExplorer}

var definitions = []Definition{
	{
		ID: "s3", FlociID: "s3", Name: "Amazon S3", ShortName: "S3",
		Description:   "Object storage built to store and retrieve any amount of data from anywhere.",
		Category:      CategoryStorage,
		ResourceTypes: []string{"bucket"},
		Capabilities:  consoleCapabilities,
		NewClient: func(cfg sdkaws.Config) any {
			return s3.NewFromConfig(cfg, func(o *s3.Options) {
				// Floci resolves itself as localhost.floci.io; virtual-host
				// addressing would require wildcard DNS, so use path style.
				o.UsePathStyle = true
			})
		},
	},
	{
		ID: "sqs", FlociID: "sqs", Name: "Amazon Simple Queue Service", ShortName: "SQS",
		Description:   "Fully managed message queues for microservices, distributed systems and serverless applications.",
		Category:      CategoryApplicationIntegration,
		ResourceTypes: []string{"queue"},
		Capabilities:  consoleCapabilities,
		NewClient:     func(cfg sdkaws.Config) any { return sqs.NewFromConfig(cfg) },
	},
	{
		ID: "sns", FlociID: "sns", Name: "Amazon Simple Notification Service", ShortName: "SNS",
		Description:   "Fully managed pub/sub messaging for application-to-application and application-to-person notifications.",
		Category:      CategoryApplicationIntegration,
		ResourceTypes: []string{"topic"},
		Capabilities:  consoleCapabilities,
		NewClient:     func(cfg sdkaws.Config) any { return sns.NewFromConfig(cfg) },
	},
	{
		ID: "dynamodb", FlociID: "dynamodb", Name: "Amazon DynamoDB", ShortName: "DynamoDB",
		Description:   "Serverless, fully managed NoSQL key-value and document database.",
		Category:      CategoryDatabase,
		ResourceTypes: []string{"table"},
		Capabilities:  consoleCapabilities,
		NewClient:     func(cfg sdkaws.Config) any { return dynamodb.NewFromConfig(cfg) },
	},
	{
		ID: "lambda", FlociID: "lambda", Name: "AWS Lambda", ShortName: "Lambda",
		Description:   "Run code without provisioning or managing servers.",
		Category:      CategoryCompute,
		ResourceTypes: []string{"function"},
		Capabilities:  consoleCapabilities,
		NewClient:     func(cfg sdkaws.Config) any { return lambda.NewFromConfig(cfg) },
	},
	{
		ID: "apigateway", FlociID: "apigateway", Name: "Amazon API Gateway", ShortName: "API Gateway",
		Description:   "Create, publish, maintain, monitor and secure REST APIs at any scale.",
		Category:      CategoryNetworking,
		ResourceTypes: []string{"restapi"},
		Capabilities:  consoleCapabilities,
		NewClient:     func(cfg sdkaws.Config) any { return apigateway.NewFromConfig(cfg) },
	},
	{
		ID: "apigatewayv2", FlociID: "apigatewayv2", Name: "Amazon API Gateway V2", ShortName: "API Gateway V2",
		Description:   "HTTP and WebSocket APIs with low latency and cost.",
		Category:      CategoryNetworking,
		ResourceTypes: []string{"api"},
		Capabilities:  explorerCapabilities,
		NewClient:     func(cfg sdkaws.Config) any { return apigatewayv2.NewFromConfig(cfg) },
	},
	{
		ID: "events", FlociID: "events", Name: "Amazon EventBridge", ShortName: "EventBridge",
		Description:   "Serverless event bus that connects application data from your own apps and AWS services.",
		Category:      CategoryApplicationIntegration,
		ResourceTypes: []string{"event-bus", "rule"},
		Capabilities:  consoleCapabilities,
		NewClient:     func(cfg sdkaws.Config) any { return eventbridge.NewFromConfig(cfg) },
	},
	{
		ID: "logs", FlociID: "logs", Name: "Amazon CloudWatch Logs", ShortName: "CloudWatch Logs",
		Description:   "Monitor, store and access log files from AWS resources and applications.",
		Category:      CategoryManagement,
		ResourceTypes: []string{"log-group"},
		Capabilities:  explorerCapabilities,
		NewClient:     func(cfg sdkaws.Config) any { return cloudwatchlogs.NewFromConfig(cfg) },
	},
	{
		ID: "iam", FlociID: "iam", Name: "AWS Identity and Access Management", ShortName: "IAM",
		Description:   "Securely manage identities and access to AWS services and resources.",
		Category:      CategorySecurity,
		ResourceTypes: []string{"role"},
		Capabilities:  explorerCapabilities,
		Global:        true,
		NewClient:     func(cfg sdkaws.Config) any { return iam.NewFromConfig(cfg) },
	},
}

// Registry resolves service definitions and their clients.
type Registry struct {
	factory *awsfloci.Factory
	byID    map[string]*Definition
	ordered []*Definition
}

// NewRegistry builds the registry.
func NewRegistry(factory *awsfloci.Factory) *Registry {
	r := &Registry{factory: factory, byID: map[string]*Definition{}}
	for i := range definitions {
		def := &definitions[i]
		r.byID[def.ID] = def
		r.ordered = append(r.ordered, def)
	}
	sort.SliceStable(r.ordered, func(i, j int) bool { return r.ordered[i].ID < r.ordered[j].ID })
	return r
}

// All returns every definition sorted by id.
func (r *Registry) All() []*Definition { return r.ordered }

// Get returns a definition by id.
func (r *Registry) Get(id string) (*Definition, bool) {
	def, ok := r.byID[id]
	return def, ok
}

// Client returns the (cached) SDK client of a service for a region.
func (r *Registry) Client(def *Definition, region string) any {
	return r.factory.Client(def.ID, region, def.NewClient)
}

// Typed returns the typed SDK client of a service for a region.
func Typed[T any](r *Registry, id, region string) T {
	def, ok := r.byID[id]
	if !ok {
		panic("services: unknown service " + id)
	}
	return r.Client(def, region).(T)
}
