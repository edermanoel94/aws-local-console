"use client";

import { useAwsLoader, nameFromArn, queueNameFromUrl, type Exec } from "./aws";
import { listAllPages } from "./paginate";

export interface ArnOption {
  value: string;
  label: string;
}

async function queueOptions(exec: Exec): Promise<ArnOption[]> {
  const urls = await listAllPages<{ QueueUrls?: string[] | null; NextToken?: string | null }, string>(exec, "sqs", "ListQueues", { MaxResults: 1000 }, {
    items: (out) => out.QueueUrls,
    next: (out) => out.NextToken,
    tokenField: "NextToken",
  });
  const arns = await Promise.all(
    urls.map(async (url) => {
      const name = queueNameFromUrl(url);
      try {
        const attrs = await exec<{ Attributes?: Record<string, string> }>("sqs", "GetQueueAttributes", { QueueUrl: url, AttributeNames: ["QueueArn"] });
        const arn = attrs.Attributes?.QueueArn;
        return arn ? { value: arn, label: name } : null;
      } catch {
        // Queue deleted between ListQueues and GetQueueAttributes: one stale entry must not break the whole picker.
        return null;
      }
    }),
  );
  return arns.filter((a): a is ArnOption => a !== null).sort((a, b) => a.label.localeCompare(b.label));
}

async function functionOptions(exec: Exec): Promise<ArnOption[]> {
  const out = await exec<{ Functions?: { FunctionName: string; FunctionArn: string }[] }>("lambda", "ListFunctions", {});
  return (out.Functions ?? []).map((f) => ({ value: f.FunctionArn, label: f.FunctionName })).sort((a, b) => a.label.localeCompare(b.label));
}

async function topicOptions(exec: Exec): Promise<ArnOption[]> {
  const topics = await listAllPages<{ Topics?: { TopicArn: string }[] | null; NextToken?: string | null }, { TopicArn: string }>(exec, "sns", "ListTopics", {}, {
    items: (out) => out.Topics,
    next: (out) => out.NextToken,
    tokenField: "NextToken",
  });
  return topics.map((t) => ({ value: t.TopicArn, label: nameFromArn(t.TopicArn) })).sort((a, b) => a.label.localeCompare(b.label));
}

async function streamOptions(exec: Exec): Promise<ArnOption[]> {
  const tables = await listAllPages<{ TableNames?: string[] | null; LastEvaluatedTableName?: string | null }, string>(exec, "dynamodb", "ListTables", {}, {
    items: (out) => out.TableNames,
    next: (out) => out.LastEvaluatedTableName,
    tokenField: "ExclusiveStartTableName",
  });
  const streams = await Promise.all(
    tables.map(async (name) => {
      try {
        const out = await exec<{ Table?: { StreamSpecification?: { StreamEnabled?: boolean } | null; LatestStreamArn?: string | null } }>("dynamodb", "DescribeTable", { TableName: name });
        const arn = out.Table?.LatestStreamArn;
        return out.Table?.StreamSpecification?.StreamEnabled && arn ? { value: arn, label: name } : null;
      } catch {
        // Table deleted between ListTables and DescribeTable.
        return null;
      }
    }),
  );
  return streams.filter((s): s is ArnOption => s !== null).sort((a, b) => a.label.localeCompare(b.label));
}

/** Existing SQS queues as ARN options (for triggers, subscriptions, rule targets, notifications). */
export function useQueueOptions(enabled = true) {
  return useAwsLoader(["pickers", "sqs"], queueOptions, { enabled });
}

export function useFunctionOptions(enabled = true) {
  return useAwsLoader(["pickers", "lambda"], functionOptions, { enabled });
}

export function useTopicOptions(enabled = true) {
  return useAwsLoader(["pickers", "sns"], topicOptions, { enabled });
}

/** DynamoDB tables with a stream turned on, as stream ARN options labeled by table name (for Lambda triggers). */
export function useStreamOptions(enabled = true) {
  return useAwsLoader(["pickers", "dynamodbstreams"], streamOptions, { enabled });
}
