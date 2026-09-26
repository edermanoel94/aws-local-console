import { expect, test } from "@playwright/test";
import { uniqueName } from "../support/names";
import { createViaApiExplorer } from "../support/api-explorer";
import { cleanup } from "../support/cleanup";

/**
 * SPEC 25: SQS -> Lambda -> DynamoDB.
 * The queue feeds the function through an event source mapping; the function references the table in its environment.
 * Everything is created through the API Explorer UI against Floci.
 */
const base = uniqueName("e2e-arch");
const queue = `${base}-queue`;
const fn = `${base}-fn`;
const table = `${base}-table`;

test.afterAll(async () => {
  await cleanup.eventSourceMappings(fn);
  await cleanup.function(fn);
  await cleanup.queue(queue);
  await cleanup.table(table);
});

test.describe("Architecture Explorer (SPEC 25)", () => {
  test("shows SQS, Lambda and DynamoDB nodes and their relationships", async ({ page }) => {
    test.setTimeout(120_000);

    await createViaApiExplorer(page, { service: "sqs", operation: "CreateQueue", input: { QueueName: queue } });
    await createViaApiExplorer(page, {
      service: "dynamodb",
      operation: "CreateTable",
      input: {
        TableName: table,
        AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
      },
    });
    await createViaApiExplorer(page, {
      service: "lambda",
      operation: "CreateFunction",
      input: {
        FunctionName: fn,
        Runtime: "nodejs20.x",
        Handler: "index.handler",
        Role: "arn:aws:iam::000000000000:role/lambda-role",
        Code: { ZipFile: { zipFiles: { "index.mjs": "export const handler = async (event) => ({ records: event.Records?.length ?? 0 });" } } },
        Environment: { Variables: { TABLE_NAME: table } },
      },
    });
    await createViaApiExplorer(page, {
      service: "lambda",
      operation: "CreateEventSourceMapping",
      input: { EventSourceArn: `arn:aws:sqs:us-east-1:000000000000:${queue}`, FunctionName: fn, BatchSize: 1 },
    });

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Architecture", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Architecture" })).toBeVisible();
    const main = page.getByRole("main");

    // Focus the graph on Lambda: the function plus its direct neighbors.
    await main.getByLabel("Service", { exact: true }).selectOption("lambda");
    const graph = main.getByRole("region", { name: "Architecture graph" });

    const sqsNode = graph.getByRole("group", { name: `SQS queue ${queue}` });
    const lambdaNode = graph.getByRole("group", { name: `Lambda function ${fn}` });
    const tableNode = graph.getByRole("group", { name: `DynamoDB table ${table}` });
    await expect(sqsNode).toBeVisible();
    await expect(lambdaNode).toBeVisible();
    await expect(tableNode).toBeVisible();
    await expect(sqsNode).toContainText("SQS");
    await expect(lambdaNode).toContainText("Lambda");
    await expect(tableNode).toContainText("DynamoDB");

    // Relationships are listed (and drawn as labeled edges).
    const relationships = main.getByRole("table", { name: "Relationships" });
    await expect(relationships.getByRole("row").filter({ hasText: queue }).filter({ hasText: fn })).toContainText("event source");
    await expect(relationships.getByRole("row").filter({ hasText: fn }).filter({ hasText: table })).toContainText("env reference");
    await expect(graph.getByRole("group", { name: `${queue} event source ${fn}` })).toBeAttached();

    // Selecting a node shows its details.
    await lambdaNode.click();
    await expect(graph.getByText(`arn:aws:lambda:us-east-1:000000000000:function:${fn}`)).toBeVisible();

    // Refresh keeps the nodes.
    await main.getByRole("button", { name: "Refresh" }).click();
    await expect(graph.getByRole("group", { name: `DynamoDB table ${table}` })).toBeVisible();
  });

  test("renders the graph or its empty state", async ({ page }) => {
    await page.goto("/architecture");
    const main = page.getByRole("main");
    await expect(main.getByRole("region", { name: "Architecture graph" }).or(main.getByText("No resources to display"))).toBeVisible();
  });
});
