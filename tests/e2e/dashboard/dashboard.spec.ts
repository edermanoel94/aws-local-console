import { expect, test } from "@playwright/test";
import { uniqueName } from "../support/names";
import { createViaApiExplorer } from "../support/api-explorer";
import { cleanup } from "../support/cleanup";

const queues: string[] = [];

test.afterAll(async () => {
  for (const q of queues) await cleanup.queue(q);
});

test.describe("Dashboard", () => {
  test("root redirects to the dashboard and the shell is rendered", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

    const banner = page.getByRole("banner");
    await expect(banner.getByText("AWS Local Console")).toBeVisible();
    await expect(banner.getByRole("button", { name: /Search.*Ctrl K/ })).toBeVisible();
    await expect(banner.getByLabel("Region")).toHaveValue("us-east-1");
    await expect(banner.getByRole("link", { name: /Floci.*Healthy/ })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Dashboard", "Services", "Resources", "API Explorer", "Cost Simulator", "Architecture", "Events", "Logs", "CLI", "Settings"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("works when opened from another host name (API is proxied through the console origin)", async ({ page, baseURL }) => {
    // Regression: the browser used to call the Go API directly, so any origin other than
    // the exact console origin (127.0.0.1, a LAN IP, a tunnel) failed with "Failed to fetch".
    const url = new URL("/dashboard", baseURL);
    url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
    await page.goto(url.toString());

    // Before the fix the status pill said "API offline" and every panel stayed in its loading state.
    await expect(page.getByRole("banner").getByRole("link", { name: /Floci.*Healthy/ })).toBeVisible();
    const status = page.getByRole("region", { name: "Floci Status" });
    await expect(status.getByText("Healthy", { exact: true })).toBeVisible();
    // The stat cards show "-" when the API call fails, so a number proves data arrived through the proxy.
    await expect(page.getByRole("region", { name: "Services", exact: true })).toContainText(/\d+/);
    await expect(page.getByText(/API offline|unreachable|Failed to fetch/i)).toHaveCount(0);
  });

  test("dashboard should display Floci status (SPEC 15)", async ({ page }) => {
    await page.goto("/dashboard");
    const status = page.getByRole("region", { name: "Floci Status" });
    await expect(status.getByText("Floci", { exact: true })).toBeVisible();
    await expect(status.getByText("Healthy", { exact: true })).toBeVisible();
    await expect(status.getByText("http://", { exact: false })).toBeVisible();
    await expect(status.getByText(/^\d+ms$/)).toBeVisible();
  });

  test("shows Services, Resources and Regions counts", async ({ page }) => {
    await page.goto("/dashboard");
    for (const name of ["Services", "Resources", "Regions"]) {
      const card = page.getByRole("region", { name, exact: true });
      await expect(card).toBeVisible();
      await expect(card.getByText(/^\d+$/)).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "Regions", exact: true }).getByText(/^\d+$/)).not.toHaveText("0");
    await page.getByRole("region", { name: "Services", exact: true }).getByRole("link", { name: "Services" }).click();
    await expect(page).toHaveURL(/\/services$/);
  });

  test("lists recent operations and links them to the log detail", async ({ page }) => {
    const queue = uniqueName("e2e-dash");
    queues.push(queue);
    await createViaApiExplorer(page, { service: "sqs", operation: "CreateQueue", input: { QueueName: queue } });

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" }).click();
    const panelHeading = page.getByRole("heading", { name: /Recent Operations/ });
    await expect(panelHeading).toBeVisible();
    const table = page.getByRole("table", { name: "Recent operations" });
    await expect(table.getByRole("columnheader", { name: "Service" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Operation" })).toBeVisible();
    await expect(table.getByRole("row").nth(1)).toBeVisible();

    await table.getByRole("row").nth(1).getByRole("link").click();
    await expect(page).toHaveURL(/\/logs\?id=op_/);
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("favorites can be toggled from Services and appear on the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    const favorites = page.getByRole("region", { name: "Favorites" });
    await expect(favorites.getByText("No favorites yet")).toBeVisible();

    await page.goto("/services");
    const star = page.getByRole("button", { name: "Favorite SQS" });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" }).click();
    await expect(favorites.getByRole("link", { name: "SQS" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Favorites" }).getByRole("link", { name: "SQS" })).toBeVisible();

    await favorites.getByRole("button", { name: "Favorite SQS" }).click();
    await expect(favorites.getByText("No favorites yet")).toBeVisible();
  });

  test("global search (Ctrl+K) finds services, pages and operations", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    const input = palette.getByLabel("Search");
    await expect(input).toBeFocused();

    await input.fill("dynamo");
    await expect(palette.getByRole("option", { name: /DynamoDB/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/services\/dynamodb$/);
    await expect(palette).toBeHidden();

    await page.getByRole("banner").getByRole("button", { name: /Search/ }).click();
    await palette.getByLabel("Search").fill("ListQueues");
    const option = palette.getByRole("option", { name: /ListQueues/ });
    await expect(option).toBeVisible();
    await option.click();
    await expect(page).toHaveURL(/\/api-explorer\?service=sqs&operation=ListQueues/);

    await page.keyboard.press("Control+k");
    await palette.getByLabel("Search").fill("logs");
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("global search finds resources by name", async ({ page }) => {
    const queue = uniqueName("e2e-search");
    queues.push(queue);
    await createViaApiExplorer(page, { service: "sqs", operation: "CreateQueue", input: { QueueName: queue, tags: { owner: queue } } });

    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByLabel("Search").fill(queue);
    const option = palette.getByRole("option", { name: new RegExp(queue) });
    await expect(option).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await option.click();
    await expect(page).toHaveURL(/\/resources\?q=/);
    await expect(page.getByRole("dialog", { name: queue })).toBeVisible();
  });

  test("settings shows the endpoint and can change the default region", async ({ page }) => {
    await page.goto("/settings");
    const main = page.getByRole("main");
    await expect(main.getByRole("definition").filter({ hasText: /^https?:\/\/\S+:4566$/ })).toBeVisible();
    await main.getByLabel("Default region").selectOption("us-west-2");
    await expect(page.getByRole("banner").getByLabel("Region")).toHaveValue("us-west-2");
    await page.getByRole("banner").getByLabel("Region").selectOption("us-east-1");
    await expect(main.getByLabel("Default region")).toHaveValue("us-east-1");
  });
});
