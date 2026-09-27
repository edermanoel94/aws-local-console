import { expect, test, type Page } from "@playwright/test";
import { uniqueName } from "../support/names";
import { cleanup } from "../support/cleanup";
import { consolePanel, deleteWithConfirmation, expectSuccess, openConsole, openTab, row } from "../support/console";

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

async function addFilter(page: Page, filter: { attribute: string; type?: string; condition: string; value?: string; upperBound?: string }) {
  const panel = consolePanel(page);
  await panel.getByRole("button", { name: "Add filter" }).click();
  const group = panel.getByRole("group", { name: /^Filter \d+$/ }).last();
  await group.getByLabel("Attribute name").fill(filter.attribute);
  if (filter.type) await group.getByLabel("Type").selectOption({ label: filter.type });
  await group.getByLabel("Condition").selectOption({ label: filter.condition });
  if (filter.value !== undefined) await group.getByLabel("Value").fill(filter.value);
  if (filter.upperBound !== undefined) await group.getByLabel("Upper bound").fill(filter.upperBound);
}

/** Queries a table or index; `index` is the option label, e.g. "GSI: status-index". */
async function runIndexQuery(page: Page, index: string, partitionValue: string, sort?: { condition: string; value: string; upperBound?: string }) {
  const panel = consolePanel(page);
  await panel.getByRole("radio", { name: "Query" }).check();
  await panel.getByLabel("Table or index").selectOption({ label: index });
  await panel.getByLabel("Partition key value").fill(partitionValue);
  if (sort) {
    await panel.getByLabel("Sort key condition").selectOption({ label: sort.condition });
    await panel.getByLabel("Sort key value").fill(sort.value);
    if (sort.upperBound !== undefined) await panel.getByLabel("Sort key upper bound").fill(sort.upperBound);
  }
}

async function run(page: Page) {
  await consolePanel(page).getByRole("button", { name: "Run", exact: true }).click();
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

  test("creates a table with global and local secondary indexes, then queries and scans them with filters", async ({ page }) => {
    const table = uniqueName("e2e-ddb-idx");
    tables.push(table);
    await openConsole(page, "dynamodb");
    await consolePanel(page).getByRole("button", { name: "Create table" }).click();
    await page.getByLabel("Table name").fill(table);
    await page.getByLabel("Partition key", { exact: true }).fill("customerId");
    await page.getByLabel("Sort key", { exact: true }).fill("orderId");

    await page.getByRole("button", { name: "Add index" }).click();
    const gsi = page.getByRole("group", { name: "Secondary index 1" });
    await gsi.getByLabel("Index name").fill("status-index");
    await gsi.getByLabel("Index partition key", { exact: true }).fill("status");
    await gsi.getByLabel("Index sort key", { exact: true }).fill("amount");
    await gsi.getByLabel("Index sort key type").selectOption({ label: "Number" });

    await page.getByRole("button", { name: "Add index" }).click();
    const lsi = page.getByRole("group", { name: "Secondary index 2" });
    await lsi.getByLabel("Index type").selectOption({ label: "Local secondary index" });
    await expect(lsi.getByLabel("Index partition key", { exact: true })).toHaveValue("customerId");
    await lsi.getByLabel("Index name").fill("amount-index");
    await lsi.getByLabel("Index sort key", { exact: true }).fill("amount");
    await lsi.getByLabel("Index sort key type").selectOption({ label: "Number" });
    await lsi.getByLabel("Attribute projections").selectOption({ label: "Include" });
    await lsi.getByLabel("Projected attributes").fill("status");

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expectSuccess(page, `Table ${table} created`);
    await expect(page.getByRole("heading", { level: 2, name: table, exact: true })).toBeVisible();

    // Both indexes are listed with their keys and projections.
    await openTab(page, "Indexes");
    const gsiRow = row(page, "Secondary indexes", "status-index");
    await expect(gsiRow).toContainText("Global");
    await expect(gsiRow).toContainText("status (String)");
    await expect(gsiRow).toContainText("amount (Number)");
    await expect(gsiRow).toContainText("All");
    const lsiRow = row(page, "Secondary indexes", "amount-index");
    await expect(lsiRow).toContainText("Local");
    await expect(lsiRow).toContainText("customerId (String)");
    await expect(lsiRow).toContainText("Include");
    // LSIs can't be deleted; GSIs can.
    await expect(lsiRow.getByRole("button", { name: /Delete index/ })).toHaveCount(0);
    await expect(gsiRow.getByRole("button", { name: "Delete index status-index" })).toBeVisible();

    await openTab(page, "Explore items");
    await putItem(page, { customerId: "c-1", orderId: "o-1", status: "NEW", amount: 10, note: "gift" });
    await putItem(page, { customerId: "c-1", orderId: "o-2", status: "PAID", amount: 25 });
    await putItem(page, { customerId: "c-1", orderId: "o-3", status: "PAID", amount: 40, note: "rush" });
    await putItem(page, { customerId: "c-2", orderId: "o-4", status: "PAID", amount: 60 });
    await putItem(page, { customerId: "c-2", orderId: "o-5", status: "NEW", amount: 5 });
    const items = consolePanel(page).getByRole("table", { name: "Items" });
    await expect(consolePanel(page).getByText("Scan returned 5 items (5 scanned).")).toBeVisible();

    // GSI query: key condition on the index keys, a filter, and descending order.
    await runIndexQuery(page, "GSI: status-index", "PAID", { condition: "Greater than", value: "20" });
    await addFilter(page, { attribute: "note", condition: "Not exists" });
    await consolePanel(page).getByLabel("Sort descending").check();
    await run(page);
    await expect(consolePanel(page).getByText("Query on index status-index returned 2 items (3 scanned).")).toBeVisible();
    await expect(items.getByRole("columnheader", { name: "status (Index partition key)" })).toBeVisible();
    await expect(items.getByRole("row").nth(1)).toContainText("o-4");
    await expect(items.getByRole("row").nth(2)).toContainText("o-2");

    // Keys of the queried index can't be filtered (DynamoDB would reject the request).
    await addFilter(page, { attribute: "amount", type: "Number", condition: "Less than", value: "60" });
    await run(page);
    await expect(consolePanel(page).getByText("amount is a key of the queried index. Use the key condition instead.")).toBeVisible();

    // LSI query with BETWEEN: only the table keys, the index key and the included attribute are projected.
    await consolePanel(page).getByRole("button", { name: "Reset" }).click();
    await runIndexQuery(page, "LSI: amount-index", "c-1", { condition: "Between", value: "10", upperBound: "30" });
    await run(page);
    await expect(consolePanel(page).getByText("Query on index amount-index returned 2 items (2 scanned).")).toBeVisible();
    await expect(itemRow(page, "o-1")).toBeVisible();
    await expect(itemRow(page, "o-2")).toBeVisible();
    await expect(items.getByRole("columnheader", { name: "status" })).toBeVisible();
    await expect(items.getByRole("columnheader", { name: "note" })).toHaveCount(0);

    // Items returned by an index open with their table key (full item through GetItem).
    const dialog = await openItem(page, "c-1", "o-1");
    await expect(dialog.getByLabel("Item", { exact: true })).toHaveValue(/"note": "gift"/);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Scan the table with filters on non-key attributes (all filters must match).
    await consolePanel(page).getByRole("button", { name: "Reset" }).click();
    await addFilter(page, { attribute: "note", condition: "Exists" });
    await run(page);
    await expect(consolePanel(page).getByText("Scan returned 2 items (5 scanned).")).toBeVisible();
    await expect(itemRow(page, "o-1")).toBeVisible();
    await expect(itemRow(page, "o-3")).toBeVisible();
    await addFilter(page, { attribute: "status", condition: "Not equal to", value: "PAID" });
    await run(page);
    await expect(consolePanel(page).getByText("Scan returned 1 item (5 scanned).")).toBeVisible();
    await expect(itemRow(page, "o-1")).toBeVisible();

    // Scan the GSI.
    await consolePanel(page).getByRole("button", { name: "Reset" }).click();
    await consolePanel(page).getByLabel("Table or index").selectOption({ label: "GSI: status-index" });
    await addFilter(page, { attribute: "amount", type: "Number", condition: "Between", value: "5", upperBound: "10" });
    await run(page);
    await expect(consolePanel(page).getByText("Scan on index status-index returned 2 items (5 scanned).")).toBeVisible();
    await expect(itemRow(page, "o-1")).toBeVisible();
    await expect(itemRow(page, "o-5")).toBeVisible();

    // Invalid values are rejected before calling DynamoDB.
    await runIndexQuery(page, "GSI: status-index", "PAID", { condition: "Greater than", value: "abc" });
    await run(page);
    await expect(consolePanel(page).getByText("Sort key value must be a number.")).toBeVisible();
  });

  test("pages through results with a page size and Load more", async ({ page }) => {
    const table = uniqueName("e2e-ddb-page");
    tables.push(table);
    await createTable(page, table, { partition: "id" });
    for (const id of ["a", "b", "c"]) await putItem(page, { id });

    const panel = consolePanel(page);
    await panel.getByLabel("Page size (Limit) - optional").fill("1");
    await run(page);
    await expect(panel.getByText("Scan returned 1 item (1 scanned). More items are available.")).toBeVisible();
    await panel.getByRole("button", { name: "Load more items" }).click();
    await expect(panel.getByText("Scan returned 2 items (2 scanned). More items are available.")).toBeVisible();
    // DynamoDB can return a continuation key for a final page that turns out empty: keep loading until it stops.
    await expect(async () => {
      const more = panel.getByRole("button", { name: "Load more items" });
      if (await more.isVisible()) await more.click();
      await expect(panel.getByText("Scan returned 3 items (3 scanned).", { exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(panel.getByRole("table", { name: "Items" }).getByRole("row")).toHaveCount(4);
    await expect(panel.getByRole("button", { name: "Load more items" })).toHaveCount(0);

    // Running the same request again starts over from the first page.
    await run(page);
    await expect(panel.getByText("Scan returned 1 item (1 scanned). More items are available.")).toBeVisible();

    await panel.getByLabel("Page size (Limit) - optional").fill("0");
    await run(page);
    await expect(panel.getByText("Page size must be a positive integer.")).toBeVisible();
  });

  test("creates, queries and deletes a global secondary index on an existing table", async ({ page }) => {
    const table = uniqueName("e2e-ddb-gsi");
    tables.push(table);
    await createTable(page, table, { partition: "id" });
    await putItem(page, { id: "1", category: "books", title: "Dune" });
    await putItem(page, { id: "2", category: "games" });
    await putItem(page, { id: "3" });

    await openTab(page, "Indexes");
    await expect(consolePanel(page).getByText("No secondary indexes")).toBeVisible();
    await consolePanel(page).getByRole("button", { name: "Create index" }).click();
    const dialog = page.getByRole("dialog", { name: "Create global secondary index" });
    await expect(dialog.getByLabel("Index type")).toHaveCount(0);

    // The index key type must match the attribute's existing definition.
    await dialog.getByLabel("Index name").fill("category-index");
    await dialog.getByLabel("Index partition key", { exact: true }).fill("id");
    await dialog.getByLabel("Index partition key type").selectOption({ label: "Number" });
    await dialog.getByRole("button", { name: "Create index" }).click();
    await expect(dialog.getByText("Attribute id is already defined as String.")).toBeVisible();

    await dialog.getByLabel("Index partition key", { exact: true }).fill("category");
    await dialog.getByLabel("Index partition key type").selectOption({ label: "String" });
    await dialog.getByLabel("Attribute projections").selectOption({ label: "Keys only" });
    await dialog.getByRole("button", { name: "Create index" }).click();
    await expectSuccess(page, "Index category-index created");
    await expect(dialog).toBeHidden();
    const indexRow = row(page, "Secondary indexes", "category-index");
    await expect(indexRow).toContainText("Global");
    await expect(indexRow).toContainText("category (String)");
    await expect(indexRow).toContainText("Keys only");

    // The new index is queryable and only holds items that have its partition key.
    await openTab(page, "Explore items");
    await runIndexQuery(page, "GSI: category-index", "books");
    await run(page);
    await expect(consolePanel(page).getByText("Query on index category-index returned 1 item (1 scanned).")).toBeVisible();
    const items = consolePanel(page).getByRole("table", { name: "Items" });
    await expect(items.getByRole("row").nth(1)).toContainText("books");
    await expect(items.getByRole("columnheader", { name: "title" })).toHaveCount(0);
    await consolePanel(page).getByRole("radio", { name: "Scan" }).check();
    await run(page);
    await expect(consolePanel(page).getByText("Scan on index category-index returned 2 items (2 scanned).")).toBeVisible();

    await openTab(page, "Indexes");
    await indexRow.getByRole("button", { name: "Delete index category-index" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete index" });
    await confirm.getByLabel("Type the name to confirm").fill("category-index");
    await confirm.getByRole("button", { name: "Confirm delete" }).click();
    await expectSuccess(page, "Index category-index deleted");
    await expect(confirm).toBeHidden();
    await expect(consolePanel(page).getByText("No secondary indexes")).toBeVisible();
  });

  test("validates secondary index definitions on the create table form", async ({ page }) => {
    await openConsole(page, "dynamodb");
    await consolePanel(page).getByRole("button", { name: "Create table" }).click();
    await page.getByLabel("Table name").fill(uniqueName("e2e-ddb-invalid"));
    await page.getByLabel("Partition key", { exact: true }).fill("id");

    await page.getByRole("button", { name: "Add index" }).click();
    const lsi = page.getByRole("group", { name: "Secondary index 1" });
    await lsi.getByLabel("Index type").selectOption({ label: "Local secondary index" });
    await lsi.getByLabel("Index name").fill("same-name");
    await lsi.getByLabel("Index sort key", { exact: true }).fill("createdAt");

    await page.getByRole("button", { name: "Add index" }).click();
    const gsi = page.getByRole("group", { name: "Secondary index 2" });
    await gsi.getByLabel("Index name").fill("same-name");
    await gsi.getByLabel("Index partition key", { exact: true }).fill("status");
    await gsi.getByLabel("Index sort key", { exact: true }).fill("status");
    await gsi.getByLabel("Attribute projections").selectOption({ label: "Include" });

    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(lsi.getByText("Local secondary indexes require a table with a sort key.")).toBeVisible();
    await expect(gsi.getByText("An index named same-name already exists.")).toBeVisible();
    await expect(gsi.getByText("The sort key must be different from the partition key.")).toBeVisible();
    await expect(gsi.getByText("Enter at least one attribute to project.")).toBeVisible();

    // Removing an index removes its errors; the page stays on the form.
    await page.getByRole("button", { name: "Remove secondary index 2" }).click();
    await expect(page.getByRole("group", { name: "Secondary index 2" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Create table" })).toBeVisible();
  });

  test("creates a table with a stream, shows its change records, and turns the stream off and on", async ({ page }) => {
    const table = uniqueName("e2e-ddb-stream");
    tables.push(table);
    await openConsole(page, "dynamodb");
    await consolePanel(page).getByRole("button", { name: "Create table" }).click();
    await page.getByLabel("Table name").fill(table);
    await page.getByLabel("Partition key", { exact: true }).fill("id");
    await page.getByLabel("Turn on DynamoDB stream").check();
    await page.getByRole("radio", { name: /New and old images/ }).check();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expectSuccess(page, `Table ${table} created`);
    await expect(page.getByRole("heading", { level: 2, name: table, exact: true })).toBeVisible();

    await openTab(page, "Overview");
    await expect(consolePanel(page).getByText("On (New and old images)")).toBeVisible();

    // Insert, modify and remove one item.
    await openTab(page, "Explore items");
    await putItem(page, { id: "1", version: 1 });
    let dialog = await openItem(page, "1", "1");
    await dialog.getByLabel("Item", { exact: true }).fill(JSON.stringify({ id: "1", version: 2 }, null, 2));
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expectSuccess(page, "Item saved");
    await expect(dialog).toBeHidden();
    dialog = await openItem(page, "1", "1");
    await dialog.getByRole("button", { name: "Delete item" }).click();
    await page.getByRole("dialog", { name: "Delete item" }).getByRole("button", { name: "Confirm delete" }).click();
    await expectSuccess(page, "Item deleted");

    // The stream shows the three changes, newest first, with old and new images.
    await openTab(page, "Streams");
    const panel = consolePanel(page);
    await expect(panel.getByText(/^On$/)).toBeVisible();
    await expect(panel.getByText("New and old images")).toBeVisible();
    await expect(panel.getByText(new RegExp(`table/${table}/stream/`))).toBeVisible();
    const records = panel.getByRole("table", { name: "Stream records" });
    await expect(records.getByRole("row")).toHaveCount(4);
    await expect(records.getByRole("row").nth(1)).toContainText("REMOVE");
    await expect(records.getByRole("row").nth(2)).toContainText("MODIFY");
    await expect(records.getByRole("row").nth(3)).toContainText("INSERT");
    await expect(records.getByRole("row").nth(2)).toContainText("id: 1");

    await records.getByRole("row").nth(2).getByRole("button", { expanded: false }).click();
    await expect(panel.getByLabel("Old image")).toContainText('"version": 1');
    await expect(panel.getByLabel("New image")).toContainText('"version": 2');
    await panel.getByRole("radio", { name: "DynamoDB JSON" }).check();
    await expect(panel.getByLabel("New image")).toContainText('"N": "2"');

    await panel.getByRole("radio", { name: "Insert" }).check();
    await expect(records.getByRole("row")).toHaveCount(2);
    await expect(records.getByRole("row").nth(1)).toContainText("INSERT");

    // Turn the stream off: the records stay readable.
    await panel.getByRole("button", { name: "Turn off" }).click();
    await page.getByRole("dialog", { name: "Turn off stream" }).getByRole("button", { name: "Turn off" }).click();
    await expectSuccess(page, `Stream of table ${table} turned off`);
    await expect(panel.getByText(/^Off$/)).toBeVisible();
    await expect(panel.getByText(/The stream is off/)).toBeVisible();

    // Turning it on again starts a new, empty stream with the chosen view type.
    await panel.getByRole("button", { name: "Turn on" }).click();
    const turnOn = page.getByRole("dialog", { name: "Turn on DynamoDB stream" });
    await turnOn.getByRole("radio", { name: /Key attributes only/ }).check();
    await turnOn.getByRole("button", { name: "Turn on stream" }).click();
    await expectSuccess(page, `Stream of table ${table} turned on`);
    await expect(panel.getByText(/^On$/)).toBeVisible();
    await expect(panel.getByText("Key attributes only")).toBeVisible();
    await expect(panel.getByText("No records", { exact: true })).toBeVisible();
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
