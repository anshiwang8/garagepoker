import { cardToString, type HandState } from "@garagepoker/engine";
import type { ClientMessage } from "@garagepoker/protocol";
import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { TableRoom } from "../src/index.js";
import { Client, createTable, step, token } from "./helpers.js";

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
