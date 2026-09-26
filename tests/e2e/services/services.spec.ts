import { expect, test } from "@playwright/test";

const CATEGORIES = ["Compute", "Storage", "Database", "Networking", "Security", "Application Integration", "Management", "Analytics"];
const TABS = ["Overview", "Resources", "Operations", "API Explorer", "Activity", "Coverage"];

test.describe("Services", () => {
  test("navigates from the sidebar and groups services by the 8 categories", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Services", exact: true }).click();
    await expect(page).toHaveURL(/\/services$/);
    await expect(page.getByRole("heading", { level: 1, name: "Services" })).toBeVisible();

    for (const category of CATEGORIES) {
      await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${category} \\(\\d+\\)$`) })).toBeVisible();
    }
    const storage = page.getByRole("region", { name: /^Storage/ });
    await expect(storage.getByRole("link", { name: "S3", exact: true })).toBeVisible();
    await expect(storage.getByText("Available")).toBeVisible();
    await expect(storage.getByText(/supported/)).toBeVisible();
    const compute = page.getByRole("region", { name: /^Compute/ });
    await expect(compute.getByRole("link", { name: "Lambda", exact: true })).toBeVisible();
  });

  test("search filters the catalog", async ({ page }) => {
    await page.goto("/services");
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "S3", exact: true })).toBeVisible();

    await main.getByLabel("Search").fill("dynamo");
    await expect(main.getByRole("link", { name: "DynamoDB", exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: "S3", exact: true })).toBeHidden();
    await expect(main.getByRole("heading", { level: 2, name: /^Storage/ })).toBeHidden();

    await main.getByLabel("Search").fill("no-such-service-xyz");
    await expect(main.getByText("No services match")).toBeVisible();
  });

  test("opens a service and switches tabs through the UI and ?tab=", async ({ page }) => {
    await page.goto("/services");
    await page.getByRole("main").getByRole("link", { name: "S3", exact: true }).click();
    await expect(page).toHaveURL(/\/services\/s3$/);
    await expect(page.getByRole("heading", { level: 1, name: "Amazon S3" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Services" })).toBeVisible();

    const tablist = page.getByRole("tablist", { name: "Sections" });
    for (const name of TABS) await expect(tablist.getByRole("tab", { name, exact: true })).toBeVisible();
    await expect(tablist.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Service details" })).toBeVisible();

    await tablist.getByRole("tab", { name: "Coverage" }).click();
    await expect(page).toHaveURL(/tab=coverage/);
    await expect(page.getByRole("heading", { name: /Coverage by operation/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Supported operations", exact: true })).toBeVisible();

    await tablist.getByRole("tab", { name: "Activity" }).click();
    await expect(page).toHaveURL(/tab=activity/);
    await expect(page.getByRole("heading", { name: /Operation logs/ })).toBeVisible();

    await page.goto("/services/sqs?tab=operations");
    await expect(page.getByRole("tablist", { name: "Sections" }).getByRole("tab", { name: "Operations" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("table", { name: "Operations" }).getByRole("cell", { name: "SendMessage", exact: true })).toBeVisible();
  });

  test("operations tab search and Try it open the API Explorer", async ({ page }) => {
    await page.goto("/services/sqs?tab=operations");
    const main = page.getByRole("main");
    await main.getByLabel("Search").fill("ListQueues");
    const table = main.getByRole("table", { name: "Operations" });
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table.getByRole("row").nth(1)).toContainText(/Supported|Unsupported|Untested/);
    await main.getByRole("link", { name: "Try it: ListQueues" }).click();
    await expect(page).toHaveURL(/\/api-explorer\?service=sqs&operation=ListQueues/);
    await expect(main.getByLabel("Operation", { exact: true })).toHaveValue("ListQueues");
  });

  test("embedded API Explorer tab executes against the service", async ({ page }) => {
    await page.goto("/services/sqs?tab=api-explorer");
    const main = page.getByRole("main");
    await expect(main.getByLabel("Operation", { exact: true })).toHaveValue("ListQueues");
    await main.getByRole("button", { name: "Execute", exact: true }).click();
    await expect(main.getByText("Status: 200", { exact: true })).toBeVisible();
  });

  test("resources tab renders a console or the generic resource table", async ({ page }) => {
    await page.goto("/services/logs?tab=resources");
    const main = page.getByRole("main");
    await expect(main.getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
    // CloudWatch Logs has no dedicated console: the generic table (or its empty state) is shown.
    await expect(main.getByRole("table", { name: "Resources" }).or(main.getByText(/^No log-groups/))).toBeVisible();
  });

  test("unknown service shows a not found state", async ({ page }) => {
    await page.goto("/services/not-a-service");
    await expect(page.getByText("No such service")).toBeVisible();
  });
});
