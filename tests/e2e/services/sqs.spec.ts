import { expect, test, type Page } from "@playwright/test";
import { uniqueName } from "../support/names";
import { cleanup } from "../support/cleanup";
import { copyToClipboard } from "../support/clipboard";
import { consolePanel, deleteWithConfirmation, expectSuccess, openConsole, openTab, row } from "../support/console";
import { createQueueInConsole as createQueue } from "../support/sqs";

/** SPEC 18 (SQS) and SPEC 48 scenario 2, through the SQS console. */
const queues: string[] = [];

test.afterAll(async () => {
  for (const q of queues) await cleanup.queue(q);
});

async function sendMessage(page: Page, body: string, fifo?: { groupId: string; deduplicationId?: string }) {
  await page.getByLabel("Message body").fill(body);
  if (fifo) await page.getByLabel("Message group ID").fill(fifo.groupId);
  if (fifo?.deduplicationId) await page.getByLabel("Message deduplication ID").fill(fifo.deduplicationId);
  await page.getByRole("button", { name: "Send message" }).click();
  await expectSuccess(page, "Message sent to");
}

/** Value of one entry of the queue "Details" panel. */
function detailValue(page: Page, label: string) {
  return consolePanel(page).getByRole("term").filter({ hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
}

async function receiveMessages(page: Page) {
  await page.getByRole("button", { name: "Receive messages" }).click();
}

test.describe("SQS console", () => {
  test("creates a queue, sends, receives, deletes and purges messages, then deletes the queue (scenario 2)", async ({ page }) => {
    const queue = uniqueName("e2e-sqs");
    queues.push(queue);
    await createQueue(page, queue);

    await sendMessage(page, '{"orderId":"A-1"}');
    await receiveMessages(page);
    const message = row(page, "Received messages", '{"orderId":"A-1"}');
    await expect(message).toBeVisible();

    // Message details expand inline.
    await message.getByRole("button", { expanded: false }).click();
    await expect(page.getByLabel("Message body content")).toContainText('"orderId": "A-1"');
    expect(await copyToClipboard(page.getByRole("table", { name: "Received messages" }))).toBe('{\n  "orderId": "A-1"\n}');

    await message.getByRole("button", { name: "Delete message" }).click();
    await expectSuccess(page, /Message .* deleted/);
    await expect(page.getByText("No messages received")).toBeVisible();

    // Purge.
    await sendMessage(page, "to be purged 1");
    await sendMessage(page, "to be purged 2");
    await consolePanel(page).getByRole("button", { name: "Purge", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel('Type "purge" to confirm').fill("purge");
    await dialog.getByRole("button", { name: "Confirm purge" }).click();
    await expectSuccess(page, `Queue ${queue} purged`);
    await receiveMessages(page);
    await expect(page.getByText("No messages received")).toBeVisible();

    // The queue is listed, then deleted.
    await consolePanel(page).getByRole("link", { name: "Queues" }).click();
    await expect(row(page, "Queues", queue)).toBeVisible();
    await consolePanel(page).getByRole("link", { name: queue, exact: true }).click();
    await deleteWithConfirmation(page, queue);
    await expectSuccess(page, `Queue ${queue} deleted`);
    await expect(consolePanel(page).getByRole("heading", { name: "Queues" })).toBeVisible();
    await expect(row(page, "Queues", queue)).toHaveCount(0);
  });

  test("creates a FIFO queue with custom attributes", async ({ page }) => {
    const base = uniqueName("e2e-sqs-fifo");
    const queue = await createQueue(page, base, { fifo: true, visibilityTimeout: "45" });
    queues.push(queue);

    await expect(consolePanel(page).getByText("FIFO", { exact: true }).first()).toBeVisible();
    await expect(consolePanel(page).getByText("45 seconds")).toBeVisible();

    await expect(detailValue(page, "Content-based deduplication")).toHaveText("Disabled");

    // Without content-based deduplication, SQS requires a deduplication ID: the form says so before sending.
    await page.getByLabel("Message body").fill("first in line");
    await page.getByLabel("Message group ID").fill("orders");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Message deduplication ID is required because content-based deduplication is disabled")).toBeVisible();
    await sendMessage(page, "first in line", { groupId: "orders", deduplicationId: "order-1" });
    await receiveMessages(page);
    await expect(row(page, "Received messages", "first in line")).toBeVisible();

    // Edit attributes: longer visibility timeout and content-based deduplication.
    await openTab(page, "Configuration");
    await page.getByLabel("Visibility timeout (seconds)").fill("60");
    await page.getByLabel("Content-based deduplication").check();
    await consolePanel(page).getByRole("button", { name: "Save", exact: true }).click();
    await expectSuccess(page, `Queue ${queue} updated`);
    await expect(consolePanel(page).getByText("1 minute")).toBeVisible();
    await expect(detailValue(page, "Content-based deduplication")).toHaveText("Enabled");

    // With content-based deduplication the deduplication ID is optional.
    await openTab(page, "Send and receive messages");
    await sendMessage(page, "second in line", { groupId: "orders" });
  });

  test("validates the queue name", async ({ page }) => {
    await openConsole(page, "sqs");
    await consolePanel(page).getByRole("button", { name: "Create queue" }).click();
    await page.getByLabel("Queue name").fill("bad name!");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Queue names can contain only alphanumeric characters")).toBeVisible();
  });
});
