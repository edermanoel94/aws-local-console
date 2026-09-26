import { expect, test } from "@playwright/test";
import { uniqueName } from "../support/names";
import { cleanup } from "../support/cleanup";
import { consolePanel, expectSuccess, openConsole, row } from "../support/console";
import { addQueueTrigger, createFunction, createQueue, createTable, waitForFunctionLog, waitForItem } from "./steps";

/**
 * Payment flow, entirely through the UI against Floci:
 *
 *   SNS payments topic -> payments-queue (SQS subscription) -> process-payments Lambda (SQS trigger) -> payments-table
 *
 * A payment published from the SNS console ends up as an item in DynamoDB, and the Resource Explorer finds every
 * resource of the flow when searching "payments" (SPEC 26 example).
 */
/** Fresh names per test run (also per --repeat-each iteration), all containing "payments". */
function paymentNames() {
  const suffix = uniqueName("payments").replace(/^payments-/, "");
  return { topic: `payments-${suffix}`, queue: `payments-queue-${suffix}`, fn: `process-payments-${suffix}`, table: `payments-table-${suffix}`, paymentId: `pay-${suffix}` };
}

const created: ReturnType<typeof paymentNames>[] = [];

const FUNCTION_CODE = `import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({});

export const handler = async (event) => {
  for (const record of event.Records ?? []) {
    // SNS wraps the published message in a notification envelope (raw delivery is off).
    const envelope = JSON.parse(record.body);
    const payment = JSON.parse(envelope.Message);
    console.log("payment received", payment.paymentId, payment.amount, payment.currency);
    await dynamodb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        paymentId: { S: payment.paymentId },
        amount: { N: String(payment.amount) },
        currency: { S: payment.currency },
        status: { S: "PROCESSED" },
        topicArn: { S: envelope.TopicArn },
      },
    }));
  }
  return { processed: event.Records?.length ?? 0 };
};
`;

test.afterAll(async () => {
  for (const { topic, queue, fn, table } of created) {
    await cleanup.eventSourceMappings(fn);
    await cleanup.function(fn);
    await cleanup.topic(topic);
    await cleanup.queue(queue);
    await cleanup.table(table);
  }
});

test.describe("Scenario: payment flow", () => {
  test("a payment published to SNS is processed by Lambda and stored in DynamoDB", async ({ page }) => {
    test.setTimeout(420_000);
    const names = paymentNames();
    created.push(names);
    const { topic, queue, fn, table, paymentId } = names;

    await test.step("create the payments table and queue", async () => {
      await createTable(page, table, "paymentId");
      await createQueue(page, queue);
    });

    await test.step("create the payments topic and subscribe the queue", async () => {
      await openConsole(page, "sns");
      await consolePanel(page).getByRole("button", { name: "Create topic" }).click();
      await page.getByLabel("Topic name").fill(topic);
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expectSuccess(page, `Topic ${topic} created`);
      await expect(page.getByRole("heading", { level: 2, name: topic, exact: true })).toBeVisible();

      const queueArn = `arn:aws:sqs:us-east-1:000000000000:${queue}`;
      await consolePanel(page).getByRole("button", { name: "Create subscription" }).click();
      const dialog = page.getByRole("dialog", { name: "Create subscription" });
      await expect(dialog.getByLabel("Protocol")).toHaveValue("sqs");
      await dialog.getByLabel("Endpoint").fill(queueArn);
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      await expectSuccess(page, `Subscription to ${queueArn} created`);
      await expect(dialog).toBeHidden();
      await expect(row(page, "Subscriptions", queueArn)).toContainText("SQS");
    });

    await test.step("create the process-payments function with its SQS trigger", async () => {
      await createFunction(page, { name: fn, code: FUNCTION_CODE, env: { TABLE_NAME: table }, timeout: 30 });
      await addQueueTrigger(page, fn, queue);
    });

    await test.step("publish a payment from the SNS console", async () => {
      await openConsole(page, "sns");
      await consolePanel(page).getByRole("link", { name: topic, exact: true }).click();
      await consolePanel(page).getByRole("button", { name: "Publish message" }).click();
      await page.getByLabel("Subject - optional").fill("Payment received");
      await page.getByLabel("Message body").fill(JSON.stringify({ paymentId, amount: 125.5, currency: "EUR" }));
      await page.getByRole("button", { name: "Publish message" }).click();
      await expectSuccess(page, `Message published to topic ${topic}`);
    });

    await test.step("the payment is processed and stored in DynamoDB", async () => {
      await waitForFunctionLog(page, fn, `payment received ${paymentId} 125.5 EUR`);
      const item = await waitForItem(page, table, paymentId);
      await expect(item).toContainText("125.5");
      await expect(item).toContainText("EUR");
      await expect(item).toContainText("PROCESSED");
      await expect(item).toContainText(`arn:aws:sns:us-east-1:000000000000:${topic}`);
    });

    await test.step('the Resource Explorer finds the whole flow when searching "payments"', async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Resources", exact: true }).click();
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1, name: "Resource Explorer" })).toBeVisible();
      await main.getByLabel("Search").fill("payments");
      const rows = main.getByRole("table", { name: "Resources" }).getByRole("row");
      await expect(rows.filter({ hasText: queue }).filter({ hasText: "SQS" })).toBeVisible();
      await expect(rows.filter({ hasText: table }).filter({ hasText: "DynamoDB" })).toBeVisible();
      await expect(rows.filter({ hasText: fn }).filter({ hasText: "Lambda" }).filter({ hasText: "function" })).toBeVisible();
      await expect(rows.filter({ hasText: `arn:aws:sns:us-east-1:000000000000:${topic}` })).toBeVisible();
    });
  });
});
