import { expect, test } from "@playwright/test";
import { uniqueName } from "../support/names";
import { createViaApiExplorer, runInApiExplorer } from "../support/api-explorer";
import { cleanup } from "../support/cleanup";

const queues: string[] = [];

test.afterAll(async () => {
  for (const q of queues) await cleanup.queue(q);
});

test.describe("Logs (SPEC 27)", () => {
  test("log appears and can be filtered by service, operation and status, then opened", async ({ page }) => {
    const queue = uniqueName("e2e-logs");
    queues.push(queue);
    await createViaApiExplorer(page, { service: "sqs", operation: "CreateQueue", input: { QueueName: queue } });
    // A failing call related to the same name: the queue URL of a queue that does not exist.
    const status = await runInApiExplorer(page, {
      service: "sqs",
      operation: "GetQueueUrl",
      input: { QueueName: `${queue}-missing` },
    });
    expect(status).toBeGreaterThanOrEqual(400);

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Logs", exact: true }).click();
    await expect(page).toHaveURL(/\/logs$/);
    const main = page.getByRole("main");
    const rows = main.getByRole("table", { name: "Logs" }).getByRole("row");
    const createRow = rows.filter({ hasText: "CreateQueue" }).filter({ hasText: queue });

    // Log appears (search by resource name).
    await main.getByLabel("Search").fill(queue);
    await expect(createRow).toBeVisible();

    // Filter by service.
    await main.getByLabel("Service", { exact: true }).selectOption("sqs");
    await expect(createRow).toBeVisible();
    await main.getByLabel("Service", { exact: true }).selectOption("s3");
    await expect(main.getByText("No logs match the filters")).toBeVisible();
    await main.getByLabel("Service", { exact: true }).selectOption("sqs");

    // Filter by operation.
    await main.getByLabel("Operation", { exact: true }).fill("CreateQueue");
    await expect(createRow).toBeVisible();
    await expect(rows.filter({ hasText: "GetQueueUrl" }).filter({ hasText: queue })).toHaveCount(0);

    // Filter by status.
    await main.getByLabel("Operation", { exact: true }).fill("GetQueueUrl");
    await main.getByLabel("Status", { exact: true }).selectOption("error");
    const errorRow = rows.filter({ hasText: "GetQueueUrl" }).filter({ hasText: `${queue}-missing` });
    await expect(errorRow).toBeVisible();
    await expect(errorRow).toContainText("Error");
    await main.getByLabel("Status", { exact: true }).selectOption("success");
    await expect(rows.filter({ hasText: `${queue}-missing` })).toHaveCount(0);

    // Open log details (Request Inspector drawer).
    await main.getByLabel("Status", { exact: true }).selectOption("");
    await main.getByLabel("Operation", { exact: true }).fill("CreateQueue");
    await createRow.getByRole("button", { name: "CreateQueue" }).click();
    const drawer = page.getByRole("dialog", { name: "SQS CreateQueue" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("SQS (sqs)")).toBeVisible();
    await expect(drawer.getByText("Status: 200", { exact: true })).toBeVisible();
    await expect(drawer.getByLabel("Request parameters")).toContainText(queue);
    await drawer.getByRole("tab", { name: "Response" }).click();
    await expect(drawer.getByLabel("Response body")).toContainText("QueueUrl");
    await drawer.getByRole("tab", { name: "Headers" }).click();
    await expect(drawer.getByRole("heading", { name: "Request headers" })).toBeVisible();

    // The drawer is linkable (?id=) and has a full page version.
    await expect(page).toHaveURL(/id=op_/);
    await drawer.getByRole("link", { name: "Open" }).click();
    await expect(page).toHaveURL(/\/logs\/op_/);
    await expect(page.getByRole("heading", { level: 1, name: "SQS CreateQueue" })).toBeVisible();
    await expect(page.getByRole("main").getByLabel("Request parameters")).toContainText(queue);
  });

  test("error logs show the AWS error in the inspector", async ({ page }) => {
    const missing = uniqueName("e2e-logs-missing");
    await runInApiExplorer(page, { service: "sqs", operation: "GetQueueUrl", input: { QueueName: missing } });
    await page.goto(`/logs?q=${missing}`);
    const main = page.getByRole("main");
    const row = main.getByRole("table", { name: "Logs" }).getByRole("row").filter({ hasText: "GetQueueUrl" });
    await expect(row).toBeVisible();
    await row.click();
    const drawer = page.getByRole("dialog", { name: "SQS GetQueueUrl" });
    await expect(drawer.getByRole("alert")).toContainText(/NonExistentQueue|QueueDoesNotExist/);
  });
});
