import { expect, test, type Page } from "@playwright/test";
import { uniqueName } from "../support/names";
import { cleanup } from "../support/cleanup";
import { consolePanel, deleteWithConfirmation, expectSuccess, openConsole, row } from "../support/console";

/** SPEC 17 (DynamoDB) and SPEC 48 scenario 3, through the DynamoDB console. */
const tables: string[] = [];

test.afterAll(async () => {
  for (const t of tables) await cleanup.table(t);
});

async function createTable(page: Page, name: string, keys: { partition: string; sort?: string }) {
  await openConsole(page, "dynamodb");
  await consolePanel(page).getByRole("button", { name: "Create table" }).click();
  await page.getByLabel("Table name").fill(name);
  await page.getByLabel("Partition key", { exact: true }).fill(keys.partition);
  if (keys.sort) await page.getByLabel("Sort key", { exact: true }).fill(keys.sort);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expectSuccess(page, `Table ${name} created`);
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

async function putItem(page: Page, item: Record<string, unknown>) {
  await consolePanel(page).getByRole("button", { name: "Create item" }).click();
  const dialog = page.getByRole("dialog", { name: "Create item" });
  await dialog.getByLabel("Item", { exact: true }).fill(JSON.stringify(item, null, 2));
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expectSuccess(page, "Item created");
  await expect(dialog).toBeHidden();
}

/** Row of the "Items" table for the item with the given sort key value. */
function itemRow(page: Page, sortKey: string) {
  return row(page, "Items", sortKey);
}

/** Opens an item (GetItem) by clicking its partition key value. */
async function openItem(page: Page, partitionKey: string, sortKey: string) {
  await itemRow(page, sortKey).getByRole("button", { name: partitionKey, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await expect(dialog.getByLabel("Item", { exact: true })).toBeVisible();
  return dialog;
}

async function runQuery(page: Page, partitionValue: string, sort?: { condition: string; value: string }) {
  const panel = consolePanel(page);
  await panel.getByRole("radio", { name: "Query" }).check();
  await panel.getByLabel("Partition key value").fill(partitionValue);
  await panel.getByLabel("Sort key condition").selectOption({ label: sort?.condition ?? "No condition" });
  if (sort) await panel.getByLabel("Sort key value").fill(sort.value);
  await panel.getByRole("button", { name: "Run", exact: true }).click();
}

test.describe("DynamoDB console", () => {
  test("creates a table, puts, gets, queries, scans, updates and deletes items, then deletes the table (scenario 3)", async ({ page }) => {
    const table = uniqueName("e2e-ddb");
    tables.push(table);
    await createTable(page, table, { partition: "customerId", sort: "orderId" });

    // Key schema is shown in the overview.
    await consolePanel(page).getByRole("tab", { name: "Overview" }).click();
    await expect(consolePanel(page).getByText("customerId (String)")).toBeVisible();
    await expect(consolePanel(page).getByText("orderId (String)")).toBeVisible();
    await consolePanel(page).getByRole("tab", { name: "Explore items" }).click();
    await expect(consolePanel(page).getByText("No items", { exact: true })).toBeVisible();

    // Put items.
    await putItem(page, { customerId: "c-1", orderId: "o-1", status: "NEW", amount: 10 });
    await putItem(page, { customerId: "c-1", orderId: "o-2", status: "NEW", amount: 25 });
    await putItem(page, { customerId: "c-2", orderId: "o-3", status: "PAID", amount: 7 });

    // Scan returns every item.
    const items = consolePanel(page).getByRole("table", { name: "Items" });
    await expect(items.getByRole("row")).toHaveCount(4);
    await expect(consolePanel(page).getByText("Scan returned 3 items (3 scanned).")).toBeVisible();

    // Get item.
    let dialog = await openItem(page, "c-1", "o-2");
    await expect(dialog.getByLabel("Item", { exact: true })).toHaveValue(/"amount": 25/);
    await expect(dialog.getByLabel("Item", { exact: true })).toHaveValue(/"status": "NEW"/);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Query by partition key, then with a sort key condition.
    await runQuery(page, "c-1");
    await expect(consolePanel(page).getByText("Query returned 2 items (2 scanned).")).toBeVisible();
    await expect(itemRow(page, "o-1")).toBeVisible();
    await expect(itemRow(page, "o-2")).toBeVisible();
    await expect(itemRow(page, "o-3")).toHaveCount(0);
    await runQuery(page, "c-1", { condition: "Equal to", value: "o-2" });
    await expect(consolePanel(page).getByText("Query returned 1 item (1 scanned).")).toBeVisible();
    await expect(items.getByRole("row")).toHaveCount(2);
    await expect(itemRow(page, "o-2")).toBeVisible();

    // Update item.
    dialog = await openItem(page, "c-1", "o-2");
    await dialog.getByLabel("Item", { exact: true }).fill(JSON.stringify({ customerId: "c-1", orderId: "o-2", status: "SHIPPED", amount: 25, carrier: "ups" }, null, 2));
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expectSuccess(page, "Item saved");
    await expect(dialog).toBeHidden();
    await expect(itemRow(page, "o-2")).toContainText("SHIPPED");
    await expect(itemRow(page, "o-2")).toContainText("ups");

    // Delete item, then scan again.
    dialog = await openItem(page, "c-1", "o-2");
    await expect(dialog.getByLabel("Item", { exact: true })).toHaveValue(/"status": "SHIPPED"/);
    await dialog.getByRole("button", { name: "Delete item" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete item" });
    await confirm.getByRole("button", { name: "Confirm delete" }).click();
    await expectSuccess(page, "Item deleted");
    await expect(confirm).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(consolePanel(page).getByText("No items", { exact: true })).toBeVisible();

    await consolePanel(page).getByRole("radio", { name: "Scan" }).check();
    await consolePanel(page).getByRole("button", { name: "Run", exact: true }).click();
    await expect(consolePanel(page).getByText("Scan returned 2 items (2 scanned).")).toBeVisible();
    await expect(itemRow(page, "o-1")).toBeVisible();
    await expect(itemRow(page, "o-3")).toBeVisible();
    await expect(itemRow(page, "o-2")).toHaveCount(0);

    // The table is listed, then deleted.
    await consolePanel(page).getByRole("link", { name: "Tables" }).click();
    await expect(row(page, "Tables", table)).toBeVisible();
    await consolePanel(page).getByRole("link", { name: table, exact: true }).click();
    await deleteWithConfirmation(page, table);
    await expectSuccess(page, `Table ${table} deleted`);
    await expect(consolePanel(page).getByRole("heading", { name: "Tables" })).toBeVisible();
    await expect(row(page, "Tables", table)).toHaveCount(0);
  });

  test("shows the AWS error when an item with the same key already exists", async ({ page }) => {
    const table = uniqueName("e2e-ddb-dup");
    tables.push(table);
    await createTable(page, table, { partition: "id" });
    await putItem(page, { id: "same" });

    await consolePanel(page).getByRole("button", { name: "Create item" }).click();
    const dialog = page.getByRole("dialog", { name: "Create item" });
    await dialog.getByLabel("Item", { exact: true }).fill('{"id": "same"}');
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("ConditionalCheckFailedException");
  });
});
