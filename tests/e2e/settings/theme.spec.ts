import { expect, test, type Page } from "@playwright/test";

/** Page background of each theme (--color-aws-page in frontend/app/globals.css). */
const PAGE_BACKGROUND = { light: "rgb(242, 243, 243)", dark: "rgb(15, 20, 26)" };

const html = (page: Page) => page.locator("html");

async function pickTheme(page: Page, label: "Light" | "Dark" | "System") {
  await page.getByRole("banner").getByRole("button", { name: /^Theme:/ }).click();
  const menu = page.getByRole("menu", { name: "Theme" });
  await menu.getByRole("menuitemradio", { name: label }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("banner").getByRole("button", { name: `Theme: ${label}` })).toBeVisible();
}

async function expectTheme(page: Page, theme: "light" | "dark") {
  if (theme === "dark") await expect(html(page)).toHaveClass(/\bdark\b/);
  else await expect(html(page)).not.toHaveClass(/\bdark\b/);
  await expect(page.locator("body")).toHaveCSS("background-color", PAGE_BACKGROUND[theme]);
}

test.describe("Theme", () => {
  test("follows the system by default and switches to light or dark from the top bar, remembering the choice", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/dashboard");
    await expect(page.getByRole("banner").getByRole("button", { name: "Theme: System" })).toBeVisible();
    await expectTheme(page, "light");

    // System: the theme changes live with the operating system setting.
    await page.emulateMedia({ colorScheme: "dark" });
    await expectTheme(page, "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expectTheme(page, "light");

    // An explicit choice wins over the system setting.
    await pickTheme(page, "Dark");
    await expectTheme(page, "dark");
    await page.reload();
    await expectTheme(page, "dark");
    await expect(page.getByRole("banner").getByRole("button", { name: "Theme: Dark" })).toBeVisible();

    await page.emulateMedia({ colorScheme: "dark" });
    await pickTheme(page, "Light");
    await expectTheme(page, "light");

    await pickTheme(page, "System");
    await expectTheme(page, "dark");
  });

  test("the theme menu works with the keyboard", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/dashboard");
    const button = page.getByRole("banner").getByRole("button", { name: "Theme: System" });
    await button.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "Theme" });
    // The checked option gets focus; arrows move between options.
    await expect(menu.getByRole("menuitemradio", { name: "System" })).toBeFocused();
    await expect(menu.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitemradio", { name: "Dark" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expectTheme(page, "dark");
    await expect(page.getByRole("banner").getByRole("button", { name: "Theme: Dark" })).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expectTheme(page, "dark");
  });

  test("is chosen in Settings and applied before the page is interactive", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings");
    const themes = page.getByRole("group", { name: "Theme" });
    await expect(themes.getByRole("radio", { name: /^System/ })).toBeChecked();
    await themes.getByRole("radio", { name: /^Dark/ }).check();
    await expect(page.getByRole("status").filter({ hasText: "Theme set to dark" }).first()).toBeVisible();
    await expectTheme(page, "dark");
    await expect(page.getByRole("banner").getByRole("button", { name: "Theme: Dark" })).toBeVisible();

    // The inline bootstrap script applies the stored theme before the body is even parsed (long before React hydrates),
    // so a dark page never flashes light: record the theme class at the moment the parser creates <body>.
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        if (!document.body) return;
        (window as unknown as { darkWhenBodyParsed: boolean }).darkWhenBodyParsed = document.documentElement.classList.contains("dark");
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await page.goto("/dashboard");
    expect(await page.evaluate(() => (window as unknown as { darkWhenBodyParsed?: boolean }).darkWhenBodyParsed)).toBe(true);
  });

  test("code editors follow the theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/api-explorer?service=sqs&operation=ListQueues");
    const editor = page.locator(".monaco-editor .monaco-editor-background").first();
    await expect(editor).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await pickTheme(page, "Dark");
    await expect(editor).toHaveCSS("background-color", "rgb(22, 29, 38)");
  });
});
