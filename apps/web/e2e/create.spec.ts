import { expect, test } from "@playwright/test";

test("creating a table: quick starts, folded sections, Create always in reach", async ({ page }) => {
  await page.goto("/");
  const create = page.getByRole("button", { name: "Create private table" });
  await expect(create).toBeInViewport();
  await page.getByRole("button", { name: "Omaha Night" }).click();
  await expect(page.getByRole("button", { name: /^Pot-limit Omaha/ })).toHaveAttribute("aria-pressed", "true");
  // Advanced settings start folded, each with a summary.
  await expect(page.locator("details[open]")).toHaveCount(0);
  await expect(page.getByText(/run it twice: ask/)).toBeVisible();
  await page.getByRole("button", { name: "Custom" }).click();
  await expect(page.locator("details[open]")).toHaveCount(4);
  await expect(create).toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
