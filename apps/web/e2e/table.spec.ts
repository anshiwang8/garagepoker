import { expect, test } from "@playwright/test";

/** Every dev preview: hero to act, raise panel, results, double board, Tic-Tac-Toe grids, spectators… */
const STATES = "abcdefghijklmnopqrs".split("");

for (const id of STATES) {
  test(`table preview ${id}: drawn, no sideways scroll, nothing over the board, big action buttons`, async ({ page }) => {
    await page.goto(`/dev/table-states?state=${id}`);
    // The felt draws once it has measured itself (data-mode is set only when a layout fits).
    await expect(page.locator("[data-mode]")).toHaveCount(1);
    const r = await page.evaluate(() => {
      const box = (e: Element) => e.getBoundingClientRect();
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const boards = [...document.querySelectorAll("[data-box=board]")].map(box);
      const seats = [...document.querySelectorAll("[data-box=plate], [data-box=cards], [data-box=hero-cards]")].map(box);
      const overlaps = boards.flatMap((b, i) => seats.filter((s) => hit(b, s)).map(() => `board ${i}`));
      const actions = document.querySelector("section[aria-label=Actions]");
      const small = [...(actions?.querySelectorAll("button") ?? [])]
        .filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 44)
        .map((b) => `${(b.getAttribute("aria-label") || b.textContent || "").trim()} ${Math.round(b.getBoundingClientRect().height)}px`);
      return { hscroll: document.documentElement.scrollWidth > innerWidth, overlaps, small };
    });
    expect(r.hscroll).toBe(false);
    expect(r.overlaps).toEqual([]);
    expect(r.small).toEqual([]);
  });
}

test("raise panel: presets, steppers and Back work by touch", async ({ page }) => {
  await page.goto("/dev/table-states?state=c");
  const amount = page.getByRole("textbox", { name: "Bet amount" });
  await expect(amount).toHaveValue("0.40");
  await page.getByRole("button", { name: "3 BB" }).click();
  await expect(amount).toHaveValue("0.60");
  await page.getByRole("button", { name: "More" }).click();
  await expect(amount).toHaveValue("0.70");
  await expect(page.getByText("Min 0.40")).toBeVisible();
  await page.getByRole("button", { name: /Back/ }).click();
  await expect(page.getByRole("group", { name: "Your turn" })).toBeVisible();
});

test("the sent state stops a second tap", async ({ page }) => {
  await page.goto("/dev/table-states?state=b");
  const call = page.getByRole("button", { name: /Call/ });
  await call.click();
  // The dev preview has no server, so the table never moves on: the buttons stay sent.
  await expect(call).toBeDisabled();
  await expect(page.getByRole("group", { name: "Your turn" })).toHaveAttribute("aria-busy", "true");
});
