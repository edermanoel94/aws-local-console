import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { uniqueName } from "../support/names";
import { consolePanel, deepCleanup, deleteWithConfirmation, expectSuccess, openConsole, openResource, openTab, row } from "../support/console";

/**
 * SPEC 16 (S3), SPEC 29 (real Floci errors) and SPEC 48 scenario 1, all through the S3 console.
 */
const created: { name: string; region: string }[] = [];

function bucketName(label: string) {
  const name = uniqueName(`e2e-s3-${label}`);
  created.push({ name, region: "us-east-1" });
  return name;
}

test.afterAll(async () => {
  for (const b of created) await deepCleanup.bucket(b.name, b.region);
});

async function createBucket(page: import("@playwright/test").Page, name: string, region?: string) {
  await consolePanel(page).getByRole("button", { name: "Create bucket" }).click();
  await page.getByLabel("Bucket name").fill(name);
  if (region) await page.getByLabel("AWS Region").selectOption(region);
  await page.getByRole("button", { name: "Create", exact: true }).click();
}

test.describe("S3 console", () => {
  test("creates, lists, searches and deletes a bucket", async ({ page }) => {
    const bucket = bucketName("crud");
    await openConsole(page, "s3");

    await createBucket(page, bucket);
    await expectSuccess(page, `Bucket ${bucket} created`);
    await expect(row(page, "Buckets", bucket)).toBeVisible();

    await consolePanel(page).getByLabel("Search").fill(bucket);
    await expect(row(page, "Buckets", bucket)).toBeVisible();
    await expect(consolePanel(page).getByRole("table", { name: "Buckets" }).getByRole("row")).toHaveCount(2);

    await openResource(page, bucket);
    await expect(page.getByText("No objects")).toBeVisible();
    await deleteWithConfirmation(page, bucket);
    await expectSuccess(page, `Bucket ${bucket} deleted`);
    await expect(consolePanel(page).getByRole("table", { name: "Buckets" })).toBeVisible();
    await expect(row(page, "Buckets", bucket)).toHaveCount(0);
  });

  test("shows the real Floci error when the bucket already exists (SPEC 29)", async ({ page }) => {
    // us-east-1 answers a duplicate CreateBucket with 200 (AWS legacy behavior); other regions return BucketAlreadyOwnedByYou.
    const bucket = uniqueName("e2e-s3-dup");
    created.push({ name: bucket, region: "us-east-2" });
    await openConsole(page, "s3");

    await createBucket(page, bucket, "us-east-2");
    await expectSuccess(page, `Bucket ${bucket} created`);

    await createBucket(page, bucket, "us-east-2");
    const alert = consolePanel(page).getByRole("alert");
    await expect(alert).toContainText("AWS Error");
    await expect(alert).toContainText("BucketAlreadyOwnedByYou");
    await expect(alert).toContainText("you already own it");
    // The form stays open so the user can pick another name.
    await expect(page.getByLabel("Bucket name")).toHaveValue(bucket);
  });

  test("validates the bucket name before calling Floci", async ({ page }) => {
    await openConsole(page, "s3");
    await consolePanel(page).getByRole("button", { name: "Create bucket" }).click();
    await page.getByLabel("Bucket name").fill("Invalid_Bucket");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Bucket name can consist only of lowercase letters")).toBeVisible();
  });

  test("uploads, views, tags, downloads and deletes objects (scenario 1)", async ({ page }) => {
    const bucket = bucketName("obj");
    await openConsole(page, "s3");
    await createBucket(page, bucket);
    await openResource(page, bucket);

    // Upload text content with user metadata.
    await consolePanel(page).getByRole("button", { name: "Upload", exact: true }).click();
    await page.getByLabel("Enter text").check();
    await page.getByLabel("Content", { exact: true }).fill("Hello from Playwright");
    await page.getByLabel("Object key").fill("docs/hello.txt");
    await page.getByRole("button", { name: "Add metadata" }).click();
    await page.getByLabel("Metadata key 1").fill("author");
    await page.getByLabel("Metadata value 1").fill("e2e");
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expectSuccess(page, "Object docs/hello.txt uploaded");

    // Upload a file at the bucket root (the upload page returns to the folder it was opened from).
    await consolePanel(page).getByRole("button", { name: "Upload", exact: true }).click();
    await page.getByLabel("File", { exact: true }).setInputFiles({ name: "order.json", mimeType: "application/json", buffer: Buffer.from('{"orderId":42}') });
    await expect(page.getByLabel("Object key")).toHaveValue("order.json");
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await expectSuccess(page, "Object order.json uploaded");

    // Folder navigation and listing.
    await expect(row(page, "Objects", "order.json")).toBeVisible();
    await consolePanel(page).getByRole("link", { name: "docs/" }).click();
    await expect(row(page, "Objects", "hello.txt")).toBeVisible();

    // Object detail: metadata (HeadObject) and content (GetObject).
    await consolePanel(page).getByRole("link", { name: "hello.txt" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "hello.txt" })).toBeVisible();
    await expect(consolePanel(page).getByText(`s3://${bucket}/docs/hello.txt`)).toBeVisible();
    await expect(row(page, "Metadata", "x-amz-meta-author")).toContainText("e2e");
    await expect(row(page, "Metadata", "Content-Type")).toContainText("text/plain");
    await expect(page.getByLabel("Object content")).toHaveText("Hello from Playwright");

    // Object tags.
    await consolePanel(page).getByRole("button", { name: "Manage tags" }).click();
    await page.getByRole("button", { name: "Add new tag" }).click();
    await page.getByLabel("Tag key 1").fill("env");
    await page.getByLabel("Tag value 1").fill("test");
    await consolePanel(page).getByRole("button", { name: "Save", exact: true }).click();
    await expectSuccess(page, "Tags of docs/hello.txt saved");
    await expect(row(page, "Tags", "env")).toContainText("test");

    // Download.
    const downloadPromise = page.waitForEvent("download");
    await consolePanel(page).getByRole("button", { name: "Download" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("hello.txt");
    expect(await readFile(await download.path(), "utf8")).toBe("Hello from Playwright");

    // Delete object.
    await deleteWithConfirmation(page, "docs/hello.txt");
    await expectSuccess(page, "Object docs/hello.txt deleted");
    await expect(page.getByText("No objects")).toBeVisible();

    // Back to the bucket root, the file object is still there; empty and delete the bucket.
    await consolePanel(page).getByRole("link", { name: bucket, exact: true }).first().click();
    await expect(row(page, "Objects", "order.json")).toBeVisible();
    await consolePanel(page).getByRole("button", { name: "Empty", exact: true }).click();
    await page.getByRole("dialog").getByLabel('Type "permanently delete" to confirm').fill("permanently delete");
    await page.getByRole("dialog").getByRole("button", { name: "Empty", exact: true }).click();
    await expectSuccess(page, `Bucket ${bucket} emptied`);
    await expect(page.getByText("No objects")).toBeVisible();
    await deleteWithConfirmation(page, bucket);
    await expectSuccess(page, `Bucket ${bucket} deleted`);
    await expect(row(page, "Buckets", bucket)).toHaveCount(0);
  });

  test("enables versioning, keeps object versions and configures notifications and tags", async ({ page }) => {
    const bucket = bucketName("ver");
    await openConsole(page, "s3");
    await createBucket(page, bucket);
    await openResource(page, bucket);

    await openTab(page, "Properties");
    await consolePanel(page).getByRole("button", { name: "Enable versioning" }).click();
    await expectSuccess(page, "Bucket Versioning enabled");
    await expect(consolePanel(page).getByRole("button", { name: "Suspend versioning" })).toBeVisible();

    // EventBridge notifications on/off.
    await consolePanel(page).getByRole("button", { name: "Turn on EventBridge" }).click();
    await expectSuccess(page, `Amazon EventBridge notifications turned on for ${bucket}`);
    await expect(consolePanel(page).getByRole("button", { name: "Turn off EventBridge" })).toBeVisible();

    // Bucket tags.
    await consolePanel(page).getByRole("button", { name: "Manage tags" }).click();
    await page.getByRole("button", { name: "Add new tag" }).click();
    await page.getByLabel("Tag key 1").fill("team");
    await page.getByLabel("Tag value 1").fill("payments");
    await consolePanel(page).getByRole("button", { name: "Save", exact: true }).click();
    await expectSuccess(page, `Tags of bucket ${bucket} saved`);
    await expect(row(page, "Tags", "team")).toContainText("payments");

    // Upload the same key twice.
    for (const content of ["version one", "version two"]) {
      await openTab(page, "Objects");
      await consolePanel(page).getByRole("button", { name: "Upload", exact: true }).click();
      await page.getByLabel("Enter text").check();
      await page.getByLabel("Content", { exact: true }).fill(content);
      await page.getByLabel("Object key").fill("notes.txt");
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      await expectSuccess(page, "Object notes.txt uploaded");
    }

    await openTab(page, "Versions");
    const versions = row(page, "Object versions", "notes.txt");
    await expect(versions).toHaveCount(2);
    await expect(versions.filter({ hasText: "Latest" })).toHaveCount(1);
  });
});
