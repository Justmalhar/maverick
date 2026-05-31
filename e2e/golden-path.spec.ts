import { test, expect } from "@playwright/test";

// Smoke-level golden path: the app boots and renders its root shell without
// throwing. Backend-dependent flows (workspace create, PTY) require the Tauri
// runtime and are covered by unit/integration tests, not this browser run.
test("app boots and renders the root UI", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");

  // The root mount node is always present once React hydrates.
  await expect(page.locator("#root")).toBeVisible();

  // Either the first-run wizard or the workbench shell should appear.
  await expect(
    page.locator('[data-testid="workbench"], [data-testid="firstrun-wizard"]').first()
  ).toBeVisible({ timeout: 15_000 });

  // No uncaught render-time exceptions.
  expect(errors).toEqual([]);
});
