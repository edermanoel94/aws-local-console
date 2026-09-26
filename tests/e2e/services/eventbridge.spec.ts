import { expect, test, type Page } from "@playwright/test";
import { uniqueName } from "../support/names";
import { cleanup } from "../support/cleanup";
import { consolePanel, deepCleanup, deleteWithConfirmation, expectSuccess, openConsole, openResource, row } from "../support/console";
import { createQueueInConsole, openQueueInConsole, receiveUntilMessage } from "../support/sqs";

/** SPEC 22 (EventBridge): custom bus, rule with an event pattern, SQS target, PutEvents, delivery through the SQS console, delete rule and bus. */
const buses: string[] = [];
const rules: { name: string; bus: string }[] = [];
const queues: string[] = [];

test.afterAll(async () => {
  for (const r of rules) await deepCleanup.rule(r.name, r.bus);
  for (const b of buses) await deepCleanup.bus(b);
  for (const q of queues) await cleanup.queue(q);
});

/** Heading of a list panel, which carries the item count ("Rules (2)"). */
function listHeading(page: Page, title: string) {
  return consolePanel(page).getByRole("heading", { name: new RegExp(`^${title}( \\(\\d+\\))?$`) });
}

async function openSection(page: Page, name: "Rules" | "Event buses") {
  await openConsole(page, "events");
  await consolePanel(page).getByRole("tablist", { name: "EventBridge sections" }).getByRole("tab", { name, exact: true }).click();
  await expect(listHeading(page, name)).toBeVisible();
}

test.describe("EventBridge console", () => {
  test("creates a bus and a rule targeting a queue, sends events, verifies delivery, then deletes the rule and the bus", async ({ page }) => {
    const queue = uniqueName("e2e-evb-q");
    const bus = uniqueName("e2e-evb-bus");
    const rule = uniqueName("e2e-evb-rule");
    const source = `e2e.${uniqueName("orders")}`;
    const orderId = uniqueName("order");
    queues.push(queue);
    buses.push(bus);
    rules.push({ name: rule, bus });

    // Target queue, created through the SQS console.
    await createQueueInConsole(page, queue);

    // Event bus.
    await openSection(page, "Event buses");
    await expect(row(page, "Event buses", "default")).toBeVisible();
    await consolePanel(page).getByRole("button", { name: "Create event bus" }).click();
    await page.getByLabel("Event bus name").fill(bus);
    await page.getByLabel("Description - optional").fill("Orders from the E2E suite");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expectSuccess(page, `Event bus ${bus} created`);
    await expect(page.getByRole("heading", { level: 2, name: bus, exact: true })).toBeVisible();
    await expect(consolePanel(page).getByText("Orders from the E2E suite")).toBeVisible();
    await expect(consolePanel(page).getByText("No rules", { exact: true })).toBeVisible();

    // Rule with an event pattern and the queue as target.
    await consolePanel(page).getByRole("button", { name: "Create rule" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Create rule" })).toBeVisible();
    await page.getByLabel("Rule name").fill(rule);
    await expect(page.getByLabel("Event bus", { exact: true })).toHaveValue(bus);
    await page.getByLabel("Event pattern", { exact: true }).fill(JSON.stringify({ source: [source], "detail-type": ["Order Placed"] }, null, 2));
    await expect(page.getByLabel("Target type")).toHaveValue("sqs");
    await page.getByLabel("Target", { exact: true }).selectOption({ label: queue });
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expectSuccess(page, `Rule ${rule} created`);
    await expect(page.getByRole("heading", { level: 2, name: rule, exact: true })).toBeVisible();
    await expect(page.getByLabel("Event pattern JSON")).toContainText(source);
    const target = row(page, "Targets", queue);
    await expect(target).toBeVisible();
    await expect(target).toContainText("SQS queue");

    // Publish events (PutEvents): one that does not match the pattern, then one that does.
    await consolePanel(page).getByRole("link", { name: "Rules" }).click();
    await expect(row(page, "Rules", rule)).toBeVisible();
    await consolePanel(page).getByRole("button", { name: "Send events" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Send events" })).toBeVisible();
    await expect(page.getByLabel("Event bus", { exact: true })).toHaveValue(bus);
    await page.getByLabel("Event source").fill("e2e.unrelated");
    await page.getByLabel("Detail type").fill("Order Placed");
    await page.getByLabel("Event detail").fill(JSON.stringify({ orderId: `${orderId}-ignored` }));
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expectSuccess(page, `Event sent to ${bus}`);
    const accepted = page.getByText(/^Last event accepted with ID/);
    await expect(accepted).toBeVisible();
    const firstEvent = (await accepted.textContent()) ?? "";
    await page.getByLabel("Event source").fill(source);
    await page.getByLabel("Event detail").fill(JSON.stringify({ orderId, amount: 42 }));
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(accepted).toBeVisible();
    await expect(accepted).not.toHaveText(firstEvent);

    // Delivery: only the matching event reaches the queue.
    await openQueueInConsole(page, queue);
    const delivered = await receiveUntilMessage(page, `"orderId":"${orderId}"`);
    await expect(row(page, "Received messages", `${orderId}-ignored`)).toHaveCount(0);
    await delivered.getByRole("button", { expanded: false }).click();
    const body = page.getByLabel("Message body content");
    await expect(body).toContainText(`"source": "${source}"`);
    await expect(body).toContainText('"detail-type": "Order Placed"');
    await expect(body).toContainText('"amount": 42');

    // Delete the rule (its targets are removed first).
    await openSection(page, "Event buses");
    await openResource(page, bus);
    await openResource(page, rule);
    await deleteWithConfirmation(page, rule);
    await expectSuccess(page, `Rule ${rule} deleted`);
    await expect(listHeading(page, "Rules")).toBeVisible();
    await expect(consolePanel(page).getByLabel("Event bus")).toHaveValue(bus);
    await expect(consolePanel(page).getByText("No rules", { exact: true })).toBeVisible();

    // Delete the bus.
    await openSection(page, "Event buses");
    await openResource(page, bus);
    await deleteWithConfirmation(page, bus);
    await expectSuccess(page, `Event bus ${bus} deleted`);
    await expect(listHeading(page, "Event buses")).toBeVisible();
    await expect(row(page, "Event buses", bus)).toHaveCount(0);
    await expect(row(page, "Event buses", "default")).toBeVisible();
  });

  test("validates the event pattern", async ({ page }) => {
    await openSection(page, "Rules");
    await consolePanel(page).getByRole("button", { name: "Create rule" }).click();
    await page.getByLabel("Rule name").fill(uniqueName("e2e-evb-invalid"));
    await page.getByLabel("Event pattern", { exact: true }).fill("{ not json");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("The event pattern must be a non-empty JSON object.")).toBeVisible();
  });
});
