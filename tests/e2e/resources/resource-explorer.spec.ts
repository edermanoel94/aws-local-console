import { expect, test, type Page } from "@playwright/test";
import { uniqueName } from "../support/names";
import { createViaApiExplorer } from "../support/api-explorer";
import { cleanup } from "../support/cleanup";

/**
 * SPEC 26: a "payments" style set of resources across services, found by search, service, region and tags.
 * Resources are created through the API Explorer UI.
 */
const prefix = uniqueName("e2e-payments");
const queue = `${prefix}-queue`;
const table = `${prefix}-table`;
const bucket = `${prefix}-bucket`.slice(0, 63);
const team = `team-${prefix.slice(-5)}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await createViaApiExplorer(page, { service: "sqs", operation: "CreateQueue", input: { QueueName: queue, tags: { team } } });
  await createViaApiExplorer(page, {
    service: "dynamodb",
    operation: "CreateTable",
    input: {
      TableName: table,
      AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    },
  });
  await createViaApiExplorer(page, { service: "s3", operation: "CreateBucket", input: { Bucket: bucket } });
  await page.close();
});

test.afterAll(async () => {
  await cleanup.queue(queue);
  await cleanup.table(table);
  await cleanup.bucket(bucket);
});

async function openExplorer(page: Page) {
  await page.goto("/resources");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Resource Explorer" })).toBeVisible();
  return main;
}

test.describe("Resource Explorer", () => {
  test("search by name finds resources of every service", async ({ page }) => {
    const main = await openExplorer(page);
    await main.getByLabel("Search").fill(prefix);
    const rows = main.getByRole("table", { name: "Resources" }).getByRole("row");
    await expect(rows.filter({ hasText: queue })).toBeVisible();
    await expect(rows.filter({ hasText: table })).toBeVisible();
    await expect(rows.filter({ hasText: bucket })).toBeVisible();
    await expect(rows).toHaveCount(4);

    const queueRow = rows.filter({ hasText: queue });
    await expect(queueRow).toContainText("SQS");
    await expect(queueRow).toContainText("queue");
    await expect(queueRow).toContainText("us-east-1");
    await expect(queueRow).toContainText(`arn:aws:sqs:us-east-1:000000000000:${queue}`);
    await expect(queueRow).toContainText(`team=${team}`);
  });

  test("filters by service", async ({ page }) => {
    const main = await openExplorer(page);
    await main.getByLabel("Search").fill(prefix);
    await main.getByLabel("Service", { exact: true }).selectOption("dynamodb");
    const rows = main.getByRole("table", { name: "Resources" }).getByRole("row");
    await expect(rows.filter({ hasText: table })).toBeVisible();
    await expect(rows).toHaveCount(2);
    await expect(page).toHaveURL(/service=dynamodb/);
  });

  test("filters by region", async ({ page }) => {
    const main = await openExplorer(page);
    await main.getByLabel("Search").fill(prefix);
    await expect(main.getByRole("table", { name: "Resources" }).getByRole("row").filter({ hasText: queue })).toBeVisible();
    await main.getByLabel("Region", { exact: true }).selectOption("eu-west-1");
    await expect(main.getByText("No resources match the filters")).toBeVisible();
    await main.getByLabel("Region", { exact: true }).selectOption("us-east-1");
    await expect(main.getByRole("table", { name: "Resources" }).getByRole("row").filter({ hasText: queue })).toBeVisible();
  });

  test("filters by tag", async ({ page }) => {
    const main = await openExplorer(page);
    await main.getByLabel("Tag", { exact: true }).fill(`team=${team}`);
    const rows = main.getByRole("table", { name: "Resources" }).getByRole("row");
    await expect(rows.filter({ hasText: queue })).toBeVisible();
    await expect(rows).toHaveCount(2);
  });

  test("search by ARN and open the detail drawer", async ({ page }) => {
    const main = await openExplorer(page);
    await main.getByLabel("Search").fill(`arn:aws:dynamodb:us-east-1:000000000000:table/${table}`);
    const row = main.getByRole("table", { name: "Resources" }).getByRole("row").filter({ hasText: table });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: table }).click();

    const drawer = page.getByRole("dialog", { name: table });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(`arn:aws:dynamodb:us-east-1:000000000000:table/${table}`)).toBeVisible();
    await expect(drawer.getByLabel("Resource attributes")).toContainText("keySchema");
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer).toBeHidden();
  });

  test("shows an empty state when nothing matches", async ({ page }) => {
    const main = await openExplorer(page);
    await main.getByLabel("Search").fill(`${prefix}-nothing-here`);
    await expect(main.getByText("No resources match the filters")).toBeVisible();
  });
});
