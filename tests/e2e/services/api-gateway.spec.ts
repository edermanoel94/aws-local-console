import { expect, test, type Page } from "@playwright/test";
import { uniqueName } from "../support/names";
import { cleanup } from "../support/cleanup";
import { consolePanel, deepCleanup, deleteWithConfirmation, expectSuccess, openConsole, openTab, row } from "../support/console";

/**
 * SPEC 21 (API Gateway), through the API Gateway console against Floci:
 * create API, resources and methods (MOCK and Lambda proxy integrations), deploy to a stage, invoke through the
 * Go API invoke proxy (CONTRACT 3.3, Floci has no TestInvokeMethod), verify responses, delete.
 */
const INVOKE_TIMEOUT = 150_000;
const apis: string[] = [];
const functions: string[] = [];

test.afterAll(async () => {
  for (const name of apis) await deepCleanup.restApisNamed(name);
  for (const fn of functions) await cleanup.function(fn);
});

const PROXY_CODE = `export const handler = async (event) => {
  const order = JSON.parse(event.body ?? "{}");
  return {
    statusCode: 201,
    headers: { "Content-Type": "application/json", "X-Handled-By": "e2e-lambda" },
    body: JSON.stringify({ received: order, method: event.httpMethod, path: event.path, source: event.queryStringParameters?.source ?? null }),
  };
};
`;

async function createLambda(page: Page, name: string) {
  await openConsole(page, "lambda");
  await consolePanel(page).getByRole("button", { name: "Create function" }).click();
  await page.getByLabel("Function name").fill(name);
  await page.getByLabel("Function code").fill(PROXY_CODE);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expectSuccess(page, `Function ${name} created`);
}

async function createApi(page: Page, name: string) {
  await openConsole(page, "apigateway");
  await consolePanel(page).getByRole("button", { name: "Create API" }).click();
  await page.getByLabel("API name").fill(name);
  await page.getByLabel("Description - optional").fill("Created by Playwright");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expectSuccess(page, `API ${name} created`);
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

async function createResource(page: Page, pathPart: string) {
  await consolePanel(page).getByRole("button", { name: "Create resource" }).click();
  const dialog = page.getByRole("dialog", { name: "Create resource" });
  await expect(dialog.getByLabel("Parent resource")).toHaveValue(/.+/);
  await dialog.getByLabel("Parent resource").selectOption({ label: "/" });
  await dialog.getByLabel("Resource path").fill(pathPart);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expectSuccess(page, `Resource /${pathPart} created`);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("list", { name: "API resources" }).getByRole("button", { name: `/${pathPart}`, exact: true })).toHaveAttribute("aria-current", "true");
}

async function invokeApi(page: Page, request: { method: string; path: string; body?: string }) {
  await page.getByLabel("Method", { exact: true }).selectOption(request.method);
  await page.getByLabel("Path", { exact: true }).fill(request.path);
  await page.getByLabel("Request body").fill(request.body ?? "");
  await consolePanel(page).getByRole("button", { name: "Invoke", exact: true }).click();
}

test.describe("API Gateway console", () => {
  test("creates an API with MOCK and Lambda proxy methods, deploys, invokes and deletes it", async ({ page }) => {
    test.setTimeout(240_000);
    const api = uniqueName("e2e-apigw");
    const fn = uniqueName("e2e-apigw-fn");
    apis.push(api);
    functions.push(fn);

    await createLambda(page, fn);
    await createApi(page, api);
    await expect(consolePanel(page).getByText("REGIONAL")).toBeVisible();

    // Route 1: GET /hello answered by a MOCK integration.
    await createResource(page, "hello");
    await consolePanel(page).getByRole("button", { name: "Create method" }).click();
    let dialog = page.getByRole("dialog", { name: "Create method on /hello" });
    await dialog.getByLabel("HTTP method").selectOption("GET");
    await dialog.getByRole("radio", { name: /^Mock/ }).check();
    await dialog.getByLabel("Response status code").fill("200");
    await dialog.getByLabel("Mock response body").fill('{"message": "hello from the mock"}');
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expectSuccess(page, "Method GET /hello created");
    await expect(dialog).toBeHidden();
    await expect(consolePanel(page).getByRole("tab", { name: "GET", exact: true })).toHaveAttribute("aria-selected", "true");
    const integrationRequest = consolePanel(page).getByRole("region", { name: "Integration request" });
    await expect(integrationRequest).toContainText("Mock");
    await expect(consolePanel(page).getByRole("region", { name: "Mock response template" })).toContainText('"message": "hello from the mock"');

    // Route 2: POST /orders proxied to the Lambda function.
    await createResource(page, "orders");
    await consolePanel(page).getByRole("button", { name: "Create method" }).click();
    dialog = page.getByRole("dialog", { name: "Create method on /orders" });
    await dialog.getByLabel("HTTP method").selectOption("POST");
    await expect(dialog.getByRole("radio", { name: /^Lambda proxy/ })).toBeChecked();
    await dialog.getByLabel("Lambda function", { exact: true }).selectOption({ label: fn });
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expectSuccess(page, "Method POST /orders created");
    await expect(integrationRequest).toContainText("Lambda proxy");
    await expect(integrationRequest).toContainText(fn);

    // Deploy to a new stage.
    await consolePanel(page).getByRole("button", { name: "Deploy API" }).click();
    dialog = page.getByRole("dialog", { name: "Deploy API" });
    await expect(dialog.getByLabel("Stage", { exact: true })).toHaveValue("__new__");
    await dialog.getByLabel("Stage name").fill("dev");
    await dialog.getByLabel("Deployment description - optional").fill("first deployment");
    await dialog.getByRole("button", { name: "Deploy", exact: true }).click();
    await expectSuccess(page, "API deployed to stage dev");
    await expect(dialog).toBeHidden();

    await openTab(page, "Stages");
    const stage = row(page, "Stages", "dev");
    await expect(stage).toContainText("/restapis/");
    await expect(stage).toContainText("/dev/_user_request_");
    await expect(row(page, "Deployment history", "first deployment")).toBeVisible();

    // Invoke the MOCK route.
    await openTab(page, "Test");
    await expect(page.getByLabel("Stage", { exact: true })).toHaveValue("dev");
    await invokeApi(page, { method: "GET", path: "/hello" });
    await expect(consolePanel(page).getByText("Status: 200")).toBeVisible({ timeout: INVOKE_TIMEOUT });
    await expect(page.getByLabel("Response body")).toContainText('"message": "hello from the mock"');

    // Invoke the Lambda proxy route (cold start on first call).
    await invokeApi(page, { method: "POST", path: "/orders?source=e2e", body: '{"orderId": "A-42", "amount": 42}' });
    await expect(consolePanel(page).getByText("Status: 201")).toBeVisible({ timeout: INVOKE_TIMEOUT });
    const body = page.getByLabel("Response body");
    await expect(body).toContainText('"orderId": "A-42"');
    await expect(body).toContainText('"method": "POST"');
    await expect(body).toContainText('"path": "/orders"');
    await expect(body).toContainText('"source": "e2e"');
    await expect(page.getByRole("table", { name: "Response headers" }).getByRole("row").filter({ hasText: /x-handled-by/i })).toContainText("e2e-lambda");

    // An undefined route answers like AWS.
    await invokeApi(page, { method: "GET", path: "/missing" });
    await expect(consolePanel(page).getByText("Status: 403")).toBeVisible();
    await expect(page.getByLabel("Response body")).toContainText("Missing Authentication Token");

    // Delete the API.
    await deleteWithConfirmation(page, api);
    await expectSuccess(page, `API ${api} deleted`);
    await expect(consolePanel(page).getByRole("heading", { name: "APIs" })).toBeVisible();
    await expect(row(page, "APIs", api)).toHaveCount(0);
  });

  test("validates resource paths and asks to deploy before invoking", async ({ page }) => {
    const api = uniqueName("e2e-apigw-val");
    apis.push(api);
    await createApi(page, api);

    await consolePanel(page).getByRole("button", { name: "Create resource" }).click();
    const dialog = page.getByRole("dialog", { name: "Create resource" });
    await dialog.getByLabel("Resource path").fill("bad path");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog.getByText('Use letters, numbers, ".", "_", "-" or a path parameter such as {id} or {proxy+}.')).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    await openTab(page, "Test");
    await expect(consolePanel(page).getByText("No stages")).toBeVisible();
    await openTab(page, "Stages");
    await expect(consolePanel(page).getByText("No stages")).toBeVisible();
  });
});
