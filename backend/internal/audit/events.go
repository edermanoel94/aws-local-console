package audit

import (
	"strings"
)

// Event types.
const (
	EventResourceCreated     = "ResourceCreated"
	EventResourceDeleted     = "ResourceDeleted"
	EventResourceUpdated     = "ResourceUpdated"
	EventObjectUploaded      = "ObjectUploaded"
	EventObjectDeleted       = "ObjectDeleted"
	EventMessageSent         = "MessageSent"
	EventMessageDeleted      = "MessageDeleted"
	EventQueuePurged         = "QueuePurged"
	EventMessagePublished    = "MessagePublished"
	EventSubscriptionCreated = "SubscriptionCreated"
	EventSubscriptionDeleted = "SubscriptionDeleted"
	EventItemWritten         = "ItemWritten"
	EventItemDeleted         = "ItemDeleted"
	EventFunctionInvoked     = "FunctionInvoked"
	EventTargetsAdded        = "TargetsAdded"
	EventTargetsRemoved      = "TargetsRemoved"
	EventEventPublished      = "EventPublished"
	EventAPIDeployed         = "ApiDeployed"
	EventAPIInvoked          = "ApiInvoked"
	EventLogEventsWritten    = "LogEventsWritten"
)

var specialEventTypes = map[string]string{
	"s3.PutObject":                EventObjectUploaded,
	"s3.CopyObject":               EventObjectUploaded,
	"s3.CompleteMultipartUpload":  EventObjectUploaded,
	"s3.DeleteObject":             EventObjectDeleted,
	"s3.DeleteObjects":            EventObjectDeleted,
	"sqs.SendMessage":             EventMessageSent,
	"sqs.SendMessageBatch":        EventMessageSent,
	"sqs.DeleteMessage":           EventMessageDeleted,
	"sqs.DeleteMessageBatch":      EventMessageDeleted,
	"sqs.PurgeQueue":              EventQueuePurged,
	"sns.Publish":                 EventMessagePublished,
	"sns.PublishBatch":            EventMessagePublished,
	"sns.Subscribe":               EventSubscriptionCreated,
	"sns.Unsubscribe":             EventSubscriptionDeleted,
	"dynamodb.PutItem":            EventItemWritten,
	"dynamodb.UpdateItem":         EventItemWritten,
	"dynamodb.BatchWriteItem":     EventItemWritten,
	"dynamodb.TransactWriteItems": EventItemWritten,
	"dynamodb.DeleteItem":         EventItemDeleted,
	"lambda.Invoke":               EventFunctionInvoked,
	"lambda.InvokeAsync":          EventFunctionInvoked,
	"events.PutRule":              EventResourceCreated,
	"events.PutTargets":           EventTargetsAdded,
	"events.RemoveTargets":        EventTargetsRemoved,
	"events.PutEvents":            EventEventPublished,
	"apigateway.CreateDeployment": EventAPIDeployed,
	"apigateway.Invoke":           EventAPIInvoked,
	"logs.PutLogEvents":           EventLogEventsWritten,
}

// eventType returns the event type for a successful mutating operation.
func eventType(service, operation string) string {
	if special, ok := specialEventTypes[service+"."+operation]; ok {
		return special
	}
	switch {
	case strings.HasPrefix(operation, "Create"):
		return EventResourceCreated
	case strings.HasPrefix(operation, "Delete"):
		return EventResourceDeleted
	}
	return EventResourceUpdated
}

// deriveEvent builds the ResourceEvent for a successful mutating operation.
func deriveEvent(entry LogEntry, account string) ResourceEvent {
	input := entry.Request.Input
	output := asMap(entry.Response.Output)
	event := ResourceEvent{
		ID:           NewID("evt_"),
		Timestamp:    entry.Timestamp,
		Service:      entry.Service,
		Type:         eventType(entry.Service, entry.Operation),
		Operation:    entry.Operation,
		Region:       entry.Region,
		ResourceName: entry.ResourceName,
		LogID:        entry.ID,
		Related:      []RelatedResource{},
		Detail:       map[string]any{"source": entry.Source},
	}
	event.ResourceARN = ResourceARN(entry.Service, entry.Region, account, entry.ResourceName, input, output)

	related := func(arn string) {
		if arn == "" {
			return
		}
		event.Related = append(event.Related, RelatedResource{Service: ServiceFromARN(arn), Name: NameFromARN(arn), ARN: arn})
	}
	detail := func(key string, value any) {
		if value != nil && value != "" {
			event.Detail[key] = value
		}
	}

	switch entry.Service + "." + entry.Operation {
	case "s3.PutObject", "s3.CopyObject", "s3.DeleteObject", "s3.CompleteMultipartUpload":
		detail("key", input["Key"])
		detail("contentType", input["ContentType"])
		detail("eTag", output["ETag"])
		detail("versionId", output["VersionId"])
		detail("copySource", input["CopySource"])
	case "s3.DeleteObjects":
		keys := []any{}
		for _, object := range asList(asMap(input["Delete"])["Objects"]) {
			keys = append(keys, asMap(object)["Key"])
		}
		detail("keys", keys)
	case "s3.PutBucketNotificationConfiguration":
		config := asMap(input["NotificationConfiguration"])
		for _, item := range asList(config["QueueConfigurations"]) {
			related(lookup(asMap(item), "QueueArn"))
		}
		for _, item := range asList(config["TopicConfigurations"]) {
			related(lookup(asMap(item), "TopicArn"))
		}
		for _, item := range asList(config["LambdaFunctionConfigurations"]) {
			related(lookup(asMap(item), "LambdaFunctionArn"))
		}
		if _, ok := config["EventBridgeConfiguration"]; ok {
			related(RuleBusARN(entry.Region, account, "default"))
		}
	case "sqs.SendMessage":
		detail("messageId", output["MessageId"])
		detail("messageBody", input["MessageBody"])
	case "sqs.SendMessageBatch":
		detail("successful", len(asList(output["Successful"])))
		detail("failed", len(asList(output["Failed"])))
	case "sns.Publish":
		detail("messageId", output["MessageId"])
		detail("subject", input["Subject"])
		detail("message", input["Message"])
		related(first(input, "TargetArn"))
	case "sns.Subscribe":
		related(first(input, "TopicArn"))
		endpoint := first(input, "Endpoint")
		protocol := first(input, "Protocol")
		detail("protocol", protocol)
		detail("subscriptionArn", output["SubscriptionArn"])
		if strings.HasPrefix(endpoint, "arn:") {
			related(endpoint)
		} else if endpoint != "" {
			event.Related = append(event.Related, RelatedResource{Service: protocol, Name: endpoint})
		}
	case "dynamodb.PutItem", "dynamodb.DeleteItem", "dynamodb.UpdateItem":
		detail("key", input["Key"])
		detail("item", input["Item"])
	case "lambda.Invoke":
		detail("statusCode", output["StatusCode"])
		detail("functionError", output["FunctionError"])
		detail("executedVersion", output["ExecutedVersion"])
	case "lambda.CreateEventSourceMapping", "lambda.UpdateEventSourceMapping", "lambda.DeleteEventSourceMapping":
		source := first(input, "EventSourceArn")
		if source == "" {
			source = first(output, "EventSourceArn")
		}
		related(source)
		function := first(output, "FunctionArn")
		if function == "" {
			function = first(input, "FunctionName")
		}
		if strings.HasPrefix(function, "arn:") {
			related(function)
		} else if function != "" {
			event.Related = append(event.Related, RelatedResource{Service: "lambda", Name: function})
		}
		detail("uuid", output["UUID"])
		// The primary resource of a mapping is the function it feeds.
		if name := shorten(function); name != "" {
			event.ResourceName = name
			event.ResourceARN = ResourceARN("lambda", entry.Region, account, name, nil, nil)
		}
	case "apigateway.PutIntegration":
		if function := LambdaARNFromIntegrationURI(first(input, "Uri")); function != "" {
			related(function)
		}
		detail("type", input["Type"])
		detail("uri", input["Uri"])
	case "apigateway.CreateDeployment":
		detail("stageName", input["StageName"])
		detail("deploymentId", output["Id"])
	case "apigateway.Invoke":
		detail("method", input["method"])
		detail("path", input["path"])
		detail("stage", input["stage"])
		detail("status", output["status"])
	case "events.PutTargets", "events.RemoveTargets":
		bus := first(input, "EventBusName")
		related(RuleARN(entry.Region, account, bus, first(input, "Rule")))
		for _, target := range asList(input["Targets"]) {
			related(lookup(asMap(target), "Arn"))
		}
		detail("ids", input["Ids"])
	case "events.PutEvents":
		entries := asList(input["Entries"])
		sources, detailTypes := []any{}, []any{}
		buses := map[string]bool{}
		for _, item := range entries {
			item := asMap(item)
			sources = append(sources, item["Source"])
			detailTypes = append(detailTypes, item["DetailType"])
			bus := lookup(item, "EventBusName")
			if bus == "" {
				bus = "default"
			}
			if !buses[bus] {
				buses[bus] = true
				arn := bus
				if !strings.HasPrefix(bus, "arn:") {
					arn = RuleBusARN(entry.Region, account, bus)
				}
				related(arn)
			}
		}
		detail("entries", len(entries))
		detail("sources", sources)
		detail("detailTypes", detailTypes)
		detail("failedEntryCount", output["FailedEntryCount"])
	}
	return event
}

// RuleBusARN builds an EventBridge event bus ARN.
func RuleBusARN(region, account, bus string) string {
	return "arn:aws:events:" + region + ":" + account + ":event-bus/" + bus
}

// LambdaARNFromIntegrationURI extracts the function ARN of an API Gateway
// Lambda integration URI:
// arn:aws:apigateway:{region}:lambda:path/2015-03-31/functions/{functionArn}/invocations.
func LambdaARNFromIntegrationURI(uri string) string {
	_, rest, ok := strings.Cut(uri, "/functions/")
	if !ok {
		return ""
	}
	arn, _, _ := strings.Cut(rest, "/invocations")
	if !strings.HasPrefix(arn, "arn:aws:lambda:") {
		return ""
	}
	return arn
}
