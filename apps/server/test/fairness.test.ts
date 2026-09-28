import { cardToString, type HandState } from "@garagepoker/engine";
import { type ClientMessage, lastHandPublicCards, type TableView, verifyFairness } from "@garagepoker/protocol";
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/fairness.js";
import type { TableRoom } from "../src/index.js";
import { Client, createTable, step, token } from "./helpers.js";

const ALICE = token("alice");
const BOB = token("bob");
type Action = Extract<ClientMessage, { type: "act" }>["action"];

/** Alice (seat 1) and Bob (seat 2) at a new table, with Carol watching. */
async function table(settings: object = {}) {
	const tableId = await createTable(ALICE, { autoStart: false, ...settings });
	const alice = await Client.connect(tableId, ALICE);
	const bob = await Client.connect(tableId, BOB);
	const carol = await Client.connect(tableId, token("carol"));
	const all = [alice, bob, carol];
	await step(all, alice, { type: "requestSeat", seat: 1, nickname: "Alice", buyIn: 100_000, postBlind: false });
	await step(all, bob, { type: "requestSeat", seat: 2, nickname: "Bob", buyIn: 100_000, postBlind: false });
	await step(all, alice, { type: "approveRequest", requestId: alice.view.requests![0]!.id, stack: 100_000 });
	return { tableId, alice, bob, carol, all };
}

/** The last hand's engine state, straight from the Durable Object (server-only data). */
async function serverHand(tableId: string): Promise<HandState> {
	return runInDurableObject(env.TABLE.getByName(tableId), (room: TableRoom) =>
		(room as unknown as { data: { prevHand: HandState } }).data.prevHand,
	);
}

/** Cards a client can see on the table in the last hand's result. */
const publicCards = (v: TableView) => [
	...v.lastHand!.boards.flat(),
	...(v.lastHand!.secondRun?.flat() ?? []),
	...v.lastHand!.shown.flatMap((s) => s.cards),
	...(v.lastHand!.rabbit?.boards.flat() ?? []),
];

describe("provable fairness", () => {
	it("commits before the deal and the reveal matches the commitment", async () => {
		const { alice, bob, carol, all } = await table();
		await step(all, alice, { type: "startGame" });
		// Every client has the commitment from the first view of the hand.
		const commitment = carol.view.hand!.commitment!;
		expect(commitment).toMatch(/^[0-9a-f]{64}$/);
		expect(alice.view.hand!.commitment).toBe(commitment);
		expect(carol.view.lastHand).toBeNull();

		while (alice.view.hand) {
			const who = alice.view.hand.toAct === 1 ? alice : bob;
			const action: Action = who.view.you.legal!.canCheck ? { type: "check" } : { type: "call" };
			await step(all, who, { type: "act", hand: 1, action });
		}
		const proof = carol.view.lastHand!.fairness!;
		expect(proof.commitment).toBe(commitment);
		expect(proof.leaves).toHaveLength(52);
		// Showdown: 5 board cards + both players' 2 hole cards are revealed, nothing else.
		expect(proof.revealed).toHaveLength(9);

		const result = await verifyFairness(proof, publicCards(carol.view), sha256Hex, commitment);
		expect(result.checks.filter((c) => !c.ok)).toEqual([]);
		expect(result.ok).toBe(true);

		// Tampering with any revealed card, or the commitment, fails verification.
		const swapped = { ...proof, revealed: proof.revealed.map((r, i) => (i === 0 ? { ...r, card: r.card === "2c" ? "3c" : "2c" } : r)) };
		expect((await verifyFairness(swapped, publicCards(carol.view), sha256Hex, commitment)).ok).toBe(false);
		expect((await verifyFairness(proof, publicCards(carol.view), sha256Hex, "0".repeat(64))).ok).toBe(false);
	});

	it("never reveals folded hands, and reveals rabbit cards only once hunted", async () => {
		const { tableId, alice, bob, carol, all } = await table({ rabbitHunt: true });
		await step(all, alice, { type: "startGame" });
		const commitment = carol.view.hand!.commitment!;
		const [first, second] = alice.view.hand!.toAct === 1 ? [alice, bob] : [bob, alice];
		await step(all, first, { type: "act", hand: 1, action: { type: "raise", to: 6_000 } });
		await step(all, second, { type: "act", hand: 1, action: { type: "fold" } });

		const hand = await serverHand(tableId);
		const holes = hand.players.flatMap((p) => p.hole).map(cardToString);
		let proof = carol.view.lastHand!.fairness!;
		// No board was dealt and nobody showed: nothing is revealed.
		expect(proof.revealed).toEqual([]);
		for (const r of proof.revealed) expect(holes).not.toContain(r.card);
		expect((await verifyFairness(proof, publicCards(carol.view), sha256Hex, commitment)).ok).toBe(true);

		await step(all, bob, { type: "rabbitHunt", hand: 1 });
		proof = carol.view.lastHand!.fairness!;
		expect(proof.revealed.map((r) => r.card).sort()).toEqual([...carol.view.lastHand!.rabbit!.boards[0]!].sort());
		expect((await verifyFairness(proof, publicCards(carol.view), sha256Hex, commitment)).ok).toBe(true);
		for (const r of proof.revealed) expect(holes).not.toContain(r.card);
	});
});

describe("cards shown after a hand", () => {
	it("reach everyone, spectators included, only as chosen, and are covered by the proof", async () => {
		const { tableId, alice, bob, carol, all } = await table();
		await step(all, alice, { type: "startGame" });
		const commitment = carol.view.hand!.commitment!;
		const [first, second] = alice.view.hand!.toAct === 1 ? [alice, bob] : [bob, alice];
		await step(all, first, { type: "act", hand: 1, action: { type: "raise", to: 6_000 } });
		await step(all, second, { type: "act", hand: 1, action: { type: "fold" } });

		const hand = await serverHand(tableId);
		const folder = second === alice ? 1 : 2;
		const [shownCard, hiddenCard] = hand.players.find((p) => p.seat === folder)!.hole.map(cardToString);
		expect(second.view.you.showable).toEqual([shownCard, hiddenCard]);
		await step(all, second, { type: "showCards", hand: 1, cards: [shownCard!] });

		for (const c of all) expect(c.view.lastHand!.showed).toEqual([{ seat: folder, nickname: second === alice ? "Alice" : "Bob", cards: [shownCard] }]);
		// Nothing about the card they kept ever went to anyone else.
		for (const c of [first, carol]) for (const raw of c.raw) expect(raw).not.toContain(`"${hiddenCard}"`);
		const proof = carol.view.lastHand!.fairness!;
		expect(proof.revealed.map((r) => r.card)).toEqual([shownCard]);
		expect((await verifyFairness(proof, lastHandPublicCards(carol.view.lastHand!), sha256Hex, commitment)).ok).toBe(true);
	});
});

describe("spectators", () => {
	it("a spectator never receives hole cards before showdown, or any Pineapple discard", async () => {
		const { tableId, alice, bob, carol, all } = await table({ variant: "PINEAPPLE" });
		await step(all, alice, { type: "startGame" });
		expect(alice.view.spectators).toBe(1);
		const dealt = { alice: alice.view.seats[0]!.cards as string[], bob: bob.view.seats[1]!.cards as string[] };
		expect(dealt.alice).toHaveLength(5);

		// Play it out: discard the first card each street, check/call otherwise.
		while (alice.view.hand) {
			const hand = alice.view.hand;
			if (hand.discard) {
				for (const [c, seat] of [[alice, 1], [bob, 2]] as const) {
					if (hand.discard.seats.includes(seat) && alice.view.hand?.discard?.seats.includes(seat)) {
						await step(all, c, { type: "discard", hand: 1, card: c.view.seats[seat - 1]!.cards![0]! });
					}
				}
				continue;
			}
			const who = hand.toAct === 1 ? alice : bob;
			await step(all, who, { type: "act", hand: 1, action: who.view.you.legal!.canCheck ? { type: "check" } : { type: "call" } });
		}

		const server = await serverHand(tableId);
		const discards = server.players.flatMap((p) => p.discards).map(cardToString);
		expect(discards).toHaveLength(6);
		const held = server.players.flatMap((p) => p.hole).map(cardToString);
		const last = carol.raw.length - 1;
		carol.raw.forEach((raw, i) => {
			// Discards: never, in any message, including the proof.
			for (const card of discards) expect(raw).not.toContain(`"${card}"`);
			// Hole cards: not before the showdown message.
			if (i < last) for (const card of held) expect(raw).not.toContain(`"${card}"`);
		});
		expect(carol.view.lastHand!.shown.every((s) => s.cards.length === 2)).toBe(true);
	});

	it("with spectators off, people without a seat see who's seated but not the game", async () => {
		const { alice, bob, carol, all } = await table({ spectators: false });
		await step(all, alice, { type: "startGame" });
		const view = carol.view;
		expect(view.you.watchBlocked).toBe(true);
		expect(view.hand).toBeNull();
		expect(view.lastHand).toBeNull();
		expect(view.ledger).toEqual([]);
		expect(view.seats.slice(0, 2).map((s) => [s!.nickname, s!.inHand, s!.bet, s!.cards, s!.lastAction])).toEqual([
			["Alice", false, 0, null, null],
			["Bob", false, 0, null, null],
		]);
		// Seated players and the owner see the game, and how many are watching.
		expect(bob.view.you.watchBlocked).toBe(false);
		expect(bob.view.hand).not.toBeNull();
		expect(alice.view.spectators).toBe(1);
		// Carol can still ask for a seat.
		await step(all, carol, { type: "requestSeat", seat: 3, nickname: "Carol", buyIn: 1_000, postBlind: false });
		expect(alice.view.requests).toHaveLength(1);
	});
});
