import { expect, test } from "@playwright/test";
import { uniqueName } from "../support/names";
import { cleanup } from "../support/cleanup";

const buckets: string[] = [];

test.afterAll(async () => {
  for (const b of buckets) await cleanup.bucket(b);
});

test.describe("CLI", () => {
  test("runs aws commands in the xterm terminal with history and clear", async ({ page }) => {
    const bucket = uniqueName("e2e-cli");
    buckets.push(bucket);
    await page.goto("/cli");
    const terminalInput = page.getByLabel("Terminal input");
    await expect(terminalInput).toBeAttached();
    await terminalInput.focus();

    const output = page.getByRole("log", { name: "Terminal output" });

    await page.keyboard.type(`aws s3 mb s3://${bucket}`);
    await page.keyboard.press("Enter");
    await expect(output).toContainText(`$ aws s3 mb s3://${bucket}`);
    await expect(output).toContainText(bucket);

    await page.keyboard.type("aws s3 ls");
    await page.keyboard.press("Enter");
    await expect(output.locator("pre", { hasText: bucket }).last()).toBeVisible();
    await expect(output).toContainText("$ aws s3 ls");

    // History: Up recalls the previous command.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(output.getByText("$ aws s3 ls", { exact: true })).toHaveCount(2);

    // Errors go to stderr with a non-zero exit code.
    await page.keyboard.type("aws sqs get-queue-url --queue-name does-not-exist-e2e");
    await page.keyboard.press("Enter");
    await expect(output).toContainText(/exit code \d+/);

    await page.keyboard.type("clear");
    await page.keyboard.press("Enter");
    await expect(output).toBeEmpty();
  });

  test("CLI commands are audited in Logs", async ({ page }) => {
    await page.goto("/cli");
    await page.getByLabel("Terminal input").focus();
    await page.keyboard.type("aws dynamodb list-tables");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("log", { name: "Terminal output" })).toContainText("TableNames");

    await page.goto("/logs");
    const main = page.getByRole("main");
    await main.getByLabel("Source").selectOption("cli");
    await main.getByLabel("Operation").fill("ListTables");
    await expect(main.getByRole("table", { name: "Logs" }).getByRole("row").nth(1)).toContainText("ListTables");
  });
});
