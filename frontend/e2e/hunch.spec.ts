import { test, expect } from "@playwright/test";

// Smoke test of the host entry path. Magic-link auth makes a fully-automated
// multi-user reveal awkward, so the full reveal is verified manually pre-demo
// (see README "Pre-demo checklist"). This asserts the landing renders and that
// an unauthenticated "Start a room" routes to sign-in.
test("landing renders and prompts sign-in to start a room", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Hunch/ })).toBeVisible();
  await page.getByRole("button", { name: /Start a room|Sign in to start/ }).click();
  await expect(page).toHaveURL(/\/login/);
});
