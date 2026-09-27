import type { Exec } from "../_shared/aws";
import { listAllPages } from "../_shared/paginate";

export interface Subscription {
  SubscriptionArn: string;
  Protocol: string;
  Endpoint: string;
  Owner?: string;
  TopicArn?: string;
}

export type SubscriptionStatus = "confirmed" | "pending";

export interface SubscriptionWithStatus extends Subscription {
  status: SubscriptionStatus;
}

export async function getSubscriptionAttributes(exec: Exec, subscriptionArn: string): Promise<Record<string, string>> {
  const out = await exec<{ Attributes?: Record<string, string> | null }>("sns", "GetSubscriptionAttributes", { SubscriptionArn: subscriptionArn });
  return out.Attributes ?? {};
}

/**
 * Confirmation status of a subscription. AWS hides pending subscriptions behind the "PendingConfirmation" placeholder,
 * while Floci returns their real ARN and only flags them with the PendingConfirmation attribute, so both are checked.
 */
async function statusOf(exec: Exec, subscription: Subscription): Promise<SubscriptionStatus> {
  if (!subscription.SubscriptionArn.startsWith("arn:")) return "pending";
  const attributes = await getSubscriptionAttributes(exec, subscription.SubscriptionArn);
  return attributes.PendingConfirmation === "true" ? "pending" : "confirmed";
}

export async function loadTopicSubscriptions(exec: Exec, topicArn: string): Promise<SubscriptionWithStatus[]> {
  const subscriptions = await listAllPages<{ Subscriptions?: Subscription[] | null; NextToken?: string | null }, Subscription>(exec, "sns", "ListSubscriptionsByTopic", { TopicArn: topicArn }, {
    items: (out) => out.Subscriptions,
    next: (out) => out.NextToken,
    tokenField: "NextToken",
  });
  return Promise.all(subscriptions.map(async (s) => ({ ...s, status: await statusOf(exec, s) })));
}

/** Last segment of a subscription ARN, shown as its ID. */
export function subscriptionId(subscriptionArn: string): string {
  return subscriptionArn.split(":").pop() ?? subscriptionArn;
}
