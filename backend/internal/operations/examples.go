package operations

import (
	"reflect"
	"strings"
	"time"
)

// Placeholder resource names used by examples. They are consistent across
// operations so that examples can be chained (create queue, then send to it).
const (
	exampleAccount  = "000000000000"
	exampleRegion   = "us-east-1"
	exampleQueueURL = "http://localhost:4566/" + exampleAccount + "/my-queue"
	exampleQueueARN = "arn:aws:sqs:" + exampleRegion + ":" + exampleAccount + ":my-queue"
	exampleTopicARN = "arn:aws:sns:" + exampleRegion + ":" + exampleAccount + ":my-topic"
	exampleFunction = "arn:aws:lambda:" + exampleRegion + ":" + exampleAccount + ":function:my-function"
	exampleRoleARN  = "arn:aws:iam::" + exampleAccount + ":role/lambda-role"
	exampleLambdaJS = "export const handler = async (event) => {\n  console.log('event', JSON.stringify(event));\n  return { statusCode: 200, body: JSON.stringify({ message: 'Hello from Lambda', input: event }) };\n};\n"
)

type object = map[string]any

func dynamoKey() object { return object{"pk": object{"S": "item-1"}} }

// curatedExamples are hand-written inputs for the most common operations.
var curatedExamples = map[string]object{
	// S3
	"s3.CreateBucket":  {"Bucket": "my-bucket"},
	"s3.DeleteBucket":  {"Bucket": "my-bucket"},
	"s3.HeadBucket":    {"Bucket": "my-bucket"},
	"s3.ListObjectsV2": {"Bucket": "my-bucket"},
	"s3.ListObjects":   {"Bucket": "my-bucket"},
	"s3.PutObject": {
		"Bucket": "my-bucket", "Key": "hello.txt",
		"Body": "Hello from AWS Local Console", "ContentType": "text/plain",
	},
	"s3.GetObject":    {"Bucket": "my-bucket", "Key": "hello.txt"},
	"s3.HeadObject":   {"Bucket": "my-bucket", "Key": "hello.txt"},
	"s3.DeleteObject": {"Bucket": "my-bucket", "Key": "hello.txt"},
	"s3.CopyObject":   {"Bucket": "my-bucket", "Key": "hello-copy.txt", "CopySource": "my-bucket/hello.txt"},
	"s3.PutBucketTagging": {
		"Bucket":  "my-bucket",
		"Tagging": object{"TagSet": []any{object{"Key": "env", "Value": "local"}}},
	},
	"s3.PutBucketVersioning": {
		"Bucket": "my-bucket", "VersioningConfiguration": object{"Status": "Enabled"},
	},
	"s3.PutObjectTagging": {
		"Bucket": "my-bucket", "Key": "hello.txt",
		"Tagging": object{"TagSet": []any{object{"Key": "env", "Value": "local"}}},
	},
	"s3.PutBucketNotificationConfiguration": {
		"Bucket": "my-bucket",
		"NotificationConfiguration": object{
			"EventBridgeConfiguration": object{},
			"QueueConfigurations": []any{object{
				"QueueArn": exampleQueueARN, "Events": []any{"s3:ObjectCreated:*"},
			}},
		},
	},
	"s3.GetBucketNotificationConfiguration": {"Bucket": "my-bucket"},

	// SQS
	"sqs.CreateQueue": {"QueueName": "my-queue", "Attributes": object{"VisibilityTimeout": "30"}},
	"sqs.GetQueueUrl": {"QueueName": "my-queue"},
	"sqs.DeleteQueue": {"QueueUrl": exampleQueueURL},
	"sqs.PurgeQueue":  {"QueueUrl": exampleQueueURL},
	"sqs.SendMessage": {"QueueUrl": exampleQueueURL, "MessageBody": "Hello from AWS Local Console"},
	"sqs.ReceiveMessage": {
		"QueueUrl": exampleQueueURL, "MaxNumberOfMessages": 10, "WaitTimeSeconds": 1,
		"MessageSystemAttributeNames": []any{"All"}, "MessageAttributeNames": []any{"All"},
	},
	"sqs.DeleteMessage":      {"QueueUrl": exampleQueueURL, "ReceiptHandle": "receipt-handle-from-ReceiveMessage"},
	"sqs.GetQueueAttributes": {"QueueUrl": exampleQueueURL, "AttributeNames": []any{"All"}},
	"sqs.SetQueueAttributes": {"QueueUrl": exampleQueueURL, "Attributes": object{"VisibilityTimeout": "60"}},
	"sqs.TagQueue":           {"QueueUrl": exampleQueueURL, "Tags": object{"env": "local"}},

	// SNS
	"sns.CreateTopic": {"Name": "my-topic"},
	"sns.DeleteTopic": {"TopicArn": exampleTopicARN},
	"sns.Publish":     {"TopicArn": exampleTopicARN, "Subject": "Greeting", "Message": "Hello from AWS Local Console"},
	"sns.Subscribe": {
		"TopicArn": exampleTopicARN, "Protocol": "sqs", "Endpoint": exampleQueueARN,
		"ReturnSubscriptionArn": true,
	},
	"sns.ListSubscriptionsByTopic": {"TopicArn": exampleTopicARN},
	"sns.GetTopicAttributes":       {"TopicArn": exampleTopicARN},

	// DynamoDB
	"dynamodb.CreateTable": {
		"TableName":            "my-table",
		"AttributeDefinitions": []any{object{"AttributeName": "pk", "AttributeType": "S"}},
		"KeySchema":            []any{object{"AttributeName": "pk", "KeyType": "HASH"}},
		"BillingMode":          "PAY_PER_REQUEST",
	},
	"dynamodb.DescribeTable": {"TableName": "my-table"},
	"dynamodb.DeleteTable":   {"TableName": "my-table"},
	"dynamodb.PutItem": {
		"TableName": "my-table",
		"Item":      object{"pk": object{"S": "item-1"}, "message": object{"S": "Hello"}, "count": object{"N": "1"}},
	},
	"dynamodb.GetItem":    {"TableName": "my-table", "Key": dynamoKey()},
	"dynamodb.DeleteItem": {"TableName": "my-table", "Key": dynamoKey()},
	"dynamodb.UpdateItem": {
		"TableName": "my-table", "Key": dynamoKey(),
		"UpdateExpression":          "SET message = :message",
		"ExpressionAttributeValues": object{":message": object{"S": "Updated"}},
		"ReturnValues":              "ALL_NEW",
	},
	"dynamodb.Query": {
		"TableName":                 "my-table",
		"KeyConditionExpression":    "pk = :pk",
		"ExpressionAttributeValues": object{":pk": object{"S": "item-1"}},
	},
	"dynamodb.Scan": {"TableName": "my-table"},

	// Lambda
	"lambda.CreateFunction": {
		"FunctionName": "my-function",
		"Runtime":      "nodejs20.x",
		"Role":         exampleRoleARN,
		"Handler":      "index.handler",
		"Code":         object{"ZipFile": object{"zipFiles": object{"index.mjs": exampleLambdaJS}}},
		"Environment":  object{"Variables": object{"TABLE_NAME": "my-table"}},
		"Timeout":      30,
	},
	"lambda.GetFunction":    {"FunctionName": "my-function"},
	"lambda.DeleteFunction": {"FunctionName": "my-function"},
	"lambda.Invoke":         {"FunctionName": "my-function", "Payload": "{\"hello\":\"world\"}", "LogType": "Tail"},
	"lambda.UpdateFunctionCode": {
		"FunctionName": "my-function",
		"ZipFile":      object{"zipFiles": object{"index.mjs": exampleLambdaJS}},
	},
	"lambda.UpdateFunctionConfiguration": {
		"FunctionName": "my-function",
		"Environment":  object{"Variables": object{"TABLE_NAME": "my-table"}},
	},
	"lambda.CreateEventSourceMapping": {
		"FunctionName": "my-function", "EventSourceArn": exampleQueueARN, "BatchSize": 10,
	},

	// API Gateway
	"apigateway.CreateRestApi": {"Name": "my-api", "Description": "Created from AWS Local Console"},
	"apigateway.GetResources":  {"RestApiId": "rest-api-id"},
	"apigateway.CreateResource": {
		"RestApiId": "rest-api-id", "ParentId": "root-resource-id", "PathPart": "hello",
	},
	"apigateway.PutMethod": {
		"RestApiId": "rest-api-id", "ResourceId": "resource-id", "HttpMethod": "GET", "AuthorizationType": "NONE",
	},
	"apigateway.PutIntegration": {
		"RestApiId": "rest-api-id", "ResourceId": "resource-id", "HttpMethod": "GET",
		"Type": "AWS_PROXY", "IntegrationHttpMethod": "POST",
		"Uri": "arn:aws:apigateway:" + exampleRegion + ":lambda:path/2015-03-31/functions/" + exampleFunction + "/invocations",
	},
	"apigateway.CreateDeployment": {"RestApiId": "rest-api-id", "StageName": "dev"},
	"apigateway.DeleteRestApi":    {"RestApiId": "rest-api-id"},

	// EventBridge
	"events.CreateEventBus": {"Name": "my-bus"},
	"events.DeleteEventBus": {"Name": "my-bus"},
	"events.PutRule": {
		"Name": "my-rule", "EventBusName": "default", "State": "ENABLED",
		"EventPattern": "{\"source\":[\"my.app\"]}",
	},
	"events.PutTargets": {
		"Rule": "my-rule", "EventBusName": "default",
		"Targets": []any{object{"Id": "my-queue", "Arn": exampleQueueARN}},
	},
	"events.ListTargetsByRule": {"Rule": "my-rule", "EventBusName": "default"},
	"events.PutEvents": {
		"Entries": []any{object{
			"EventBusName": "default", "Source": "my.app", "DetailType": "OrderCreated",
			"Detail": "{\"orderId\":\"123\"}",
		}},
	},
	"events.DeleteRule": {"Name": "my-rule", "EventBusName": "default"},

	// CloudWatch Logs
	"logs.CreateLogGroup":    {"LogGroupName": "/my-app/local"},
	"logs.DeleteLogGroup":    {"LogGroupName": "/my-app/local"},
	"logs.DescribeLogGroups": {},
	"logs.DescribeLogStreams": {
		"LogGroupName": "/aws/lambda/my-function", "OrderBy": "LastEventTime", "Descending": true,
	},
	"logs.FilterLogEvents": {"LogGroupName": "/aws/lambda/my-function", "Limit": 100},

	// IAM
	"iam.CreateRole": {
		"RoleName":                 "lambda-role",
		"AssumeRolePolicyDocument": "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"lambda.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]}",
	},
	"iam.GetRole":    {"RoleName": "lambda-role"},
	"iam.DeleteRole": {"RoleName": "lambda-role"},
}

// placeholderByField gives realistic values for common required members.
var placeholderByField = map[string]any{
	"Bucket":              "my-bucket",
	"Key":                 "hello.txt",
	"QueueUrl":            exampleQueueURL,
	"QueueName":           "my-queue",
	"TopicArn":            exampleTopicARN,
	"TargetArn":           exampleTopicARN,
	"SubscriptionArn":     exampleTopicARN + ":subscription-id",
	"TableName":           "my-table",
	"FunctionName":        "my-function",
	"RestApiId":           "rest-api-id",
	"ResourceId":          "resource-id",
	"StageName":           "dev",
	"HttpMethod":          "GET",
	"ApiId":               "api-id",
	"EventBusName":        "default",
	"Rule":                "my-rule",
	"LogGroupName":        "/my-app/local",
	"LogStreamName":       "my-stream",
	"RoleName":            "lambda-role",
	"UserName":            "my-user",
	"GroupName":           "my-group",
	"PolicyArn":           "arn:aws:iam::" + exampleAccount + ":policy/my-policy",
	"Role":                exampleRoleARN,
	"ResourceArn":         exampleQueueARN,
	"ResourceARN":         exampleQueueARN,
	"EventSourceArn":      exampleQueueARN,
	"UUID":                "event-source-mapping-uuid",
	"ReceiptHandle":       "receipt-handle-from-ReceiveMessage",
	"MessageBody":         "Hello from AWS Local Console",
	"Message":             "Hello from AWS Local Console",
	"AccountId":           exampleAccount,
	"Region":              exampleRegion,
	"StatementId":         "allow-invoke",
	"Principal":           "apigateway.amazonaws.com",
	"Action":              "lambda:InvokeFunction",
	"Name":                "my-name",
	"Id":                  "my-id",
	"UploadId":            "upload-id",
	"ExpectedBucketOwner": exampleAccount,
}

// Example returns a sensible example input for the operation.
func (o *Operation) Example() map[string]any {
	if example, ok := curatedExamples[o.Service+"."+o.Name]; ok {
		return example
	}
	example := map[string]any{}
	for _, name := range o.Required {
		field, ok := o.inputType.FieldByName(name)
		if !ok {
			continue
		}
		example[name] = placeholder(name, field.Type)
	}
	return example
}

func placeholder(name string, t reflect.Type) any {
	if value, ok := placeholderByField[name]; ok && typeName(t, 0) == "string" {
		return value
	}
	if values := enumValues(t); len(values) > 0 {
		if t.Kind() == reflect.Slice {
			return []any{values[0]}
		}
		return values[0]
	}
	switch typeName(t, 0) {
	case "string":
		switch {
		case strings.HasSuffix(name, "Arn") || strings.HasSuffix(name, "ARN"):
			return "arn:aws:service:" + exampleRegion + ":" + exampleAccount + ":resource"
		case strings.HasSuffix(name, "Name"):
			return "my-" + strings.ToLower(strings.TrimSuffix(name, "Name"))
		}
		return "example"
	case "integer", "long":
		return 1
	case "double":
		return 1.0
	case "boolean":
		return false
	case "timestamp":
		return time.Now().UTC().Format(time.RFC3339)
	case "blob":
		return "example"
	}
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	switch t.Kind() {
	case reflect.Slice:
		return []any{}
	}
	return map[string]any{}
}
