import type { Locator } from "@playwright/test";

/** Clicks the "Copy to clipboard" button of the code block or editor inside `scope` and returns the copied text. */
export async function copyToClipboard(scope: Locator): Promise<string> {
  const page = scope.page();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await scope.getByRole("button", { name: "Copy to clipboard" }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}
