import { DEFAULT_SETTINGS, legalActions, sevenDeuceApplies, validateConfig } from "@garagepoker/engine";
import { settingsSchema } from "@garagepoker/protocol";
import { describe, expect, it } from "vitest";
import { buildReplay } from "../src/replay.js";
import { harness } from "./helpers.js";

const settings = { variant: "REVERSE_PINEAPPLE" } as const;

/** Everyone checks or calls until the hand is on `street` (or over). */
function playTo(h: ReturnType<typeof harness>, street: string) {
	while (h.data.hand && h.data.hand.street !== street) {
		h.act(legalActions(h.data.hand)!.canCheck ? { type: "check" } : { type: "call" });
	}
}

function table() {
	const h = harness(settings, 7);
	const owner = h.seat("owner", 1, 100_000);
	const bob = h.seat("bob", 2, 100_000);
	h.seat("carol", 3, 100_000);
	const spectator = h.join("watcher");
	h.send(h.ownerId, { type: "startGame" });
	return { h, owner, bob, spectator };
}

describe("Reverse Pineapple", () => {
	it("late hole cards reach only their owner", () => {
		const { h, owner, bob, spectator } = table();
		expect(h.view(owner).seats[0]!.cards).toHaveLength(2);
		playTo(h, "flop");
		expect(h.data.hand!.street).toBe("flop");

		const mine = h.view(owner).seats[0]!.cards!;
		expect(mine).toHaveLength(3);
		expect(mine.every((c) => typeof c === "string")).toBe(true);
		for (const viewer of [bob, spectator]) {
			const seen = h.view(viewer).seats[0]!.cards!;
			expect(seen).toHaveLength(3);
			expect(seen.every((c) => c === null)).toBe(true);
		}
	});

	it("settings accept Reverse Pineapple in mixed games", () => {
		const base = { ...DEFAULT_SETTINGS, variant: "REVERSE_PINEAPPLE" as const };
		expect(validateConfig({ ...base, seats: 9, boards: 1 })).toEqual([]);
		const issues = validateConfig({ ...base, seats: 9, boards: 2 });
		expect(issues).toHaveLength(1);
		expect(issues[0]!.field).toBe("seats");
		expect(issues[0]!.message).toContain("need 55 cards");

		const parsed = settingsSchema.parse({
			...DEFAULT_SETTINGS,
			variant: "REVERSE_PINEAPPLE",
			mixedGames: ["NLH", "REVERSE_PINEAPPLE"],
		});
		expect(parsed.variant).toBe("REVERSE_PINEAPPLE");
		expect(parsed.mixedGames).toEqual(["NLH", "REVERSE_PINEAPPLE"]);
	});

	it("replay frames show the hand growing", () => {
		const { h, owner } = table();
		while (h.data.hand) h.act(legalActions(h.data.hand)!.canCheck ? { type: "check" } : { type: "call" });
		const frames = buildReplay(h.data, owner)!.frames;
		const sizes = (street: string) => new Set(frames.filter((f) => f.street === street).map((f) => f.seats[0]!.cards.length));
		expect(sizes("preflop")).toEqual(new Set([2]));
		expect(sizes("flop")).toEqual(new Set([3]));
		expect(sizes("turn")).toEqual(new Set([4]));
		expect(sizes("river")).toEqual(new Set([5]));
		// Your own cards are real strings in every frame.
		expect(frames.at(-1)!.seats[0]!.cards.every((c) => typeof c === "string")).toBe(true);
	});

	it("the 7-2 bounty doesn't apply", () => {
		expect(sevenDeuceApplies("REVERSE_PINEAPPLE")).toBe(false);
	});
});
