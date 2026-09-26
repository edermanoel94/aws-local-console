import type { Exec } from "../_shared/aws";
import { queueNameFromUrl } from "../_shared/aws";

export type QueueAttributes = Record<string, string>;

export interface QueueSummary {
  name: string;
  url: string;
  attributes: QueueAttributes;
}

export async function loadQueues(exec: Exec): Promise<QueueSummary[]> {
  const out = await exec<{ QueueUrls?: string[] | null }>("sqs", "ListQueues", { MaxResults: 1000 });
  const urls = out.QueueUrls ?? [];
  const queues = await Promise.all(
    urls.map(async (url) => {
      try {
        const attrs = await exec<{ Attributes?: QueueAttributes }>("sqs", "GetQueueAttributes", { QueueUrl: url, AttributeNames: ["All"] });
        return { name: queueNameFromUrl(url), url, attributes: attrs.Attributes ?? {} };
      } catch {
        // Queue deleted between ListQueues and GetQueueAttributes.
        return { name: queueNameFromUrl(url), url, attributes: {} };
      }
    }),
  );
  return queues.sort((a, b) => a.name.localeCompare(b.name));
}

export interface QueueInfo {
  url: string;
  attributes: QueueAttributes;
}

export async function loadQueue(exec: Exec, name: string): Promise<QueueInfo> {
  const { QueueUrl } = await exec<{ QueueUrl: string }>("sqs", "GetQueueUrl", { QueueName: name });
  const attrs = await exec<{ Attributes?: QueueAttributes }>("sqs", "GetQueueAttributes", { QueueUrl, AttributeNames: ["All"] });
  return { url: QueueUrl, attributes: attrs.Attributes ?? {} };
}

export function isFifo(name: string) {
  return name.endsWith(".fifo");
}
