import { expect, test } from "@playwright/test";
import { uniqueName } from "../support/names";
import { runInApiExplorer } from "../support/api-explorer";
import { cleanup, executeForCleanup } from "../support/cleanup";

const buckets: string[] = [];
const westBuckets: string[] = [];

test.afterAll(async () => {
  for (const b of buckets) await cleanup.bucket(b);
  for (const b of westBuckets) await executeForCleanup("s3", "DeleteBucket", { Bucket: b }, "us-west-2");
});

test.describe("API Explorer", () => {
  test("executes S3 ListBuckets and shows status, duration, request id and JSON response (SPEC 23)", async ({ page }) => {
    await page.goto("/api-explorer");
    const main = page.getByRole("main");

    await main.getByLabel("Service", { exact: true }).selectOption("s3");
    await main.getByLabel("Operation", { exact: true }).selectOption("ListBuckets");
    await expect(main.getByLabel("Region", { exact: true })).toHaveValue("us-east-1");
    await main.getByLabel("Input", { exact: true }).fill("{}");
    await main.getByRole("button", { name: "Execute", exact: true }).click();

    await expect(main.getByText("Status: 200", { exact: true })).toBeVisible();
    await expect(main.getByText(/^Duration: \d+(ms|\.\d+s)$/)).toBeVisible();
    await expect(main.getByText("Request ID", { exact: true })).toBeVisible();

    const tabs = main.getByRole("tablist", { name: "Inspector sections" });
    await expect(tabs.getByRole("tab", { name: "Request" })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "Headers" })).toBeVisible();
    await tabs.getByRole("tab", { name: "Response" }).click();
    await expect(main.getByLabel("Response body")).toContainText('"Buckets"');

    await tabs.getByRole("tab", { name: "Headers" }).click();
    await expect(main.getByRole("heading", { name: "Response headers" })).toBeVisible();
  });

  test("prefills service, operation and example input from the query string", async ({ page }) => {
    await page.goto("/api-explorer?service=sqs&operation=CreateQueue");
    const main = page.getByRole("main");
    await expect(main.getByLabel("Service", { exact: true })).toHaveValue("sqs");
    await expect(main.getByLabel("Operation", { exact: true })).toHaveValue("CreateQueue");
    await expect(main.getByLabel("Input", { exact: true })).toHaveValue(/"QueueName"/);
  });

  test("request inspector shows service, operation, parameters and response (SPEC 24)", async ({ page }) => {
    const bucket = uniqueName("e2e-explorer");
    buckets.push(bucket);
    const status = await runInApiExplorer(page, { service: "s3", operation: "CreateBucket", input: { Bucket: bucket } });
    expect(status).toBe(200);
    const main = page.getByRole("main");

    const tabs = main.getByRole("tablist", { name: "Inspector sections" });
    await tabs.getByRole("tab", { name: "Request" }).click();
    await expect(main.getByLabel("Request parameters")).toContainText(`"Bucket": "${bucket}"`);
    await tabs.getByRole("tab", { name: "Response" }).click();
    await expect(main.getByLabel("Response body")).toContainText("Location");

    // Open the audited request in the Logs Request Inspector.
    await main.getByRole("link", { name: "Open in Logs" }).click();
    await expect(page).toHaveURL(/\/logs\?id=op_/);
    const drawer = page.getByRole("dialog", { name: "S3 CreateBucket" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("S3 (s3)")).toBeVisible();
    await expect(drawer.getByText("Status: 200", { exact: true })).toBeVisible();
    await expect(drawer.getByLabel("Request parameters")).toContainText(bucket);
    await drawer.getByRole("tab", { name: "Response" }).click();
    await expect(drawer.getByLabel("Response body")).toContainText("Location");
  });

  test("shows the real Floci error when creating an existing bucket (SPEC 29)", async ({ page }) => {
    // us-east-1 answers a duplicate CreateBucket with 200 (legacy AWS behavior), so use another region.
    const region = "us-west-2";
    const bucket = uniqueName("e2e-explorer-dup");
    westBuckets.push(bucket);
    await page.goto("/api-explorer?service=s3&operation=CreateBucket");
    const main = page.getByRole("main");
    await expect(main.getByLabel("Operation", { exact: true })).toHaveValue("CreateBucket");
    await main.getByLabel("Region", { exact: true }).selectOption(region);
    await main
      .getByLabel("Input", { exact: true })
      .fill(JSON.stringify({ Bucket: bucket, CreateBucketConfiguration: { LocationConstraint: region } }));

    const execute = main.getByRole("button", { name: "Execute", exact: true });
    await execute.click();
    await expect(main.getByText("Status: 200", { exact: true })).toBeVisible();

    await execute.click();
    const alert = main.getByRole("alert");
    await expect(alert).toContainText("AWS Error");
    await expect(alert).toContainText("BucketAlreadyOwnedByYou");
    await expect(alert).toContainText("you already own it");
    await expect(main.getByText("Status: 409", { exact: true })).toBeVisible();
  });

  test("reports operations Floci does not implement as unsupported (SPEC 30)", async ({ page }) => {
    await page.goto("/services/dynamodb?tab=operations");
    const main = page.getByRole("main");
    await main.getByLabel("Search", { exact: true }).fill("DescribeLimits");
    await main.getByRole("link", { name: "Try it: DescribeLimits" }).click();

    await expect(page).toHaveURL(/operation=DescribeLimits/);
    await expect(main.getByLabel("Operation", { exact: true })).toHaveValue("DescribeLimits");
    await main.getByRole("button", { name: "Execute", exact: true }).click();

    const alert = main.getByRole("alert");
    await expect(alert).toContainText("Floci Unsupported Operation");
    await expect(alert).not.toContainText("Application Error");
  });

  test("rejects invalid JSON input before calling the API", async ({ page }) => {
    await page.goto("/api-explorer?service=s3&operation=ListBuckets");
    const main = page.getByRole("main");
    await expect(main.getByLabel("Operation", { exact: true })).toHaveValue("ListBuckets");
    await main.getByLabel("Input", { exact: true }).fill("{ not json");
    await expect(main.getByText(/Invalid JSON:/)).toBeVisible();
    await expect(main.getByRole("button", { name: "Execute", exact: true })).toBeDisabled();
  });
});
