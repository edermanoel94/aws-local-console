import { expect, test } from "@playwright/test";
import { uniqueName } from "../support/names";
import { cleanup } from "../support/cleanup";
import { consolePanel, deepCleanup, expectSuccess, openConsole, openResource, openTab, row } from "../support/console";
import { addQueueTrigger, createFunction, createQueue, createTable, DELIVERY_TIMEOUT, relationship, waitForFunctionLog, waitForItem } from "./steps";

/**
 * SPEC 8 / SPEC 48 scenario 5, entirely through the UI against Floci:
 *
 *   S3 (EventBridge notifications) -> EventBridge default bus rule -> SQS -> Lambda (event source mapping) -> DynamoDB
 *
 * Uploading an object makes S3 publish an "Object Created" event; the rule forwards it to the queue; the function
 * consumes the message and writes one item per object. The SQS message itself is consumed by the event source
 * mapping, so it is verified through what the function recorded: its SQS message id and source queue ARN.
 */
const objectKey = "incoming/order-1001.json";

/** Fresh names per test run (also per --repeat-each iteration). */
function flowNames() {
  const base = uniqueName("e2e-flow");
  return { bucket: `${base}-bucket`.slice(0, 63), queue: `${base}-queue`, fn: `${base}-fn`, table: `${base}-table`, rule: `${base}-rule` };
}

const created: ReturnType<typeof flowNames>[] = [];

const FUNCTION_CODE = `import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({});

export const handler = async (event) => {
  for (const record of event.Records ?? []) {
    const message = JSON.parse(record.body);
    const key = message.detail.object.key;
    console.log("processing", message["detail-type"], key, "from", record.eventSourceARN);
    await dynamodb.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        objectKey: { S: key },
        bucket: { S: message.detail.bucket.name },
        detailType: { S: message["detail-type"] },
        sqsMessageId: { S: record.messageId },
        sourceQueue: { S: record.eventSourceARN },
      },
    }));
  }
  return { processed: event.Records?.length ?? 0 };
};
`;

test.afterAll(async () => {
  for (const { bucket, queue, fn, table, rule } of created) {
    await cleanup.eventSourceMappings(fn);
    await deepCleanup.rule(rule);
    await cleanup.function(fn);
    await cleanup.queue(queue);
    await cleanup.table(table);
    await deepCleanup.bucket(bucket);
  }
});

test.describe("Scenario: event-driven architecture", () => {
  test("S3 upload flows through EventBridge and SQS to Lambda, which writes to DynamoDB", async ({ page }) => {
    test.setTimeout(420_000);
    const names = flowNames();
    created.push(names);
    const { bucket, queue, fn, table, rule } = names;

    await test.step("create the DynamoDB table", async () => {
      await createTable(page, table, "objectKey");
    });

    await test.step("create the SQS queue", async () => {
      await createQueue(page, queue);
    });

    await test.step("create the Lambda function and its SQS trigger", async () => {
      await createFunction(page, { name: fn, code: FUNCTION_CODE, env: { TABLE_NAME: table }, timeout: 30 });
      await addQueueTrigger(page, fn, queue);
    });

    await test.step("create the EventBridge rule targeting the queue", async () => {
      await openConsole(page, "events");
      await consolePanel(page).getByRole("button", { name: "Create rule" }).click();
      await page.getByLabel("Rule name").fill(rule);
      await expect(page.getByLabel("Event bus")).toHaveValue("default");
      await page.getByLabel("Event pattern", { exact: true }).fill(
        JSON.stringify({ source: ["aws.s3"], "detail-type": ["Object Created"], detail: { bucket: { name: [bucket] } } }, null, 2),
      );
      await page.getByLabel("Target type").selectOption("sqs");
      await page.getByLabel("Target", { exact: true }).selectOption({ label: queue });
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expectSuccess(page, `Rule ${rule} created`);
      await expect(page.getByRole("heading", { level: 2, name: rule, exact: true })).toBeVisible();
      await expect(row(page, "Targets", queue)).toBeVisible();
    });

    await test.step("create the bucket and turn on EventBridge notifications", async () => {
      await openConsole(page, "s3");
      await consolePanel(page).getByRole("button", { name: "Create bucket" }).click();
      await page.getByLabel("Bucket name").fill(bucket);
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expectSuccess(page, `Bucket ${bucket} created`);
      await openResource(page, bucket);
      await openTab(page, "Properties");
      await consolePanel(page).getByRole("button", { name: "Turn on EventBridge" }).click();
      await expectSuccess(page, `Amazon EventBridge notifications turned on for ${bucket}`);
      await expect(consolePanel(page).getByRole("button", { name: "Turn off EventBridge" })).toBeVisible();
    });

    await test.step("upload an object", async () => {
      await openTab(page, "Objects");
      await consolePanel(page).getByRole("button", { name: "Upload", exact: true }).click();
      await page.getByLabel("Enter text").check();
      await page.getByLabel("Content", { exact: true }).fill('{"orderId": 1001, "total": 99.9}');
      await page.getByLabel("Object key").fill(objectKey);
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      await expectSuccess(page, `Object ${objectKey} uploaded`);
    });

    await test.step("the function processed the message (Lambda logs)", async () => {
      const logs = await waitForFunctionLog(page, fn, `processing Object Created ${objectKey}`);
      await expect(logs).toContainText(`arn:aws:sqs:us-east-1:000000000000:${queue}`);
    });

    await test.step("the item written by the function is in DynamoDB (Scan)", async () => {
      const item = await waitForItem(page, table, objectKey);
      await expect(item).toContainText(bucket);
      await expect(item).toContainText("Object Created");
      await expect(item).toContainText(`arn:aws:sqs:us-east-1:000000000000:${queue}`);
      // The SQS message id recorded by the function is a UUID.
      await expect(item).toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    });

    await test.step("the object upload and the queue delivery are recorded as events", async () => {
      await page.goto("/events");
      const main = page.getByRole("main");
      await main.getByLabel("Search").fill(bucket);
      await expect(main.getByRole("table").getByRole("row").filter({ hasText: "ObjectUploaded" }).filter({ hasText: bucket }).first()).toBeVisible({ timeout: DELIVERY_TIMEOUT });
    });

    await test.step("the Architecture Explorer shows the whole chain", async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Architecture", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Architecture" })).toBeVisible();
      const graph = page.getByRole("main").getByRole("region", { name: "Architecture graph" });
      await expect(graph.getByRole("group", { name: `S3 bucket ${bucket}` })).toBeVisible();
      await expect(graph.getByRole("group", { name: `EventBridge rule ${rule}` })).toBeVisible();
      await expect(graph.getByRole("group", { name: `SQS queue ${queue}` })).toBeVisible();
      await expect(graph.getByRole("group", { name: `Lambda function ${fn}` })).toBeVisible();
      await expect(graph.getByRole("group", { name: `DynamoDB table ${table}` })).toBeVisible();

      await expect(relationship(page, bucket, "notification", "default")).toBeVisible();
      await expect(relationship(page, rule, "rule target", queue)).toBeVisible();
      await expect(relationship(page, queue, "event source", fn)).toBeVisible();
      await expect(relationship(page, fn, "env reference", table)).toBeVisible();
    });
  });
});
