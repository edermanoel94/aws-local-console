import { expect, type Page } from "@playwright/test";

export interface ExplorerRun {
  service: string;
  operation: string;
  input?: Record<string, unknown>;
}

/**
 * Executes one operation through the API Explorer UI (a real user flow, no API shortcuts) and waits for the result.
 * The "Input" label targets the JSON editor's plain-text mirror, which stays two-way synced with Monaco.
 * Returns the HTTP status shown in the result ("Status: 200").
 */
export async function runInApiExplorer(page: Page, run: ExplorerRun): Promise<number> {
  await page.goto(`/api-explorer?service=${encodeURIComponent(run.service)}&operation=${encodeURIComponent(run.operation)}`);
  const main = page.getByRole("main");
  await expect(main.getByLabel("Operation", { exact: true })).toHaveValue(run.operation);
  await expect(main.getByLabel("Operation", { exact: true })).toBeEnabled();
  await main.getByLabel("Input", { exact: true }).fill(JSON.stringify(run.input ?? {}, null, 2));
  await main.getByRole("button", { name: "Execute", exact: true }).click();
  const status = main.getByText(/^Status: \d+$/);
  await expect(status).toBeVisible();
  const text = (await status.textContent()) ?? "";
  return Number(text.replace(/\D/g, ""));
}

/** Runs an operation through the API Explorer UI and asserts it succeeded (any 2xx, e.g. Lambda CreateFunction answers 201). */
export async function createViaApiExplorer(page: Page, run: ExplorerRun): Promise<void> {
  const status = await runInApiExplorer(page, run);
  if (status < 200 || status >= 300) {
    const alerts = page.getByRole("main").getByRole("alert");
    const alert = (await alerts.count()) > 0 ? await alerts.first().textContent() : "";
    throw new Error(`${run.service}.${run.operation} failed with status ${status}: ${alert}`);
  }
}
