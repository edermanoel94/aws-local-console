import { expect, test, type Page } from "@playwright/test";
import { uniqueName } from "../support/names";
import { cleanup } from "../support/cleanup";
import { consolePanel, deleteWithConfirmation, expectSuccess, openConsole, openTab, row } from "../support/console";

/**
 * SPEC 20 (Lambda) and SPEC 48 scenario 4, through the Lambda console against real Floci containers.
 * The first invoke of a runtime starts a container (several seconds, more when Floci still has to pull the runtime image), so only invoke steps get long timeouts.
 */
const INVOKE_TIMEOUT = 150_000;
const functions: string[] = [];

test.afterAll(async () => {
  for (const fn of functions) await cleanup.function(fn);
});

const GREETER_CODE = `export const handler = async (event) => {
  const greeting = \`\${process.env.GREETING} \${event.name} from \${process.env.STAGE ?? "nowhere"}\`;
  console.log("greeter-log:", greeting);
  return { greeting, stage: process.env.STAGE ?? null };
};
`;

async function createFunction(page: Page, name: string, code: string, env: Record<string, string> = {}) {
  await openConsole(page, "lambda");
  await consolePanel(page).getByRole("button", { name: "Create function" }).click();
  await page.getByLabel("Function name").fill(name);
  await expect(page.getByLabel("Runtime")).toHaveValue("nodejs22.x");
  await expect(page.getByLabel("Handler")).toHaveValue("index.handler");
  await page.getByLabel("Function code").fill(code);
  let i = 0;
  for (const [key, value] of Object.entries(env)) {
    i += 1;
    await page.getByRole("button", { name: "Add environment variable" }).click();
    await page.getByLabel(`Key ${i}`, { exact: true }).fill(key);
    await page.getByLabel(`Value ${i}`, { exact: true }).fill(value);
  }
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expectSuccess(page, `Function ${name} created`);
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

async function invoke(page: Page, event: unknown) {
  await openTab(page, "Test");
  await page.getByLabel("Event JSON").fill(JSON.stringify(event, null, 2));
  await consolePanel(page).getByRole("button", { name: "Invoke", exact: true }).click();
}

test.describe("Lambda console", () => {
  test("creates a function with code and environment, invokes it, inspects result and logs, then deletes it (scenario 4)", async ({ page }) => {
    test.setTimeout(240_000);
    const fn = uniqueName("e2e-lambda");
    functions.push(fn);

    await createFunction(page, fn, GREETER_CODE, { GREETING: "Hello" });
    await expect(consolePanel(page).getByText("Node.js 22.x")).toBeVisible();

    // The inline code is shown back in the Code tab (remembered for this browser).
    await expect(page.getByLabel("Function code")).toHaveValue(/greeter-log/);

    // Configure the environment: the variable created with the function is listed, add a second one and save.
    await openTab(page, "Configuration");
    await expect(page.getByLabel("Key 1", { exact: true })).toHaveValue("GREETING");
    await expect(page.getByLabel("Value 1", { exact: true })).toHaveValue("Hello");
    await page.getByLabel("Value 1", { exact: true }).fill("Hi");
    await page.getByRole("button", { name: "Add environment variable" }).click();
    await page.getByLabel("Key 2", { exact: true }).fill("STAGE");
    await page.getByLabel("Value 2", { exact: true }).fill("e2e");
    await page.getByLabel("Timeout (seconds)").fill("30");
    await consolePanel(page).getByRole("button", { name: "Save", exact: true }).click();
    await expectSuccess(page, `Function ${fn} configuration saved`);
    await expect(consolePanel(page).getByText("30 sec")).toBeVisible();

    // Reloading shows the persisted environment.
    await page.reload();
    await expect(page.getByLabel("Key 2", { exact: true })).toHaveValue("STAGE");
    await expect(page.getByLabel("Value 1", { exact: true })).toHaveValue("Hi");

    // Invoke and view the result.
    await invoke(page, { name: "Ada" });
    await expect(consolePanel(page).getByText("Execution result: succeeded")).toBeVisible({ timeout: INVOKE_TIMEOUT });
    const payload = page.getByLabel("Response payload");
    await expect(payload).toContainText('"greeting": "Hi Ada from e2e"');
    await expect(payload).toContainText('"stage": "e2e"');
    await expect(consolePanel(page).getByText("Status code", { exact: true }).locator("..")).toContainText("200");

    // The invocation's log output is tailed from CloudWatch Logs.
    await expect(page.getByLabel("Log output")).toContainText("greeter-log: Hi Ada from e2e", { timeout: 30_000 });

    // Logs tab lists the function's CloudWatch Logs events.
    await openTab(page, "Logs");
    const logEvents = page.getByRole("list", { name: "Log events" });
    await expect(async () => {
      await consolePanel(page).getByRole("button", { name: "Refresh" }).click();
      await expect(logEvents).toContainText("greeter-log: Hi Ada from e2e", { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(consolePanel(page).getByText(`/aws/lambda/${fn}`)).toBeVisible();

    // Delete the function.
    await deleteWithConfirmation(page, fn);
    await expectSuccess(page, `Function ${fn} deleted`);
    await expect(consolePanel(page).getByRole("heading", { name: "Functions" })).toBeVisible();
    await expect(row(page, "Functions", fn)).toHaveCount(0);
  });

  test("shows a failed execution with the function error", async ({ page }) => {
    test.setTimeout(240_000);
    const fn = uniqueName("e2e-lambda-err");
    functions.push(fn);
    await createFunction(page, fn, `export const handler = async () => {\n  throw new Error("boom from e2e");\n};\n`);

    await invoke(page, {});
    await expect(consolePanel(page).getByText("Execution result: failed")).toBeVisible({ timeout: INVOKE_TIMEOUT });
    await expect(consolePanel(page).getByText("Function error", { exact: true }).locator("..")).toContainText("Unhandled");
    await expect(page.getByLabel("Response payload")).toContainText("boom from e2e");
  });

  test("lists functions and validates the create form", async ({ page }) => {
    await openConsole(page, "lambda");
    await expect(consolePanel(page).getByRole("table", { name: "Functions" }).or(consolePanel(page).getByText("No functions"))).toBeVisible();

    await consolePanel(page).getByRole("button", { name: "Create function" }).click();
    await page.getByLabel("Function name").fill("bad name!");
    await page.getByLabel("Handler").fill("index");
    await page.getByRole("button", { name: "Add environment variable" }).click();
    await page.getByLabel("Key 1", { exact: true }).fill("1BAD");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Function names can contain only letters, numbers, hyphens (-) and underscores (_).")).toBeVisible();
    await expect(page.getByText('Handlers look like "file.function", e.g. index.handler.')).toBeVisible();

    // Once the fields are valid, the environment variable names are checked too.
    await page.getByLabel("Function name").fill(uniqueName("e2e-lambda-invalid"));
    await page.getByLabel("Handler").fill("index.handler");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText('"1BAD" is not a valid environment variable name.')).toBeVisible();

    // Switching the runtime swaps the default handler and code template.
    await page.getByLabel("Runtime").selectOption("python3.12");
    await expect(page.getByLabel("Handler")).toHaveValue("lambda_function.lambda_handler");
    await expect(page.getByLabel("Function code")).toHaveValue(/def lambda_handler/);
    await expect(consolePanel(page).getByText("lambda_function.py")).toBeVisible();
  });
});
