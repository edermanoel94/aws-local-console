import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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

/**
 * Host name under which Floci (in Docker) reaches servers started by the test runner.
 * docker-compose.yml maps host.docker.internal to the host gateway; override for other topologies.
 */
const HOST_FROM_FLOCI = process.env.E2E_HOST_FROM_FLOCI ?? "host.docker.internal";

/** HTTP endpoint on the test runner host that records the SNS requests it receives. */
async function startEndpoint(): Promise<{ server: Server; port: number; requests: Record<string, string>[] }> {
  const requests: Record<string, string>[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        requests.push(JSON.parse(body));
      } catch {
        // Not an SNS JSON message; ignore it.
      }
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  return { server, port: (server.address() as AddressInfo).port, requests };
}

async function createSubscription(page: Page, protocol: string, endpoint: string) {
  await consolePanel(page).getByRole("button", { name: "Create subscription" }).click();
  const dialog = page.getByRole("dialog", { name: "Create subscription" });
  await dialog.getByLabel("Protocol").selectOption({ label: protocol });
  await dialog.getByLabel("Endpoint").fill(endpoint);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expectSuccess(page, `Subscription to ${endpoint} created`);
  await expect(dialog).toBeHidden();
}

async function publish(page: Page, topic: string, message: string) {
  await consolePanel(page).getByRole("button", { name: "Publish message" }).click();
  await page.getByLabel("Message body").fill(message);
  await page.getByRole("button", { name: "Publish message" }).click();
  await expectSuccess(page, `Message published to topic ${topic}`);
  await expect(page.getByRole("heading", { level: 2, name: topic, exact: true })).toBeVisible();
}

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

  test("shows an HTTP subscription that was never confirmed as pending confirmation", async ({ page }) => {
    const topic = uniqueName("e2e-sns-pending");
    topics.push(topic);
    await createTopic(page, topic);

    // Nothing listens on the discard port, so the subscription confirmation request is never answered.
    const endpoint = "http://127.0.0.1:9/hook";
    await consolePanel(page).getByRole("button", { name: "Create subscription" }).click();
    const dialog = page.getByRole("dialog", { name: "Create subscription" });
    await dialog.getByLabel("Protocol").selectOption({ label: "HTTP" });
    await dialog.getByLabel("Endpoint").fill(endpoint);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expectSuccess(page, `Subscription to ${endpoint} created`);
    await expect(dialog).toBeHidden();

    const subscription = row(page, "Subscriptions", endpoint);
    await expect(subscription.getByText("Pending confirmation")).toBeVisible();
    await expect(subscription.getByText("Confirmed")).toHaveCount(0);
    await expect(consolePanel(page).getByText("Subscriptions pending")).toBeVisible();
  });

  test("edits the raw delivery, filter policy and dead-letter queue of a subscription, and the filter applies to deliveries", async ({ page }) => {
    const queue = uniqueName("e2e-sns-filter-q");
    const dlq = uniqueName("e2e-sns-dlq");
    const topic = uniqueName("e2e-sns-filter");
    queues.push(queue, dlq);
    topics.push(topic);
    await createQueueInConsole(page, queue);
    await createQueueInConsole(page, dlq);
    await createTopic(page, topic);
    await createSubscription(page, "Amazon SQS", queueArn(queue));

    // Subscription details.
    await row(page, "Subscriptions", queueArn(queue)).getByRole("link").click();
    await expect(page.getByRole("heading", { level: 2, name: /^Subscription [0-9a-f-]{36}$/ })).toBeVisible();
    const panel = consolePanel(page);
    await expect(panel.getByText("Confirmed").first()).toBeVisible();
    await expect(panel.getByText(queueArn(queue))).toBeVisible();
    await expect(panel.getByText("Disabled")).toBeVisible();
    await expect(panel.getByText("No filter policy")).toBeVisible();
    await expect(panel.getByText("No dead-letter queue")).toBeVisible();

    // Edit every setting at once.
    await panel.getByRole("button", { name: "Edit", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Edit subscription" });
    await dialog.getByLabel("Enable raw message delivery").check();
    await dialog.getByRole("radio", { name: /^Message body/ }).check();
    await dialog.getByLabel("Subscription filter policy - optional").fill('{"type": ["order"]}');
    await dialog.getByLabel("Dead-letter queue - optional").selectOption({ label: dlq });
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expectSuccess(page, "Subscription saved");
    await expect(dialog).toBeHidden();
    await expect(panel.getByText("Enabled")).toBeVisible();
    await expect(panel.getByText("Scope: Message body.")).toBeVisible();
    await expect(panel.getByLabel("Filter policy")).toContainText('"order"');
    await expect(panel.getByText(queueArn(dlq))).toBeVisible();

    // Only the message whose body matches the filter reaches the queue, raw (no SNS envelope).
    await panel.getByRole("link", { name: topic, exact: true }).first().click();
    await publish(page, topic, '{"type":"refund","id":"filtered-out"}');
    await publish(page, topic, '{"type":"order","id":"delivered"}');
    await openConsole(page, "sqs");
    await openResource(page, queue);
    const delivered = await receiveUntilMessage(page, "delivered");
    await expect(delivered).toContainText('{"type":"order","id":"delivered"}');
    await expect(delivered).not.toContainText("Notification");
    await expect(row(page, "Received messages", "filtered-out")).toHaveCount(0);

    // Removing the filter policy delivers everything again.
    await openConsole(page, "sns");
    await openResource(page, topic);
    await row(page, "Subscriptions", queueArn(queue)).getByRole("link").click();
    await panel.getByRole("button", { name: "Edit", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Edit subscription" });
    await expect(dialog.getByLabel("Subscription filter policy - optional")).toHaveValue(/"order"/);
    await dialog.getByLabel("Subscription filter policy - optional").fill("");
    await dialog.getByLabel("Dead-letter queue - optional").selectOption({ label: "None" });
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expectSuccess(page, "Subscription saved");
    await expect(panel.getByText("No filter policy")).toBeVisible();
    await expect(panel.getByText("No dead-letter queue")).toBeVisible();

    // Delete from the detail page.
    await panel.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("dialog", { name: "Delete subscription" }).getByRole("button", { name: "Confirm delete" }).click();
    await expectSuccess(page, "Subscription deleted");
    await expect(page.getByRole("heading", { level: 2, name: topic, exact: true })).toBeVisible();
    await expect(panel.getByText("No subscriptions")).toBeVisible();
  });

  test("confirms an HTTP subscription with the token sent to the endpoint, which then receives notifications", async ({ page }) => {
    const topic = uniqueName("e2e-sns-confirm");
    topics.push(topic);
    const { server, port, requests } = await startEndpoint();
    try {
      await createTopic(page, topic);
      const endpoint = `http://${HOST_FROM_FLOCI}:${port}/sns`;
      await createSubscription(page, "HTTP", endpoint);
      await expect(row(page, "Subscriptions", endpoint).getByText("Pending confirmation")).toBeVisible();

      // SNS posts a SubscriptionConfirmation carrying the SubscribeURL.
      await expect.poll(() => requests.find((r) => r.Type === "SubscriptionConfirmation")?.SubscribeURL, { timeout: 30_000 }).toBeTruthy();
      const subscribeUrl = requests.find((r) => r.Type === "SubscriptionConfirmation")!.SubscribeURL;

      await row(page, "Subscriptions", endpoint).getByRole("link").click();
      const panel = consolePanel(page);
      await panel.getByRole("button", { name: "Confirm subscription" }).click();
      const dialog = page.getByRole("dialog", { name: "Confirm subscription" });
      await dialog.getByLabel("Token or SubscribeURL").fill("invalid-token");
      await dialog.getByRole("button", { name: "Confirm subscription" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Token is invalid");
      await dialog.getByLabel("Token or SubscribeURL").fill(subscribeUrl);
      await dialog.getByRole("button", { name: "Confirm subscription" }).click();
      await expectSuccess(page, "Subscription confirmed");
      await expect(dialog).toBeHidden();
      await expect(panel.getByText("Confirmed").first()).toBeVisible();
      await expect(panel.getByRole("button", { name: "Confirm subscription" })).toHaveCount(0);

      // The confirmed endpoint receives the next notification.
      await panel.getByRole("link", { name: topic, exact: true }).first().click();
      await expect(row(page, "Subscriptions", endpoint).getByText("Confirmed")).toBeVisible();
      await publish(page, topic, "hello endpoint");
      await expect.poll(() => requests.find((r) => r.Type === "Notification")?.Message, { timeout: 30_000 }).toBe("hello endpoint");
    } finally {
      server.close();
    }
  });

  test("validates the topic name", async ({ page }) => {
    await openConsole(page, "sns");
    await consolePanel(page).getByRole("button", { name: "Create topic" }).click();
    await page.getByLabel("Topic name").fill("bad name!");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Topic names can contain only alphanumeric characters")).toBeVisible();
  });
});
