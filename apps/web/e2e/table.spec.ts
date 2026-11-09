import { expect, test } from "@playwright/test";

/** Every dev preview: hero to act, raise panel, results, double board, Tic-Tac-Toe grids, spectators… */
const STATES = "abcdefghijklmnopqrstuvwxyzA".split("");

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
      // The badges above the pot (bomb pot, red river) stay clear of the seats and their bets.
      const badges = [...document.querySelectorAll("[data-box=bomb-pot], [data-box=red-river]")].map(box);
      const bets = [...document.querySelectorAll("[data-box=bet]")].map(box);
      badges.forEach((b, i) => [...seats, ...bets].forEach((s) => hit(b, s) && overlaps.push(`badge ${i}`)));
      const actions = document.querySelector("section[aria-label=Actions]");
      const small = [...(actions?.querySelectorAll("button") ?? [])]
        .filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 44)
        .map((b) => `${(b.getAttribute("aria-label") || b.textContent || "").trim()} ${Math.round(b.getBoundingClientRect().height)}px`);
      // Row labels ("B1", "R2 B2"): one line, inside their column, beside the row's first line of cards.
      const labels = [...document.querySelectorAll("[data-box=board-label]")].flatMap((l) => {
        const range = document.createRange();
        range.selectNodeContents(l);
        const text = [...range.getClientRects()];
        const row = l.closest("[data-box=board]")!.getBoundingClientRect();
        const firstCard = l.nextElementSibling?.getBoundingClientRect();
        const out: string[] = [];
        if (text.length !== 1) out.push(`${l.textContent} on ${text.length} lines`);
        if (l.scrollWidth > l.clientWidth + 0.5) out.push(`${l.textContent} wider than its column`);
        if (Math.abs(l.getBoundingClientRect().top - row.top) > 1 || (firstCard && Math.abs(firstCard.top - row.top) > 1)) out.push(`${l.textContent} not on the first line`);
        return out;
      });
      return { hscroll: document.documentElement.scrollWidth > innerWidth, overlaps, small, labels };
    });
    expect(r.hscroll).toBe(false);
    expect(r.overlaps).toEqual([]);
    expect(r.small).toEqual([]);
    expect(r.labels).toEqual([]);
  });
}

/** Red river previews: long and uneven boards (6, 7/5, 5/8, 12/7/12/5 cards), rabbit hunt with 1 back. */
for (const id of "tuvwx".split("")) {
  test(`red river preview ${id}: board rows stay on screen and clear of each other, the pot and the table info`, async ({ page }) => {
    await page.goto(`/dev/table-states?state=${id}`);
    await expect(page.locator("[data-mode]")).toHaveCount(1);
    const r = await page.evaluate(() => {
      const box = (e: Element) => e.getBoundingClientRect();
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const rows = [...document.querySelectorAll("[data-box=board]")].map(box);
      const others = [...document.querySelectorAll("[data-box=pot], [data-box=info], [data-box=result], [data-box=red-river]")].map(box);
      const bad: string[] = [];
      rows.forEach((row, i) => {
        if (row.left < 0 || row.right > innerWidth) bad.push(`row ${i} off screen`);
        rows.slice(i + 1).forEach((other, j) => hit(row, other) && bad.push(`row ${i} over row ${i + j + 1}`));
        others.forEach((o, j) => hit(row, o) && bad.push(`row ${i} over centre box ${j}`));
      });
      return { rows: rows.length, bad };
    });
    expect(r.rows).toBeGreaterThan(0);
    expect(r.bad).toEqual([]);
  });
}

test("red river badges: the round number, and side by side with the bomb-pot badge", async ({ page }) => {
  await page.goto("/dev/table-states?state=t");
  await expect(page.getByText("Red river 1", { exact: true }).first()).toBeVisible();
  await page.goto("/dev/table-states?state=u");
  const red = page.locator("[data-box=red-river]");
  await expect(red).toHaveText("Red river 2");
  const bomb = await page.getByText("Bomb pot", { exact: true }).boundingBox();
  const rr = await red.boundingBox();
  expect(bomb && rr && bomb.x + bomb.width <= rr.x && Math.abs(bomb.y + bomb.height - (rr.y + rr.height)) < 2).toBe(true);
});

test("log: a heading per red river round, and the note when the deck runs out", async ({ page }) => {
  await page.goto("/dev/table-states?state=t");
  await page.getByRole("button", { name: "Options", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Log", exact: true }).click();
  const log = page.getByRole("dialog").getByRole("list", { name: "Hand 12 log" });
  await expect(log.getByText("Red river 1", { exact: true })).toBeVisible();
  await page.goto("/dev/table-states?state=x");
  await page.getByRole("button", { name: "Options", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("No cards left: red river stops.")).toBeVisible();
});

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

test("Reverse Pineapple river preview: the hero holds 5 cards and the opponents show 5 backs", async ({ page }) => {
  await page.goto("/dev/table-states?state=z");
  await expect(page.locator("[data-mode]")).toHaveCount(1);
  await expect(page.locator("[data-box=hero-cards] > div.relative > div")).toHaveCount(5);
  // Opponents still in the hand show 5 backs each (the folded one shows none).
  const opps = await page.locator("[data-box=cards]").evaluateAll((els) => els.map((e) => e.querySelectorAll(":scope > div.relative > div").length));
  expect(opps.length).toBeGreaterThan(0);
  expect(opps.every((n) => n === 5)).toBe(true);
  await page.goto("/dev/table-states?state=y");
  await expect(page.locator("[data-mode]")).toHaveCount(1);
  await expect(page.locator("[data-box=hero-cards] > div.relative > div")).toHaveCount(3);
});
