import { cardToString, type HandState, legalActions } from "@garagepoker/engine";
import { type ClientMessage, type ReplayEvent, streetTitle } from "@garagepoker/protocol";
import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { TableRoom } from "../src/index.js";
import { buildReplay, replayText } from "../src/replay.js";
import { Client, createTable, harness, isRedText, seededHand, step, token } from "./helpers.js";

const ALICE = token("alice");
const BOB = token("bob");
type Action = Extract<ClientMessage, { type: "act" }>["action"];

async function table(settings: object = {}) {
	const tableId = await createTable(ALICE, { autoStart: false, ...settings });
	const alice = await Client.connect(tableId, ALICE);
	const bob = await Client.connect(tableId, BOB);
	const carol = await Client.connect(tableId, token("carol")); // spectator
	const all = [alice, bob, carol];
	await step(all, alice, { type: "requestSeat", seat: 1, nickname: "Alice", buyIn: 100_000, postBlind: false });
	await step(all, bob, { type: "requestSeat", seat: 2, nickname: "Bob", buyIn: 100_000, postBlind: false });
	await step(all, alice, { type: "approveRequest", requestId: alice.view.requests![0]!.id, stack: 80_000 });
	return { tableId, alice, bob, carol, all };
}

/** Plays hand `n` to the end: discards the first card when asked, otherwise check/call. */
async function checkDown(all: Client[], alice: Client, bob: Client, n: number) {
	while (alice.view.hand) {
		const hand = alice.view.hand;
		if (hand.discard) {
			for (const [c, seat] of [[alice, 1], [bob, 2]] as const) {
				if (alice.view.hand?.discard?.seats.includes(seat)) {
					await step(all, c, { type: "discard", hand: n, card: c.view.seats[seat - 1]!.cards![0]! });
				}
			}
			continue;
		}
		const who = hand.toAct === 1 ? alice : bob;
		const action: Action = who.view.you.legal!.canCheck ? { type: "check" } : { type: "call" };
		await step(all, who, { type: "act", hand: n, action });
	}
}

describe("last-hand replay", () => {
	it("groups a Tic-Tac-Toe board's deals by street: 4 corners, 3 across the middle, then 2", async () => {
		const { alice, bob, all } = await table({ variant: "TICTACTOE" });
		await step(all, alice, { type: "startGame" });
		await checkDown(all, alice, bob, 1);
		const replay = (await alice.replay())!;
		const deals = replay.frames.flatMap((f) => f.events).filter((e) => e.kind === "deal");
		expect(deals.map((e) => [e.street, e.cards.length])).toEqual([
			["flop", 4],
			["turn", 3],
			["river", 2],
		]);
		expect(replay.frames.at(-1)!.boards[0]).toEqual(alice.view.lastHand!.boards[0]);
		expect(replay.grid?.cells).toEqual([0, 2, 6, 8, 3, 4, 5, 1, 7]);
	});

	it("reproduces the live hand's final stacks, showing only your own and shown cards", async () => {
		const { alice, bob, carol, all } = await table();
		expect(await alice.replay()).toBeNull(); // no hand yet

		await step(all, alice, { type: "startGame" });
		const aliceCards = alice.view.seats[0]!.cards as string[];
		const bobCards = bob.view.seats[1]!.cards as string[];
		// A raise and a call, then check it down to showdown.
		await step(all, alice, { type: "act", hand: 1, action: { type: "raise", to: 6_000 } });
		await checkDown(all, alice, bob, 1);
		const liveStacks = alice.view.seats.slice(0, 2).map((s) => s!.stack);

		const counts = all.map((c) => c.raw.length);
		const mine = (await alice.replay())!;
		const theirs = (await bob.replay())!;
		const watching = (await carol.replay())!;
		// Asking for a replay doesn't broadcast anything to anyone else.
		expect(bob.raw.length - counts[1]!).toBe(1);
		expect(carol.raw.length - counts[2]!).toBe(1);

		for (const replay of [mine, theirs, watching]) {
			expect(replay.hand).toBe(1);
			const last = replay.frames.at(-1)!;
			expect(last.street).toBe("complete");
			// The replay's final stacks are exactly the live result.
			expect(last.seats.map((s) => s.stack)).toEqual(liveStacks);
			expect(last.boards[0]).toEqual(alice.view.lastHand!.boards[0]);
			expect(replay.pots.map((p) => p.amount)).toEqual(alice.view.lastHand!.pots.map((p) => p.amount));
		}
		// The deal frame posts the blinds; every action has its own frame.
		expect(mine.frames[0]!.events.map((e) => (e.kind === "action" ? e.type : e.kind))).toEqual(["smallBlind", "bigBlind"]);
		expect(mine.frames.some((f) => f.events.some((e) => e.kind === "deal" && e.street === "flop"))).toBe(true);

		// Your own cards in every frame; the opponent's only at showdown.
		const before = (r: typeof mine) => r.frames.slice(0, -1);
		for (const f of before(mine)) {
			expect(f.seats[0]!.cards).toEqual(aliceCards);
			expect(f.seats[1]!.cards).toEqual([null, null]);
		}
		for (const f of before(theirs)) expect(f.seats[0]!.cards).toEqual([null, null]);
		for (const f of before(watching)) for (const s of f.seats) expect(s.cards).toEqual([null, null]);
		expect(watching.frames.at(-1)!.seats.map((s) => s.cards)).toEqual([aliceCards, bobCards]);
	});

	it("never shows a folded hand, and never a Pineapple discard", async () => {
		const folded = await table();
		await step(folded.all, folded.alice, { type: "startGame" });
		const bobCards = folded.bob.view.seats[1]!.cards as string[];
		await step(folded.all, folded.alice, { type: "act", hand: 1, action: { type: "raise", to: 6_000 } });
		await step(folded.all, folded.bob, { type: "act", hand: 1, action: { type: "fold" } });
		for (const c of [folded.alice, folded.carol]) {
			const json = JSON.stringify(await c.replay());
			for (const card of bobCards) expect(json).not.toContain(`"${card}"`);
		}

		const pine = await table({ variant: "PINEAPPLE" });
		await step(pine.all, pine.alice, { type: "startGame" });
		await checkDown(pine.all, pine.alice, pine.bob, 1);
		const hand = await runInDurableObject(env.TABLE.getByName(pine.tableId), (room: TableRoom) =>
			(room as unknown as { data: { prevHand: HandState } }).data.prevHand,
		);
		const discardsOf = (seat: number) =>
			hand.players.find((p) => p.seat === seat)!.discards.map(cardToString);
		expect([...discardsOf(1), ...discardsOf(2)]).toHaveLength(6);
		// Nobody's replay contains another player's discards (the spectator's
		// contains none). A player's own replay does show the cards they were
		// dealt, which they held, and saw, before discarding them.
		const others: [Client, string[]][] = [
			[pine.alice, discardsOf(2)],
			[pine.bob, discardsOf(1)],
			[pine.carol, [...discardsOf(1), ...discardsOf(2)]],
		];
		for (const [c, hidden] of others) {
			const replay = (await c.replay())!;
			const json = JSON.stringify(replay);
			for (const card of hidden) expect(json).not.toContain(`"${card}"`);
			// Discards show up as face-down events.
			expect(replay.frames.flatMap((f) => f.events).filter((e) => e.kind === "action" && e.type === "discard")).toHaveLength(6);
		}
		expect(pine.alice.view.lastHand!.shown.every((s) => s.cards.length === 2)).toBe(true);
	});

	it("is stored, survives eviction, and is overwritten by the next hand", async () => {
		const { tableId, alice, bob, all } = await table();
		await step(all, alice, { type: "startGame" });
		await checkDown(all, alice, bob, 1);
		await evictDurableObject(env.TABLE.getByName(tableId));
		expect((await alice.replay())!.hand).toBe(1);

		await step(all, alice, { type: "startGame" });
		// During hand 2, the replay is still hand 1.
		expect((await bob.replay())!.hand).toBe(1);
		await checkDown(all, alice, bob, 2);
		const replay = (await bob.replay())!;
		expect(replay.hand).toBe(2);
		expect(replay.frames.at(-1)!.seats.map((s) => s.stack)).toEqual(alice.view.seats.slice(0, 2).map((s) => s!.stack));
	});
});

describe("red river replay", () => {
	const red = isRedText;
	/** Everyone checks or calls until the hand is over. */
	function checkDownHarness(h: ReturnType<typeof harness>) {
		while (h.data.hand) h.act(legalActions(h.data.hand)!.canCheck ? { type: "check" } : { type: "call" });
	}
	const deals = (events: ReplayEvent[]) => events.filter((e): e is Extract<ReplayEvent, { kind: "deal" }> => e.kind === "deal");
	const text = (h: ReturnType<typeof harness>, viewer: string) =>
		replayText(buildReplay(h.data, viewer)!, { variant: "No-limit Hold'em", endedAt: 0, cents: false, viewerSeat: 1 });

	it("names every street", () => {
		expect(["preflop", "flop", "turn", "river"].map((s) => streetTitle(s as "flop"))).toEqual(["Preflop", "Flop", "Turn", "River"]);
		expect(streetTitle("extra", 1)).toBe("Red river 1");
		expect(streetTitle("extra", 3)).toBe("Red river 3");
		expect(streetTitle("complete")).toBe("");
	});

	it("export text lists an NLH viewer's two hole cards, as the first frame shows them", () => {
		const { h, ids } = seededHand({}, () => true);
		checkDownHarness(h);
		const replay = buildReplay(h.data, ids[0]!)!;
		const mine = replay.frames[0]!.seats.find((s) => s.seat === 1)!.cards;
		expect(mine).toHaveLength(2);
		const line = text(h, ids[0]!).split("\n").find((l) => l.startsWith("Your cards:"));
		expect(line).toBe(`Your cards: ${mine.join(" ")}`);
	});

	it("red river deal events carry extraRound", () => {
		const { h, ids } = seededHand({ redRiver: true }, (r) => red(r[4]!) && red(r[5]!) && !red(r[6]!));
		const rest = h.data.hand!.deck.slice(h.data.hand!.deckIndex).map(cardToString);
		checkDownHarness(h);
		const replay = buildReplay(h.data, ids[0]!)!;
		const dealt = deals(replay.frames.flatMap((f) => f.events));
		expect(dealt.map((e) => [e.street, e.extraRound, e.cards])).toEqual([
			["flop", undefined, rest.slice(0, 3)],
			["turn", undefined, [rest[3]]],
			["river", undefined, [rest[4]]],
			["extra", 1, [rest[5]]],
			["extra", 2, [rest[6]]],
		]);
		expect(dealt.filter((e) => e.street !== "extra").every((e) => !("extraRound" in e))).toBe(true);
		const extraFrames = replay.frames.filter((f) => f.street === "extra");
		expect(new Set(extraFrames.map((f) => f.extraRound))).toEqual(new Set([1, 2]));
		expect(replay.frames.filter((f) => f.street !== "extra").every((f) => f.extraRound === undefined)).toBe(true);
		expect(replay.frames.at(-1)!.boards[0]).toEqual(rest.slice(0, 7));
		expect(replay.redRiverStopped).toBe(false);
	});

	it("export text names Red river 1", () => {
		const { h, ids } = seededHand({ redRiver: true }, (r) => red(r[4]!) && !red(r[5]!));
		const rest = h.data.hand!.deck.slice(h.data.hand!.deckIndex).map(cardToString);
		checkDownHarness(h);
		const lines = text(h, ids[0]!).split("\n");
		expect(lines).toContain(`River: ${rest[4]}`);
		expect(lines).toContain(`Red river 1: ${rest[5]}`);
		expect(lines.join("\n")).not.toContain("extra");
		expect(lines.join("\n")).not.toContain("No cards left");
	});

	it("export text notes when the deck runs out", () => {
		// 9 seats of PLO5: 45 hole cards and 5 board cards leave 2 to spare.
		const players = ["owner", "b", "c", "d", "e", "f", "g", "i", "j"];
		const { h, ids } = seededHand(
			{ variant: "PLO5", seats: 9, redRiver: true },
			(r) => r.length === 7 && red(r[4]!) && red(r[5]!) && red(r[6]!),
			players,
		);
		checkDownHarness(h);
		expect(h.data.prevHand!.boards[0]).toHaveLength(7);
		expect(h.view(ids[0]!).lastHand).toMatchObject({ redRiver: true, redRiverStopped: true });
		const replay = buildReplay(h.data, ids[0]!)!;
		expect(replay.redRiverStopped).toBe(true);
		const lines = text(h, ids[0]!).split("\n");
		const note = lines.indexOf("No cards left: red river stops.");
		expect(note).toBeGreaterThan(lines.findIndex((l) => l.startsWith("Red river 2:")));
		expect(lines.filter((l) => l.startsWith("No cards left"))).toHaveLength(1);
		// After the last round's betting, before the showdown.
		expect(lines.slice(note + 1).every((l) => !/checks|calls/.test(l))).toBe(true);
		expect(lines[note + 1]).toMatch(/shows/);
	});
});
