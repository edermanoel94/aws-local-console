import { expect, type Page } from "@playwright/test";
import { consolePanel, expectSuccess, openConsole, openTab, row } from "../support/console";

/**
 * UI steps shared by the E2E scenarios (SPEC 8 and 48). Every step drives a service console like a user would;
 * nothing is created through the API.
 */

/** Asynchronous deliveries (event source mapping polling, EventBridge, cold starts) get this long to show up. */
export const DELIVERY_TIMEOUT = 180_000;

export async function createTable(page: Page, name: string, partitionKey: string) {
  await openConsole(page, "dynamodb");
  await consolePanel(page).getByRole("button", { name: "Create table" }).click();
  await page.getByLabel("Table name").fill(name);
  await page.getByLabel("Partition key", { exact: true }).fill(partitionKey);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expectSuccess(page, `Table ${name} created`);
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

export async function createQueue(page: Page, name: string) {
  await openConsole(page, "sqs");
  await consolePanel(page).getByRole("button", { name: "Create queue" }).click();
  await page.getByLabel("Queue name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expectSuccess(page, `Queue ${name} created`);
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

export async function createFunction(page: Page, options: { name: string; code: string; env?: Record<string, string>; timeout?: number }) {
  await openConsole(page, "lambda");
  await consolePanel(page).getByRole("button", { name: "Create function" }).click();
  await page.getByLabel("Function name").fill(options.name);
  await page.getByLabel("Function code").fill(options.code);
  if (options.timeout) await page.getByLabel("Timeout (seconds)").fill(String(options.timeout));
  let index = 0;
  for (const [key, value] of Object.entries(options.env ?? {})) {
    index += 1;
    await page.getByRole("button", { name: "Add environment variable" }).click();
    await page.getByLabel(`Key ${index}`, { exact: true }).fill(key);
    await page.getByLabel(`Value ${index}`, { exact: true }).fill(value);
  }
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expectSuccess(page, `Function ${options.name} created`);
  await expect(page.getByRole("heading", { level: 2, name: options.name, exact: true })).toBeVisible();
}

/** Adds an SQS trigger (event source mapping) from the function's Triggers tab; the function page must be open. */
export async function addQueueTrigger(page: Page, functionName: string, queue: string) {
  await openTab(page, "Triggers");
  await consolePanel(page).getByRole("button", { name: "Add trigger" }).click();
  const dialog = page.getByRole("dialog", { name: "Add trigger" });
  await dialog.getByLabel("SQS queue").selectOption({ label: queue });
  await dialog.getByLabel("Batch size").fill("1");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expectSuccess(page, `Trigger ${queue} added to ${functionName}`);
  await expect(dialog).toBeHidden();
  const trigger = row(page, "Triggers", queue);
  await expect(trigger).toContainText("SQS");
  await expect(async () => {
    await consolePanel(page).getByRole("button", { name: "Refresh" }).click();
    await expect(trigger).toContainText("Enabled", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** Scans the table from the DynamoDB console until an item whose row contains `text` shows up; returns that row. */
export async function waitForItem(page: Page, table: string, text: string) {
  await openConsole(page, "dynamodb");
  await consolePanel(page).getByRole("link", { name: table, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: table, exact: true })).toBeVisible();
  await openTab(page, "Explore items");
  const item = row(page, "Items", text);
  await expect(async () => {
    await consolePanel(page).getByRole("button", { name: "Refresh" }).click();
    await expect(item).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: DELIVERY_TIMEOUT, intervals: [1_000, 2_000, 3_000] });
  return item;
}

/** Opens the function's Logs tab and refreshes until a log line contains `text`. */
export async function waitForFunctionLog(page: Page, functionName: string, text: string) {
  await openConsole(page, "lambda");
  await consolePanel(page).getByRole("link", { name: functionName, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: functionName, exact: true })).toBeVisible();
  await openTab(page, "Logs");
  const logEvents = page.getByRole("list", { name: "Log events" });
  await expect(async () => {
    await consolePanel(page).getByRole("button", { name: "Refresh" }).click();
    await expect(logEvents).toContainText(text, { timeout: 2_000 });
  }).toPass({ timeout: DELIVERY_TIMEOUT, intervals: [1_000, 2_000, 3_000] });
  return logEvents;
}

/** Architecture Explorer: the "Relationships" row from `source` to `target` with the given label. */
export function relationship(page: Page, source: string, label: string, target: string) {
  return page
    .getByRole("main")
    .getByRole("table", { name: "Relationships" })
    .getByRole("row")
    .filter({ hasText: source })
    .filter({ hasText: target })
    .filter({ hasText: label });
}
