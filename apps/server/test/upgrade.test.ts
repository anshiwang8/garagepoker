import { type HandConfig, ROW_BOARD } from "@garagepoker/engine";
import { describe, expect, it } from "vitest";
import { buildReplay } from "../src/replay.js";
import type { TableData } from "../src/table.js";
import { upgradeTableData } from "../src/upgrade.js";
import { harness } from "./helpers.js";

/** Owner in seat 1 and Bob in seat 2, game started (owner on the button, to act first). */
function started(settings: object = {}) {
	const h = harness(settings);
	h.seat("owner", 1, 100_000);
	h.seat("bob", 2, 50_000);
	h.send(h.ownerId, { type: "startGame" });
	return h;
}

/** Makes the saved hands look like a save from before variants had a `board`. */
function asOldSave(d: TableData) {
	const configs = [d.hand?.config, d.prevHand?.config, d.handRecord?.record.input.config, d.prevRecord?.record.input.config];
	for (const config of configs.filter((c): c is HandConfig => !!c)) {
		// A copy: the variant is shared with the engine's VARIANTS table.
		const { board: _, ...old } = config.variant;
		config.variant = old as HandConfig["variant"];
	}
}

describe("upgradeTableData: saves from before variant boards", () => {
	it("lets a hand in progress deal the next street", () => {
		const h = started();
		asOldSave(h.data);
		expect(() => h.act({ type: "call" })).not.toThrow(); // still preflop: nothing dealt
		expect(() => h.act({ type: "check" })).toThrow(); // dealing the flop needs the board

		const h2 = started();
		asOldSave(h2.data);
		expect(upgradeTableData(h2.data)).toBe(true);
		h2.act({ type: "call" });
		h2.act({ type: "check" });
		expect(h2.data.hand!.street).toBe("flop");
		expect(h2.data.hand!.boards[0]).toHaveLength(3);
		expect(h2.data.hand!.config.variant.board).toEqual(ROW_BOARD);
	});

	it("builds the view and the replay after a hand that ended before the river", () => {
		// The view only needs the board size when a rabbit hunt could be offered.
		const h = started({ rabbitHunt: true });
		h.act({ type: "raise", to: 6_000 });
		h.act({ type: "fold" });
		expect(h.data.hand).toBeNull();
		asOldSave(h.data);
		expect(() => h.view(h.ownerId)).toThrow();
		expect(() => buildReplay(h.data, h.ownerId)).toThrow();

		expect(upgradeTableData(h.data)).toBe(true);
		expect(h.view(h.ownerId).lastHand).toMatchObject({ number: 1, grid: null, rabbitAvailable: true });
		expect(buildReplay(h.data, h.ownerId)).toMatchObject({ hand: 1, grid: null });

		// And the next hand deals as normal.
		h.send(h.ownerId, { type: "startGame" });
		expect(h.data.handNumber).toBe(2);
	});

	it("leaves current saves alone", () => {
		const h = started();
		const before = JSON.stringify(h.data);
		expect(upgradeTableData(h.data)).toBe(false);
		expect(JSON.stringify(h.data)).toBe(before);
	});
});
