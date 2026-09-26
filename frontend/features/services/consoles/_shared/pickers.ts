"use client";

import { useAwsLoader, nameFromArn, queueNameFromUrl, type Exec } from "./aws";

export interface ArnOption {
  value: string;
  label: string;
}

async function queueOptions(exec: Exec): Promise<ArnOption[]> {
  const out = await exec<{ QueueUrls?: string[] }>("sqs", "ListQueues", {});
  const urls = out.QueueUrls ?? [];
  const arns = await Promise.all(
    urls.map(async (url) => {
      const attrs = await exec<{ Attributes?: Record<string, string> }>("sqs", "GetQueueAttributes", { QueueUrl: url, AttributeNames: ["QueueArn"] });
      return { value: attrs.Attributes?.QueueArn ?? url, label: queueNameFromUrl(url) };
    }),
  );
  return arns.sort((a, b) => a.label.localeCompare(b.label));
}

async function functionOptions(exec: Exec): Promise<ArnOption[]> {
  const out = await exec<{ Functions?: { FunctionName: string; FunctionArn: string }[] }>("lambda", "ListFunctions", {});
  return (out.Functions ?? []).map((f) => ({ value: f.FunctionArn, label: f.FunctionName })).sort((a, b) => a.label.localeCompare(b.label));
}

async function topicOptions(exec: Exec): Promise<ArnOption[]> {
  const out = await exec<{ Topics?: { TopicArn: string }[] }>("sns", "ListTopics", {});
  return (out.Topics ?? []).map((t) => ({ value: t.TopicArn, label: nameFromArn(t.TopicArn) })).sort((a, b) => a.label.localeCompare(b.label));
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
