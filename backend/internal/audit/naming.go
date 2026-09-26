package audit

import (
	"fmt"
	"strings"
)

// lookup returns the string at a dotted path inside JSON-like data
// ("TableDescription.TableArn"); list indexes are not supported.
func lookup(data map[string]any, path string) string {
	var current any = data
	for _, part := range strings.Split(path, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current = object[part]
	}
	if text, ok := current.(string); ok {
		return text
	}
	return ""
}

func first(data map[string]any, paths ...string) string {
	for _, path := range paths {
		if value := lookup(data, path); value != "" {
			return value
		}
	}
	return ""
}

func asMap(value any) map[string]any {
	if object, ok := value.(map[string]any); ok {
		return object
	}
	return map[string]any{}
}

func asList(value any) []any {
	if list, ok := value.([]any); ok {
		return list
	}
	return nil
}

// NameFromARN extracts the resource name of an ARN:
// arn:aws:sns:r:a:topic -> topic, arn:aws:lambda:r:a:function:f[:qualifier] -> f,
// arn:aws:events:r:a:rule/bus/name -> name, arn:aws:s3:::bucket -> bucket,
// arn:aws:dynamodb:r:a:table/t/stream/x -> t.
func NameFromARN(arn string) string {
	parts := strings.SplitN(arn, ":", 6)
	if len(parts) < 6 || parts[0] != "arn" {
		return arn
	}
	service, resource := parts[2], parts[5]
	switch service {
	case "lambda":
		// function:name[:qualifier]
		segments := strings.Split(resource, ":")
		if len(segments) >= 2 {
			return segments[1]
		}
	case "dynamodb":
		segments := strings.Split(resource, "/")
		if len(segments) >= 2 {
			return segments[1]
		}
	case "logs":
		// log-group:name[:*]
		name := strings.TrimPrefix(resource, "log-group:")
		return strings.TrimSuffix(name, ":*")
	case "sns":
		// topic or topic:subscription-id
		name, _, _ := strings.Cut(resource, ":")
		return name
	case "apigateway":
		// /restapis/{id}[/...]
		segments := strings.Split(strings.TrimPrefix(resource, "/"), "/")
		if len(segments) >= 2 {
			return segments[1]
		}
	}
	if index := strings.LastIndex(resource, "/"); index >= 0 {
		return resource[index+1:]
	}
	if index := strings.LastIndex(resource, ":"); index >= 0 {
		return resource[index+1:]
	}
	return resource
}

// ServiceFromARN returns the console service id of an ARN ("events", "sqs", ...).
func ServiceFromARN(arn string) string {
	parts := strings.SplitN(arn, ":", 4)
	if len(parts) < 3 || parts[0] != "arn" {
		return ""
	}
	return parts[2]
}

// NameFromQueueURL returns the queue name of an SQS queue URL.
func NameFromQueueURL(url string) string {
	url = strings.TrimRight(url, "/")
	if index := strings.LastIndex(url, "/"); index >= 0 {
		return url[index+1:]
	}
	return url
}

// shorten turns ARNs and queue URLs into plain names.
func shorten(value string) string {
	switch {
	case strings.HasPrefix(value, "arn:"):
		return NameFromARN(value)
	case strings.HasPrefix(value, "http://"), strings.HasPrefix(value, "https://"):
		return NameFromQueueURL(value)
	}
	return value
}

// ResourceName extracts the primary resource name of an operation, best effort.
func ResourceName(service, operation string, input, output map[string]any) string {
	var name string
	switch service {
	case "s3":
		name = first(input, "Bucket")
	case "sqs":
		name = first(input, "QueueName", "QueueUrl")
	case "sns":
		name = first(input, "Name", "TopicArn", "TargetArn", "SubscriptionArn", "ResourceArn")
		if name == "" {
			name = first(output, "TopicArn")
		}
	case "dynamodb":
		name = first(input, "TableName", "ResourceArn")
		if name == "" {
			for table := range asMap(input["RequestItems"]) {
				name = table
				break
			}
		}
	case "lambda":
		name = first(input, "FunctionName", "Resource")
		if name == "" {
			name = first(output, "FunctionName")
		}
	case "apigateway":
		name = first(input, "Name", "RestApiId")
	case "apigatewayv2":
		name = first(input, "Name", "ApiId")
	case "events":
		name = first(input, "Name", "Rule", "EventBusName", "ResourceARN")
		if name == "" && operation == "PutEvents" {
			for _, entry := range asList(input["Entries"]) {
				if bus := lookup(asMap(entry), "EventBusName"); bus != "" {
					name = bus
					break
				}
			}
			if name == "" {
				name = "default"
			}
		}
	case "logs":
		name = first(input, "LogGroupName", "logGroupName", "LogGroupIdentifier")
	case "iam":
		name = first(input, "RoleName", "UserName", "GroupName", "PolicyName", "InstanceProfileName", "PolicyArn")
	}
	if name == "" {
		name = first(input, "Name", "Bucket", "QueueName", "TableName", "FunctionName", "ResourceArn", "Arn")
	}
	return shorten(name)
}

// ResourceARN computes or extracts the ARN of the primary resource.
func ResourceARN(service, region, account, name string, input, output map[string]any) string {
	if name == "" {
		return ""
	}
	switch service {
	case "s3":
		return "arn:aws:s3:::" + name
	case "sqs":
		return fmt.Sprintf("arn:aws:sqs:%s:%s:%s", region, account, name)
	case "sns":
		if arn := first(input, "TopicArn"); arn != "" {
			return arn
		}
		if arn := first(output, "TopicArn"); arn != "" {
			return arn
		}
		return fmt.Sprintf("arn:aws:sns:%s:%s:%s", region, account, name)
	case "dynamodb":
		if arn := first(output, "TableDescription.TableArn"); arn != "" {
			return arn
		}
		return fmt.Sprintf("arn:aws:dynamodb:%s:%s:table/%s", region, account, name)
	case "lambda":
		if arn := first(output, "FunctionArn"); arn != "" {
			return arn
		}
		return fmt.Sprintf("arn:aws:lambda:%s:%s:function:%s", region, account, name)
	case "events":
		if arn := first(output, "RuleArn", "EventBusArn"); arn != "" {
			return arn
		}
		bus := first(input, "EventBusName")
		if rule := first(input, "Rule"); rule != "" {
			return RuleARN(region, account, bus, rule)
		}
		if bus == "" {
			bus = name
		}
		return fmt.Sprintf("arn:aws:events:%s:%s:event-bus/%s", region, account, shorten(bus))
	case "logs":
		return fmt.Sprintf("arn:aws:logs:%s:%s:log-group:%s", region, account, name)
	case "apigateway":
		id := first(output, "Id")
		if id == "" {
			id = first(input, "RestApiId", "restApiId")
		}
		if id == "" {
			return ""
		}
		return fmt.Sprintf("arn:aws:apigateway:%s::/restapis/%s", region, id)
	case "iam":
		if arn := first(output, "Role.Arn", "User.Arn", "Policy.Arn", "Group.Arn"); arn != "" {
			return arn
		}
	}
	return ""
}

// RuleARN builds an EventBridge rule ARN (rules on custom buses include the bus name).
func RuleARN(region, account, bus, rule string) string {
	bus = shorten(bus)
	if bus == "" || bus == "default" {
		return fmt.Sprintf("arn:aws:events:%s:%s:rule/%s", region, account, rule)
	}
	return fmt.Sprintf("arn:aws:events:%s:%s:rule/%s/%s", region, account, bus, rule)
}
