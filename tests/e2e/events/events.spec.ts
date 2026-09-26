import { expect, test } from "@playwright/test";
import { uniqueName } from "../support/names";
import { createViaApiExplorer } from "../support/api-explorer";
import { cleanup } from "../support/cleanup";

const topic = uniqueName("e2e-events-topic");
const queue = uniqueName("e2e-events-queue");

test.afterAll(async () => {
  await cleanup.topic(topic);
  await cleanup.queue(queue);
});

test.describe("Events (SPEC 28)", () => {
  test("event appears with service, timestamp, resource and relationships", async ({ page }) => {
    const startedAt = Date.now();
    await createViaApiExplorer(page, { service: "sqs", operation: "CreateQueue", input: { QueueName: queue } });
    await createViaApiExplorer(page, { service: "sns", operation: "CreateTopic", input: { Name: topic } });
    await createViaApiExplorer(page, {
      service: "sns",
      operation: "Subscribe",
      input: { TopicArn: `arn:aws:sns:us-east-1:000000000000:${topic}`, Protocol: "sqs", Endpoint: `arn:aws:sqs:us-east-1:000000000000:${queue}` },
    });

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Events", exact: true }).click();
    const main = page.getByRole("main");
    await main.getByLabel("Search").fill(topic);
    const rows = main.getByRole("table", { name: "Events" }).getByRole("row");

    // Event appears, correct service and resource.
    const created = rows.filter({ hasText: "ResourceCreated" }).filter({ hasText: "CreateTopic" }).filter({ hasText: topic });
    await expect(created).toBeVisible();
    await expect(created).toContainText("SNS");
    await expect(created).toContainText(topic);

    // Correct timestamp: rendered time is within the test window (local time, second precision).
    const timeText = (await created.locator("time").getAttribute("datetime")) ?? "";
    const eventTime = new Date(timeText).getTime();
    expect(eventTime).toBeGreaterThanOrEqual(startedAt - 5_000);
    expect(eventTime).toBeLessThanOrEqual(Date.now() + 5_000);
    await expect(created.locator("time")).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // Filter by service and type.
    await main.getByLabel("Service", { exact: true }).selectOption("sqs");
    await expect(main.getByText("No events match the filters")).toBeVisible();
    await main.getByLabel("Service", { exact: true }).selectOption("sns");
    await expect(created).toBeVisible();

    // Event relationship: the subscription relates the topic and the queue.
    const subscription = rows.filter({ hasText: "Subscribe" }).filter({ hasText: topic });
    await expect(subscription).toBeVisible();
    await expect(subscription).toContainText("related");
    await subscription.getByRole("button", { name: topic }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    const related = drawer.getByRole("region", { name: "Related resources" });
    await expect(related.getByRole("link", { name: queue })).toBeVisible();
    await expect(related.getByText(`arn:aws:sqs:us-east-1:000000000000:${queue}`)).toBeVisible();

    // Relationship to the originating log entry.
    await drawer.getByRole("link", { name: /View log/ }).click();
    await expect(page).toHaveURL(/\/logs\?id=op_/);
    const logDrawer = page.getByRole("dialog", { name: "SNS Subscribe" });
    await expect(logDrawer).toBeVisible();
    await expect(logDrawer.getByLabel("Request parameters")).toContainText(queue);
  });
});
