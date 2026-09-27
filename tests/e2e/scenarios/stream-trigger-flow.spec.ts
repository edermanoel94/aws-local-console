import { expect, test } from "@playwright/test";
import { uniqueName } from "../support/names";
import { cleanup } from "../support/cleanup";
import { consolePanel, expectSuccess, openConsole, openResource, openTab, row } from "../support/console";
import { createFunction, createTable, waitForFunctionLog } from "./steps";

/**
 * Change data capture entirely through the UI against Floci:
 *
 *   DynamoDB table (stream on) -> Lambda (event source mapping on the stream)
 *
 * The trigger reads the stream from its oldest record, so the item written after the trigger is created reaches the
 * function whatever the polling delay; the function logs one line per record, which the Logs tab shows.
 */
const created: { table: string; fn: string }[] = [];

const FUNCTION_CODE = `export const handler = async (event) => {
  for (const record of event.Records ?? []) {
    console.log("stream-record", record.eventName, record.dynamodb.Keys.id.S, record.eventSource);
  }
  return { processed: event.Records?.length ?? 0 };
};
`;

test.afterAll(async () => {
  for (const { table, fn } of created) {
    await cleanup.eventSourceMappings(fn);
    await cleanup.function(fn);
    await cleanup.table(table);
  }
});

test.describe("DynamoDB stream trigger flow", () => {
  test("an item written to a table with a stream invokes the Lambda trigger", async ({ page }) => {
    test.setTimeout(420_000);
    const base = uniqueName("e2e-cdc");
    const names = { table: `${base}-table`, fn: `${base}-fn` };
    created.push(names);

    await createTable(page, names.table, "id", { stream: "New and old images" });
    await createFunction(page, { name: names.fn, code: FUNCTION_CODE });

    // Trigger on the table's stream, from the function's Triggers tab.
    await openTab(page, "Triggers");
    await consolePanel(page).getByRole("button", { name: "Add trigger" }).click();
    const dialog = page.getByRole("dialog", { name: "Add trigger" });
    await dialog.getByLabel("Trigger source").selectOption({ label: "Amazon DynamoDB (stream)" });
    await dialog.getByLabel("DynamoDB table").selectOption({ label: names.table });
    await dialog.getByRole("radio", { name: /^Trim horizon/ }).check();
    await dialog.getByLabel("Batch size").fill("1");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expectSuccess(page, `Trigger ${names.table} added to ${names.fn}`);
    await expect(dialog).toBeHidden();
    const trigger = row(page, "Triggers", names.table);
    await expect(trigger).toContainText("DynamoDB");
    await expect(trigger).toContainText("Trim horizon");
    await expect(async () => {
      await consolePanel(page).getByRole("button", { name: "Refresh" }).click();
      await expect(trigger).toContainText("Enabled", { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // Write an item from the DynamoDB console.
    await openConsole(page, "dynamodb");
    await openResource(page, names.table);
    await consolePanel(page).getByRole("button", { name: "Create item" }).click();
    const itemDialog = page.getByRole("dialog", { name: "Create item" });
    await itemDialog.getByLabel("Item", { exact: true }).fill(JSON.stringify({ id: "order-1", total: 42 }, null, 2));
    await itemDialog.getByRole("button", { name: "Create", exact: true }).click();
    await expectSuccess(page, "Item created");

    // The table's Streams tab shows the record and the function consuming the stream.
    await openTab(page, "Streams");
    await expect(row(page, "Lambda triggers", names.fn)).toContainText("Trim horizon");
    await expect(row(page, "Stream records", "INSERT")).toContainText("id: order-1");

    // The function received the record.
    await waitForFunctionLog(page, names.fn, "stream-record INSERT order-1 aws:dynamodb");
  });
});
