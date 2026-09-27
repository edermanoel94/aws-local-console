package resources

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	sdkaws "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/apigateway"
	"github.com/aws/aws-sdk-go-v2/service/apigatewayv2"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	"github.com/aws/aws-sdk-go-v2/service/iam"
	"github.com/aws/aws-sdk-go-v2/service/lambda"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/aws-sdk-go-v2/service/sns"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"

	"github.com/edermanoel94/aws-local-console/backend/internal/services"
)

// S3 is a global namespace: buckets are listed once and assigned to their
// region through BucketRegion or GetBucketLocation.
func discoverS3(ctx context.Context, d *Discoverer, regions []string) ([]Resource, error) {
	client := services.Typed[*s3.Client](d.registry, "s3", "us-east-1")
	wanted := map[string]bool{}
	for _, region := range regions {
		wanted[region] = true
	}
	buckets := []s3types.Bucket{}
	paginator := s3.NewListBucketsPaginator(client, &s3.ListBucketsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		buckets = append(buckets, page.Buckets...)
	}

	var mu sync.Mutex
	result := []Resource{}
	forEach(buckets, func(bucket s3types.Bucket) {
		name := sdkaws.ToString(bucket.Name)
		region := sdkaws.ToString(bucket.BucketRegion)
		if region == "" {
			location, err := client.GetBucketLocation(ctx, &s3.GetBucketLocationInput{Bucket: bucket.Name})
			if err == nil {
				region = string(location.LocationConstraint)
			}
			if region == "" || region == "US" {
				region = "us-east-1"
			} else if region == "EU" {
				region = "eu-west-1"
			}
		}
		if !wanted[region] {
			return
		}
		regionClient := services.Typed[*s3.Client](d.registry, "s3", region)
		resource := newResource("s3", "bucket", region, name, "arn:aws:s3:::"+name)
		resource.CreatedAt = formatTime(bucket.CreationDate)
		resource.Attributes["region"] = region
		if tagging, err := regionClient.GetBucketTagging(ctx, &s3.GetBucketTaggingInput{Bucket: bucket.Name}); err == nil {
			for _, tag := range tagging.TagSet {
				resource.Tags = append(resource.Tags, Tag{Key: sdkaws.ToString(tag.Key), Value: sdkaws.ToString(tag.Value)})
			}
		}
		if versioning, err := regionClient.GetBucketVersioning(ctx, &s3.GetBucketVersioningInput{Bucket: bucket.Name}); err == nil && versioning.Status != "" {
			resource.Attributes["versioning"] = string(versioning.Status)
		}
		mu.Lock()
		result = append(result, resource)
		mu.Unlock()
	})
	return result, nil
}

func discoverSQS(ctx context.Context, d *Discoverer, region string) ([]Resource, error) {
	client := services.Typed[*sqs.Client](d.registry, "sqs", region)
	urls := []string{}
	paginator := sqs.NewListQueuesPaginator(client, &sqs.ListQueuesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		urls = append(urls, page.QueueUrls...)
	}
	var mu sync.Mutex
	result := []Resource{}
	forEach(urls, func(queueURL string) {
		name := queueURL[strings.LastIndex(queueURL, "/")+1:]
		resource := newResource("sqs", "queue", region, name, fmt.Sprintf("arn:aws:sqs:%s:%s:%s", region, d.account, name))
		resource.Attributes["url"] = queueURL
		attributes, err := client.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{
			QueueUrl: sdkaws.String(queueURL), AttributeNames: []sqstypes.QueueAttributeName{sqstypes.QueueAttributeNameAll},
		})
		if err == nil {
			for key, value := range attributes.Attributes {
				resource.Attributes[lowerFirst(key)] = value
			}
			if arn := attributes.Attributes["QueueArn"]; arn != "" {
				resource.ARN = arn
			}
			if created, err := strconv.ParseInt(attributes.Attributes["CreatedTimestamp"], 10, 64); err == nil {
				resource.CreatedAt = time.Unix(created, 0).UTC().Format(time.RFC3339)
			}
		}
		resource.Attributes["fifo"] = strings.HasSuffix(name, ".fifo")
		if tags, err := client.ListQueueTags(ctx, &sqs.ListQueueTagsInput{QueueUrl: sdkaws.String(queueURL)}); err == nil {
			resource.Tags = tagsFromMap(tags.Tags)
		}
		mu.Lock()
		result = append(result, resource)
		mu.Unlock()
	})
	return result, nil
}

func discoverSNS(ctx context.Context, d *Discoverer, region string) ([]Resource, error) {
	client := services.Typed[*sns.Client](d.registry, "sns", region)
	arns := []string{}
	paginator := sns.NewListTopicsPaginator(client, &sns.ListTopicsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, topic := range page.Topics {
			arns = append(arns, sdkaws.ToString(topic.TopicArn))
		}
	}
	var mu sync.Mutex
	result := []Resource{}
	forEach(arns, func(arn string) {
		name := arn[strings.LastIndex(arn, ":")+1:]
		resource := newResource("sns", "topic", region, name, arn)
		if attributes, err := client.GetTopicAttributes(ctx, &sns.GetTopicAttributesInput{TopicArn: sdkaws.String(arn)}); err == nil {
			for key, value := range attributes.Attributes {
				resource.Attributes[lowerFirst(key)] = value
			}
		}
		resource.Attributes["fifo"] = strings.HasSuffix(name, ".fifo")
		subscriptions := []map[string]any{}
		subscriptionPages := sns.NewListSubscriptionsByTopicPaginator(client, &sns.ListSubscriptionsByTopicInput{TopicArn: sdkaws.String(arn)})
		for subscriptionPages.HasMorePages() {
			page, err := subscriptionPages.NextPage(ctx)
			if err != nil {
				break
			}
			for _, subscription := range page.Subscriptions {
				subscriptions = append(subscriptions, map[string]any{
					"subscriptionArn": sdkaws.ToString(subscription.SubscriptionArn),
					"protocol":        sdkaws.ToString(subscription.Protocol),
					"endpoint":        sdkaws.ToString(subscription.Endpoint),
				})
			}
		}
		resource.Attributes["subscriptions"] = subscriptions
		if tags, err := client.ListTagsForResource(ctx, &sns.ListTagsForResourceInput{ResourceArn: sdkaws.String(arn)}); err == nil {
			for _, tag := range tags.Tags {
				resource.Tags = append(resource.Tags, Tag{Key: sdkaws.ToString(tag.Key), Value: sdkaws.ToString(tag.Value)})
			}
		}
		mu.Lock()
		result = append(result, resource)
		mu.Unlock()
	})
	return result, nil
}

func discoverDynamoDB(ctx context.Context, d *Discoverer, region string) ([]Resource, error) {
	client := services.Typed[*dynamodb.Client](d.registry, "dynamodb", region)
	names := []string{}
	paginator := dynamodb.NewListTablesPaginator(client, &dynamodb.ListTablesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		names = append(names, page.TableNames...)
	}
	var mu sync.Mutex
	result := []Resource{}
	forEach(names, func(name string) {
		resource := newResource("dynamodb", "table", region, name, fmt.Sprintf("arn:aws:dynamodb:%s:%s:table/%s", region, d.account, name))
		if described, err := client.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: sdkaws.String(name)}); err == nil && described.Table != nil {
			table := described.Table
			if arn := sdkaws.ToString(table.TableArn); arn != "" {
				resource.ARN = arn
			}
			resource.CreatedAt = formatTime(table.CreationDateTime)
			keySchema := []map[string]string{}
			for _, key := range table.KeySchema {
				keySchema = append(keySchema, map[string]string{"attributeName": sdkaws.ToString(key.AttributeName), "keyType": string(key.KeyType)})
			}
			attributeDefinitions := []map[string]string{}
			for _, definition := range table.AttributeDefinitions {
				attributeDefinitions = append(attributeDefinitions, map[string]string{"attributeName": sdkaws.ToString(definition.AttributeName), "attributeType": string(definition.AttributeType)})
			}
			resource.Attributes["status"] = string(table.TableStatus)
			resource.Attributes["keySchema"] = keySchema
			resource.Attributes["attributeDefinitions"] = attributeDefinitions
			resource.Attributes["itemCount"] = sdkaws.ToInt64(table.ItemCount)
			resource.Attributes["sizeBytes"] = sdkaws.ToInt64(table.TableSizeBytes)
			if table.BillingModeSummary != nil {
				resource.Attributes["billingMode"] = string(table.BillingModeSummary.BillingMode)
			}
			if table.LatestStreamArn != nil {
				resource.Attributes["streamArn"] = sdkaws.ToString(table.LatestStreamArn)
			}
			indexes := []string{}
			for _, index := range table.GlobalSecondaryIndexes {
				indexes = append(indexes, sdkaws.ToString(index.IndexName))
			}
			resource.Attributes["globalSecondaryIndexes"] = indexes
		}
		if tags, err := client.ListTagsOfResource(ctx, &dynamodb.ListTagsOfResourceInput{ResourceArn: sdkaws.String(resource.ARN)}); err == nil {
			for _, tag := range tags.Tags {
				resource.Tags = append(resource.Tags, Tag{Key: sdkaws.ToString(tag.Key), Value: sdkaws.ToString(tag.Value)})
			}
		}
		mu.Lock()
		result = append(result, resource)
		mu.Unlock()
	})
	return result, nil
}

func discoverLambda(ctx context.Context, d *Discoverer, region string) ([]Resource, error) {
	client := services.Typed[*lambda.Client](d.registry, "lambda", region)
	result := []Resource{}
	paginator := lambda.NewListFunctionsPaginator(client, &lambda.ListFunctionsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, function := range page.Functions {
			name := sdkaws.ToString(function.FunctionName)
			resource := newResource("lambda", "function", region, name, sdkaws.ToString(function.FunctionArn))
			attributes := resource.Attributes
			attributes["runtime"] = string(function.Runtime)
			attributes["handler"] = sdkaws.ToString(function.Handler)
			attributes["role"] = sdkaws.ToString(function.Role)
			attributes["memorySize"] = sdkaws.ToInt32(function.MemorySize)
			attributes["timeout"] = sdkaws.ToInt32(function.Timeout)
			attributes["codeSize"] = function.CodeSize
			attributes["lastModified"] = sdkaws.ToString(function.LastModified)
			attributes["state"] = string(function.State)
			attributes["packageType"] = string(function.PackageType)
			attributes["description"] = sdkaws.ToString(function.Description)
			variables := map[string]string{}
			if function.Environment != nil && function.Environment.Variables != nil {
				variables = function.Environment.Variables
			}
			attributes["environment"] = variables
			if lastModified, err := time.Parse("2006-01-02T15:04:05.000-0700", sdkaws.ToString(function.LastModified)); err == nil {
				attributes["lastModified"] = lastModified.UTC().Format(time.RFC3339)
			}
			result = append(result, resource)
		}
	}
	forEach(indexes(result), func(i int) {
		if tags, err := client.ListTags(ctx, &lambda.ListTagsInput{Resource: sdkaws.String(result[i].ARN)}); err == nil {
			result[i].Tags = tagsFromMap(tags.Tags)
		}
	})
	return result, nil
}

// InvokeURL is the Floci URL that executes a deployed REST API stage.
func InvokeURL(endpoint, restAPIID, stage string) string {
	return fmt.Sprintf("%s/restapis/%s/%s/_user_request_", strings.TrimRight(endpoint, "/"), restAPIID, stage)
}

func discoverAPIGateway(ctx context.Context, d *Discoverer, region string) ([]Resource, error) {
	client := services.Typed[*apigateway.Client](d.registry, "apigateway", region)
	result := []Resource{}
	paginator := apigateway.NewGetRestApisPaginator(client, &apigateway.GetRestApisInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, api := range page.Items {
			id := sdkaws.ToString(api.Id)
			resource := newResource("apigateway", "restapi", region, sdkaws.ToString(api.Name), fmt.Sprintf("arn:aws:apigateway:%s::/restapis/%s", region, id))
			resource.CreatedAt = formatTime(api.CreatedDate)
			resource.Tags = tagsFromMap(api.Tags)
			resource.Attributes["id"] = id
			resource.Attributes["description"] = sdkaws.ToString(api.Description)
			resource.Attributes["rootResourceId"] = sdkaws.ToString(api.RootResourceId)
			if api.EndpointConfiguration != nil && len(api.EndpointConfiguration.Types) > 0 {
				resource.Attributes["endpointType"] = string(api.EndpointConfiguration.Types[0])
			}
			result = append(result, resource)
		}
	}
	forEach(indexes(result), func(i int) {
		id := result[i].Attributes["id"].(string)
		stages := []map[string]any{}
		if found, err := client.GetStages(ctx, &apigateway.GetStagesInput{RestApiId: sdkaws.String(id)}); err == nil {
			for _, stage := range found.Item {
				name := sdkaws.ToString(stage.StageName)
				stages = append(stages, map[string]any{
					"stageName":    name,
					"deploymentId": sdkaws.ToString(stage.DeploymentId),
					"invokeUrl":    InvokeURL(sdkaws.ToString(client.Options().BaseEndpoint), id, name),
				})
			}
		}
		result[i].Attributes["stages"] = stages
	})
	return result, nil
}

func discoverAPIGatewayV2(ctx context.Context, d *Discoverer, region string) ([]Resource, error) {
	client := services.Typed[*apigatewayv2.Client](d.registry, "apigatewayv2", region)
	result := []Resource{}
	input := &apigatewayv2.GetApisInput{}
	for {
		page, err := client.GetApis(ctx, input)
		if err != nil {
			return result, err
		}
		for _, api := range page.Items {
			id := sdkaws.ToString(api.ApiId)
			resource := newResource("apigatewayv2", "api", region, sdkaws.ToString(api.Name), fmt.Sprintf("arn:aws:apigateway:%s::/apis/%s", region, id))
			resource.CreatedAt = formatTime(api.CreatedDate)
			resource.Tags = tagsFromMap(api.Tags)
			resource.Attributes["id"] = id
			resource.Attributes["protocolType"] = string(api.ProtocolType)
			resource.Attributes["apiEndpoint"] = sdkaws.ToString(api.ApiEndpoint)
			result = append(result, resource)
		}
		if page.NextToken == nil || sdkaws.ToString(page.NextToken) == "" {
			return result, nil
		}
		input.NextToken = page.NextToken
	}
}

// RuleResourceName names rules so that same-named rules on different buses stay distinct.
func RuleResourceName(bus, rule string) string {
	if bus == "" || bus == "default" {
		return rule
	}
	return bus + "/" + rule
}

func discoverEventBridge(ctx context.Context, d *Discoverer, region string) ([]Resource, error) {
	client := services.Typed[*eventbridge.Client](d.registry, "events", region)
	result := []Resource{}
	busInput := &eventbridge.ListEventBusesInput{}
	for {
		page, err := client.ListEventBuses(ctx, busInput)
		if err != nil {
			return result, err
		}
		for _, bus := range page.EventBuses {
			name := sdkaws.ToString(bus.Name)
			resource := newResource("events", "event-bus", region, name, sdkaws.ToString(bus.Arn))
			resource.CreatedAt = formatTime(bus.CreationTime)
			resource.Attributes["description"] = sdkaws.ToString(bus.Description)
			result = append(result, resource)
		}
		if sdkaws.ToString(page.NextToken) == "" {
			break
		}
		busInput.NextToken = page.NextToken
	}

	var mu sync.Mutex
	var errs []error
	buses := append([]Resource(nil), result...)
	forEach(buses, func(bus Resource) {
		rules := []Resource{}
		input := &eventbridge.ListRulesInput{EventBusName: sdkaws.String(bus.Name)}
		for {
			page, err := client.ListRules(ctx, input)
			if err != nil {
				mu.Lock()
				errs = append(errs, err)
				mu.Unlock()
				break
			}
			for _, rule := range page.Rules {
				ruleName := sdkaws.ToString(rule.Name)
				resource := newResource("events", "rule", region, RuleResourceName(bus.Name, ruleName), sdkaws.ToString(rule.Arn))
				resource.Attributes["ruleName"] = ruleName
				resource.Attributes["eventBusName"] = bus.Name
				resource.Attributes["eventPattern"] = sdkaws.ToString(rule.EventPattern)
				resource.Attributes["scheduleExpression"] = sdkaws.ToString(rule.ScheduleExpression)
				resource.Attributes["state"] = string(rule.State)
				resource.Attributes["description"] = sdkaws.ToString(rule.Description)
				rules = append(rules, resource)
			}
			if sdkaws.ToString(page.NextToken) == "" {
				break
			}
			input.NextToken = page.NextToken
		}
		mu.Lock()
		result = append(result, rules...)
		mu.Unlock()
	})
	forEach(indexes(result), func(i int) {
		if result[i].ARN == "" {
			return
		}
		if tags, err := client.ListTagsForResource(ctx, &eventbridge.ListTagsForResourceInput{ResourceARN: sdkaws.String(result[i].ARN)}); err == nil {
			for _, tag := range tags.Tags {
				result[i].Tags = append(result[i].Tags, Tag{Key: sdkaws.ToString(tag.Key), Value: sdkaws.ToString(tag.Value)})
			}
		}
	})
	return result, errors.Join(errs...)
}

func discoverLogs(ctx context.Context, d *Discoverer, region string) ([]Resource, error) {
	client := services.Typed[*cloudwatchlogs.Client](d.registry, "logs", region)
	result := []Resource{}
	paginator := cloudwatchlogs.NewDescribeLogGroupsPaginator(client, &cloudwatchlogs.DescribeLogGroupsInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, group := range page.LogGroups {
			name := sdkaws.ToString(group.LogGroupName)
			arn := sdkaws.ToString(group.LogGroupArn)
			if arn == "" {
				arn = strings.TrimSuffix(sdkaws.ToString(group.Arn), ":*")
			}
			if arn == "" {
				arn = fmt.Sprintf("arn:aws:logs:%s:%s:log-group:%s", region, d.account, name)
			}
			resource := newResource("logs", "log-group", region, name, arn)
			if group.CreationTime != nil {
				resource.CreatedAt = time.UnixMilli(*group.CreationTime).UTC().Format(time.RFC3339)
			}
			if group.RetentionInDays != nil {
				resource.Attributes["retentionInDays"] = *group.RetentionInDays
			}
			resource.Attributes["storedBytes"] = sdkaws.ToInt64(group.StoredBytes)
			resource.Attributes["logGroupClass"] = string(group.LogGroupClass)
			result = append(result, resource)
		}
	}
	forEach(indexes(result), func(i int) {
		if tags, err := client.ListTagsForResource(ctx, &cloudwatchlogs.ListTagsForResourceInput{ResourceArn: sdkaws.String(result[i].ARN)}); err == nil {
			result[i].Tags = tagsFromMap(tags.Tags)
		}
	})
	return result, nil
}

func discoverIAM(ctx context.Context, d *Discoverer, _ []string) ([]Resource, error) {
	client := services.Typed[*iam.Client](d.registry, "iam", "us-east-1")
	result := []Resource{}
	paginator := iam.NewListRolesPaginator(client, &iam.ListRolesInput{})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, role := range page.Roles {
			resource := newResource("iam", "role", GlobalRegion, sdkaws.ToString(role.RoleName), sdkaws.ToString(role.Arn))
			resource.CreatedAt = formatTime(role.CreateDate)
			for _, tag := range role.Tags {
				resource.Tags = append(resource.Tags, Tag{Key: sdkaws.ToString(tag.Key), Value: sdkaws.ToString(tag.Value)})
			}
			resource.Attributes["roleId"] = sdkaws.ToString(role.RoleId)
			resource.Attributes["path"] = sdkaws.ToString(role.Path)
			resource.Attributes["description"] = sdkaws.ToString(role.Description)
			if document, err := url.QueryUnescape(sdkaws.ToString(role.AssumeRolePolicyDocument)); err == nil {
				resource.Attributes["assumeRolePolicyDocument"] = document
			}
			result = append(result, resource)
		}
	}
	return result, nil
}

func indexes[T any](items []T) []int {
	result := make([]int, len(items))
	for i := range items {
		result[i] = i
	}
	return result
}

func lowerFirst(value string) string {
	if value == "" {
		return value
	}
	return strings.ToLower(value[:1]) + value[1:]
}
