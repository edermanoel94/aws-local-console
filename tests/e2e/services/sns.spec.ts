import { expect, test, type Page } from "@playwright/test";
import { uniqueName } from "../support/names";
import { cleanup, executeForCleanup } from "../support/cleanup";
import { consolePanel, deleteWithConfirmation, expectSuccess, openConsole, openResource, row } from "../support/console";
import { createQueueInConsole, openQueueInConsole, queueArn, receiveUntilMessage } from "../support/sqs";

/** SPEC 19 (SNS): topic, SQS subscription, publish, delivery through the SQS console, unsubscribe, delete. */
const topics: string[] = [];
const queues: string[] = [];

test.afterAll(async () => {
  for (const topic of topics) {
    const arn = `arn:aws:sns:us-east-1:000000000000:${topic}`;
    const subs = (await executeForCleanup("sns", "ListSubscriptionsByTopic", { TopicArn: arn })) as { Subscriptions?: { SubscriptionArn: string }[] } | undefined;
    for (const s of subs?.Subscriptions ?? []) await executeForCleanup("sns", "Unsubscribe", { SubscriptionArn: s.SubscriptionArn });
    await cleanup.topic(topic);
  }
  for (const q of queues) await cleanup.queue(q);
});

async function createTopic(page: Page, name: string) {
  await openConsole(page, "sns");
  await consolePanel(page).getByRole("button", { name: "Create topic" }).click();
  await page.getByLabel("Topic name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expectSuccess(page, `Topic ${name} created`);
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

test.describe("SNS console", () => {
  test("creates a topic, subscribes a queue, publishes, verifies delivery, unsubscribes and deletes the topic", async ({ page }) => {
    const queue = uniqueName("e2e-sns-q");
    const topic = uniqueName("e2e-sns");
    queues.push(queue);
    topics.push(topic);

    // Queue that receives the notifications, created through the SQS console.
    await createQueueInConsole(page, queue);

    // Topic.
    await createTopic(page, topic);
    await expect(consolePanel(page).getByText("No subscriptions")).toBeVisible();

    // Subscription to the queue.
    await consolePanel(page).getByRole("button", { name: "Create subscription" }).click();
    const dialog = page.getByRole("dialog", { name: "Create subscription" });
    await expect(dialog.getByLabel("Protocol")).toHaveValue("sqs");
    await dialog.getByLabel("Endpoint").fill(queueArn(queue));
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expectSuccess(page, `Subscription to ${queueArn(queue)} created`);
    await expect(dialog).toBeHidden();
    const subscription = row(page, "Subscriptions", queueArn(queue));
    await expect(subscription).toBeVisible();
    await expect(subscription.getByText("SQS", { exact: true })).toBeVisible();
    await expect(subscription.getByText("Confirmed")).toBeVisible();

    // Publish.
    const message = `{"orderId":"${uniqueName("order")}"}`;
    await consolePanel(page).getByRole("button", { name: "Publish message" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Publish message to topic" })).toBeVisible();
    await page.getByLabel("Subject - optional").fill("Order placed");
    await page.getByLabel("Message body").fill(message);
    await page.getByRole("button", { name: "Publish message" }).click();
    await expectSuccess(page, `Message published to topic ${topic}`);
    await expect(page.getByRole("heading", { level: 2, name: topic, exact: true })).toBeVisible();

    // Delivery: the SNS envelope arrives in the queue.
    await openQueueInConsole(page, queue);
    const delivered = await receiveUntilMessage(page, "Order placed");
    await delivered.getByRole("button", { expanded: false }).click();
    const body = page.getByLabel("Message body content");
    await expect(body).toContainText('"Type": "Notification"');
    await expect(body).toContainText(`"TopicArn": "arn:aws:sns:us-east-1:000000000000:${topic}"`);
    await expect(body).toContainText('"Subject": "Order placed"');
    await expect(body).toContainText(`"Message": ${JSON.stringify(message)}`);

    // Unsubscribe.
    await openConsole(page, "sns");
    await openResource(page, topic);
    await subscription.getByRole("button", { name: `Delete subscription ${queueArn(queue)}` }).click();
    const confirm = page.getByRole("dialog", { name: "Delete subscription" });
    await confirm.getByRole("button", { name: "Confirm delete" }).click();
    await expectSuccess(page, "Subscription deleted");
    await expect(confirm).toBeHidden();
    await expect(consolePanel(page).getByText("No subscriptions")).toBeVisible();

    // Delete the topic.
    await deleteWithConfirmation(page, topic);
    await expectSuccess(page, `Topic ${topic} deleted`);
    await expect(consolePanel(page).getByRole("heading", { name: "Topics" })).toBeVisible();
    await expect(row(page, "Topics", topic)).toHaveCount(0);
  });

  test("validates the topic name", async ({ page }) => {
    await openConsole(page, "sns");
    await consolePanel(page).getByRole("button", { name: "Create topic" }).click();
    await page.getByLabel("Topic name").fill("bad name!");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Topic names can contain only alphanumeric characters")).toBeVisible();
  });
});
