import { expect, type Locator, type Page } from "@playwright/test";
import { executeForCleanup } from "./cleanup";

/** Opens the service console ("Resources" tab of /services/<id>). */
export async function openConsole(page: Page, service: string) {
  await page.goto(`/services/${service}?tab=resources`);
  await expect(page.getByRole("tab", { name: "Resources", exact: true })).toHaveAttribute("aria-selected", "true");
}

/** The console content area (the page's "Resources" tab panel). */
export function consolePanel(page: Page): Locator {
  return page.getByRole("tabpanel", { name: "Resources" });
}

/** Asserts a success toast (role="status") containing `text`. */
export async function expectSuccess(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}

/** Clicks the page level "Delete" button, types the resource name and confirms (CONTRACT section 6). */
export async function deleteWithConfirmation(page: Page, name: string) {
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type the name to confirm").fill(name);
  await dialog.getByRole("button", { name: "Confirm delete" }).click();
  await expect(dialog).toBeHidden();
}

/** Row of a table (by accessible table name) that contains `text`. */
export function row(scope: Page | Locator, table: string, text: string | RegExp): Locator {
  return scope.getByRole("table", { name: table }).getByRole("row").filter({ hasText: text });
}

/** Opens a resource from a console list by clicking its name link. */
export async function openResource(page: Page, name: string) {
  await consolePanel(page).getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

/** Clicks one of the console's inner tabs (e.g. "Objects", "Test"). */
export async function openTab(page: Page, name: string) {
  await consolePanel(page).getByRole("tab", { name, exact: true }).click();
}

/** Best-effort cleanup helpers that go beyond cleanup.ts (non-empty buckets, rules with targets, APIs, buses). */
export const deepCleanup = {
  async bucket(name: string, region = "us-east-1") {
    for (let i = 0; i < 5; i++) {
      const out = (await executeForCleanup("s3", "ListObjectVersions", { Bucket: name }, region)) as
        | { Versions?: { Key: string; VersionId?: string }[]; DeleteMarkers?: { Key: string; VersionId?: string }[] }
        | undefined;
      const objects = [...(out?.Versions ?? []), ...(out?.DeleteMarkers ?? [])].map((v) => ({ Key: v.Key, ...(v.VersionId && v.VersionId !== "null" ? { VersionId: v.VersionId } : {}) }));
      if (!objects.length) break;
      await executeForCleanup("s3", "DeleteObjects", { Bucket: name, Delete: { Objects: objects, Quiet: true } }, region);
    }
    await executeForCleanup("s3", "DeleteBucket", { Bucket: name }, region);
  },
  async rule(name: string, bus = "default") {
    const out = (await executeForCleanup("events", "ListTargetsByRule", { Rule: name, EventBusName: bus })) as { Targets?: { Id: string }[] } | undefined;
    const ids = (out?.Targets ?? []).map((t) => t.Id);
    if (ids.length) await executeForCleanup("events", "RemoveTargets", { Rule: name, EventBusName: bus, Ids: ids });
    await executeForCleanup("events", "DeleteRule", { Name: name, EventBusName: bus });
  },
  bus: (name: string) => executeForCleanup("events", "DeleteEventBus", { Name: name }),
  async restApisNamed(name: string) {
    const out = (await executeForCleanup("apigateway", "GetRestApis", { Limit: 500 })) as { Items?: { Id: string; Name: string }[] } | undefined;
    for (const api of out?.Items ?? []) if (api.Name === name) await executeForCleanup("apigateway", "DeleteRestApi", { RestApiId: api.Id });
  },
};
