import { expect, type Page } from "@playwright/test";
import { consolePanel, expectSuccess, openConsole, openResource, row } from "./console";

/** ARN of a queue in the default region (Floci account, CONTRACT section 1). */
export function queueArn(name: string, region = "us-east-1") {
  return `arn:aws:sqs:${region}:000000000000:${name}`;
}

/** Creates a queue through the SQS console and lands on its detail page. Returns the full queue name (".fifo" added for FIFO). */
export async function createQueueInConsole(page: Page, name: string, options?: { fifo?: boolean; visibilityTimeout?: string }) {
  await openConsole(page, "sqs");
  await consolePanel(page).getByRole("button", { name: "Create queue" }).click();
  if (options?.fifo) await page.getByLabel("FIFO").check();
  await page.getByLabel("Queue name").fill(name);
  if (options?.visibilityTimeout) await page.getByLabel("Visibility timeout (seconds)").fill(options.visibilityTimeout);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const fullName = options?.fifo ? `${name}.fifo` : name;
  await expectSuccess(page, `Queue ${fullName} created`);
  await expect(page.getByRole("heading", { level: 2, name: fullName })).toBeVisible();
  return fullName;
}

/** Opens a queue from the SQS console list. */
export async function openQueueInConsole(page: Page, name: string) {
  await openConsole(page, "sqs");
  await openResource(page, name);
}

/**
 * Polls the queue from its "Send and receive messages" tab until a received message contains `text`.
 * Deliveries from SNS/EventBridge are asynchronous, so a single receive may legitimately come back empty.
 */
export async function receiveUntilMessage(page: Page, text: string | RegExp) {
  const message = row(page, "Received messages", text);
  await expect(async () => {
    await page.getByRole("button", { name: "Receive messages" }).click();
    await expect(page.getByRole("button", { name: "Receive messages" })).toBeEnabled();
    await expect(message).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return message;
}
