import { expect, test, type Page } from "@playwright/test";
import { uniqueName } from "../support/names";
import { createViaApiExplorer } from "../support/api-explorer";
import { executeForCleanup } from "../support/cleanup";
import { row } from "../support/console";

// No other spec uses this region, so the simulator only sees what this file creates (plus the default event bus).
const REGION = "sa-east-1";
const standardQueue = uniqueName("e2e-cost");
const fifoQueue = `${uniqueName("e2e-cost")}.fifo`;

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  for (const name of [standardQueue, fifoQueue]) {
    await executeForCleanup("sqs", "DeleteQueue", { QueueUrl: `http://localhost:4566/000000000000/${name}` }, REGION);
  }
});

async function selectRegion(page: Page) {
  await page.getByRole("banner").getByLabel("Region").selectOption(REGION);
  await expect(page.getByRole("banner").getByLabel("Region")).toHaveValue(REGION);
}

function sqsCost(page: Page) {
  return page.getByRole("region", { name: "SQS cost" });
}

test.describe("Cost Simulator", () => {
  test("is reachable from the main navigation", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Cost Simulator", exact: true }).click();
    await expect(page).toHaveURL(/\/costs$/);
    await expect(page.getByRole("heading", { level: 1, name: "Cost Simulator" })).toBeVisible();
    await expect(page.getByRole("region", { name: "About these estimates" })).toContainText("US East (N. Virginia)");
  });

  test("prices the queues of the selected region from the usage typed, and remembers it", async ({ page }) => {
    await page.goto("/dashboard");
    await selectRegion(page);
    await createViaApiExplorer(page, { service: "sqs", operation: "CreateQueue", input: { QueueName: standardQueue } });
    await createViaApiExplorer(page, { service: "sqs", operation: "CreateQueue", input: { QueueName: fifoQueue, Attributes: { FifoQueue: "true" } } });

    await page.goto("/costs");
    await expect(page.getByText(`What the resources of ${REGION} would cost`)).toBeVisible();
    const sqs = sqsCost(page);
    await expect(sqs.getByRole("heading", { level: 2 })).toHaveText("SQS (2)");

    // Defaults: 100,000 messages per queue, three requests per message.
    const messages = sqs.getByLabel("Messages per queue");
    await expect(messages).toHaveValue("100000");
    await expect(row(sqs, "SQS cost breakdown", "Standard queue requests")).toContainText("300,000 requests");
    await expect(row(sqs, "SQS cost breakdown", "Standard queue requests")).toContainText("$0.40 per 1M");
    await expect(row(sqs, "SQS cost breakdown", "FIFO queue requests")).toContainText("$0.50 per 1M");

    // 1M messages per queue: 3M requests on each queue, $1.20 standard + $1.50 FIFO.
    await messages.fill("1000000");
    await expect(row(sqs, "SQS cost breakdown", "Standard queue requests")).toContainText("3,000,000 requests");
    await expect(row(sqs, "SQS cost breakdown", "Standard queue requests")).toContainText("$1.20");
    await expect(row(sqs, "SQS cost breakdown", "FIFO queue requests")).toContainText("$1.50");
    await expect(page.getByTestId("cost-sqs-monthly")).toHaveText("$2.70");

    // The default event bus is the only other resource: 100,000 custom events at $1.00 per 1M.
    await expect(page.getByTestId("cost-events-monthly")).toHaveText("$0.10");
    await expect(page.getByTestId("cost-monthly-estimate-value")).toHaveText("$2.80");
    await expect(page.getByTestId("cost-yearly-estimate-value")).toHaveText("$33.60");
    await expect(page.getByRole("region", { name: "Cost by service" }).getByRole("listitem").first()).toContainText("SQS$2.70");

    await page.reload();
    await expect(sqsCost(page).getByLabel("Messages per queue")).toHaveValue("1000000");
    await expect(page.getByTestId("cost-monthly-estimate-value")).toHaveText("$2.80");

    await page.getByRole("button", { name: "Reset usage" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Usage assumptions reset to the defaults" }).first()).toBeVisible();
    await expect(sqsCost(page).getByLabel("Messages per queue")).toHaveValue("100000");
    await expect(page.getByTestId("cost-sqs-monthly")).toHaveText("$0.27");
  });

  test("rejects negative usage and keeps the last valid value", async ({ page }) => {
    await page.goto("/dashboard");
    await selectRegion(page);
    await page.goto("/costs");
    const messages = sqsCost(page).getByLabel("Messages per queue");
    await messages.fill("2000000");
    await expect(page.getByTestId("cost-sqs-monthly")).toHaveText("$5.40");

    await messages.fill("-5");
    await expect(messages).toHaveAttribute("aria-invalid", "true");
    await expect(sqsCost(page).getByText("Enter zero or a positive number.")).toBeVisible();
    await expect(page.getByTestId("cost-sqs-monthly")).toHaveText("$5.40");

    // An empty field means no usage.
    await messages.fill("");
    await expect(messages).not.toHaveAttribute("aria-invalid");
    await expect(page.getByTestId("cost-sqs-monthly")).toHaveText("$0.00");
  });

  test("shows an empty state when the region has no priced resources", async ({ page }) => {
    await page.route(/\/api\/v1\/resources\?/, (route) => route.fulfill({ json: { resources: [], total: 0, errors: [] } }));
    await page.goto("/costs");
    await expect(page.getByText("No resources to price yet")).toBeVisible();
    await expect(page.getByTestId("cost-monthly-estimate-value")).toHaveText("$0.00");
  });
});
