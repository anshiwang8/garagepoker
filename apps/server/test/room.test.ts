import { cardToString, rabbitCards } from "@garagepoker/engine";
import type { ClientMessage } from "@garagepoker/protocol";
import { env, evictDurableObject, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { TableRoom } from "../src/index.js";
import { Client, createTable, freshIp, ORIGIN, step, token } from "./helpers.js";

type PlayerAction = Extract<ClientMessage, { type: "act" }>["action"];

const ALICE = token("alice");
const BOB = token("bob");

/** Alice (owner, seat 1) and Bob (seat 2, stack edited by Alice) at a new table. */
async function twoPlayerTable() {
	const tableId = await createTable(ALICE, { autoStart: false });
	const alice = await Client.connect(tableId, ALICE);
	const bob = await Client.connect(tableId, BOB);
	const all = [alice, bob];

	// The owner's own seat request is approved automatically.
	await step(all, alice, { type: "requestSeat", seat: 1, nickname: "Alice", buyIn: 100_000, postBlind: false });
	await step(all, bob, { type: "requestSeat", seat: 2, nickname: "Bob", buyIn: 50_000, postBlind: false });
	const [request] = alice.view.requests!;
	expect(request).toMatchObject({ nickname: "Bob", seat: 2, amount: 50_000 });
	expect(bob.view.requests).toBeNull();
	// Owner edits the starting stack in the approval.
	await step(all, alice, { type: "approveRequest", requestId: request!.id, stack: 60_000 });
	expect(bob.view.you.seat).toBe(2);
	expect(bob.view.seats[1]).toMatchObject({ nickname: "Bob", stack: 60_000 });
	return { tableId, alice, bob, all };
}

/** Hole cards a client can see for itself in its latest view. */
const ownCards = (c: Client) => c.view.seats[c.view.you.seat! - 1]!.cards as string[];

describe("creating tables", () => {
	it("validates the request with Zod and the settings with validateConfig", async () => {
		const post = (body: unknown) =>
			SELF.fetch("https://gp.test/api/tables", {
				method: "POST",
				headers: { Origin: ORIGIN, "CF-Connecting-IP": freshIp() },
				body: JSON.stringify(body),
			});
		expect((await post({ token: "short" })).status).toBe(400);
		expect((await post({ token: ALICE, settings: { seats: 12 } })).status).toBe(400);
		expect((await post({ token: ALICE, settings: { bigBlind: 2000, smallBlind: 5000 } })).status).toBe(400);
		expect((await post({ token: ALICE, extra: 1 })).status).toBe(400);
		const ok = await post({ token: ALICE, settings: { variant: "PLO" } });
		expect(ok.status).toBe(201);
		expect(((await ok.json()) as { tableId: string }).tableId).toMatch(/^[A-Za-z0-9]{10}$/);
	});

	it("404s for unknown tables and non-upgrade requests", async () => {
		const res = await SELF.fetch("https://gp.test/api/tables/NoSuchTabl/ws", { headers: { Upgrade: "websocket", Origin: ORIGIN } });
		expect(res.status).toBe(404);
		expect((await SELF.fetch("https://gp.test/nope")).status).toBe(404);
	});
});

describe("message validation", () => {
	it("rejects anything that isn't a valid protocol message", async () => {
		const tableId = await createTable(ALICE);
		const res = await SELF.fetch(`https://gp.test/api/tables/${tableId}/ws`, { headers: { Upgrade: "websocket", Origin: ORIGIN } });
		const ws = res.webSocket!;
		ws.accept();
		const c = new Client(ws);
		const error = async (m: unknown) => {
			const n = c.raw.length;
			ws.send(typeof m === "string" ? m : JSON.stringify(m));
			await c.waitForCount(n);
			const reply = JSON.parse(c.raw[n]!);
			expect(reply.type).toBe("error");
			return reply.message as string;
		};
		expect(await error("{not json")).toMatch(/JSON/);
		expect(await error({ type: "startGame" })).toMatch(/hello first/);
		expect(await error({ type: "hello", token: "x" })).toMatch(/Invalid/);
		expect(await error({ type: "teleport" })).toMatch(/Invalid/);
		expect(await error({ type: "hello", token: BOB, admin: true })).toMatch(/Invalid/);
		expect(await error("x".repeat(5000))).toMatch(/too large/);

		expect((await c.request({ type: "hello", token: BOB })).type).toBe("view");
		expect(await error({ type: "act", hand: 1, action: { type: "raise", to: 1.5 } })).toMatch(/Invalid/);
		expect(await error({ type: "act", hand: 1, action: { type: "raise", to: -5 } })).toMatch(/Invalid/);
		expect(await error({ type: "requestSeat", seat: 1, nickname: "<b>", buyIn: 1, postBlind: false })).toMatch(
			/Invalid/,
		);
		// Well-formed, but Bob isn't the owner.
		expect(await error({ type: "startGame" })).toMatch(/owner/);
	});
});

describe("playing hands over WebSockets", () => {
	it("two clients play a full hand; neither ever receives the other's hole cards", async () => {
		const { alice, bob, all } = await twoPlayerTable();

		await step(all, alice, { type: "startGame" });
		expect(alice.view.hand).toMatchObject({ number: 1, street: "preflop", toAct: 1 });
		const aliceCards = ownCards(alice);
		const bobCards = ownCards(bob);
		expect(aliceCards).toHaveLength(2);
		expect(bobCards).toHaveLength(2);
		expect(aliceCards.every((c) => /^[2-9TJQKA][cdhs]$/.test(c))).toBe(true);
		// Each sees the other's cards face down.
		expect(alice.view.seats[1]!.cards).toEqual([null, null]);
		expect(bob.view.seats[0]!.cards).toEqual([null, null]);
		expect(alice.view.you.labels).toBeTruthy();

		// Heads-up: Alice has the button, posts the SB and acts first preflop.
		const act = (who: Client, action: PlayerAction) => step(all, who, { type: "act", hand: 1, action });
		await act(alice, { type: "call" });
		await act(bob, { type: "check" });
		expect(alice.view.hand).toMatchObject({ street: "flop", toAct: 2 });
		expect(alice.view.hand!.boards[0]).toHaveLength(3);
		await act(bob, { type: "check" });
		await act(alice, { type: "check" });
		await act(bob, { type: "raise", to: 4000 });
		expect(alice.view.you.legal).toMatchObject({ callAmount: 4000 });
		await act(alice, { type: "call" });
		expect(alice.view.hand).toMatchObject({ street: "river", pot: 12_000 });
		await act(bob, { type: "check" });
		await act(alice, { type: "raise", to: 10_000 });
		await act(bob, { type: "fold" });

		// Hand over: Alice wins 12,000 (6,000 from Bob); her uncalled 10,000 comes back.
		expect(alice.view.hand).toBeNull();
		expect(alice.view.lastHand).toMatchObject({ number: 1, shown: [] });
		expect(alice.view.seats.slice(0, 2).map((s) => s!.stack)).toEqual([106_000, 54_000]);
		const nets = alice.view.ledger.map((r) => [r.nickname, r.buyIn, r.stack, r.net]);
		expect(nets).toEqual([
			["Alice", 100_000, 106_000, 6_000],
			["Bob", 60_000, 54_000, -6_000],
		]);

		// Redaction: across every message either client received, the other's
		// hole cards never appear, and neither the deck nor any token is sent.
		const leaks = (c: Client, cards: string[], otherToken: string) =>
			c.raw.filter((r) => cards.some((card) => r.includes(`"${card}"`)) || r.includes(otherToken) || r.includes('"deck"'));
		expect(alice.raw.length).toBeGreaterThan(10);
		expect(leaks(alice, bobCards, BOB)).toEqual([]);
		expect(leaks(bob, aliceCards, ALICE)).toEqual([]);
		// Sanity check that the scan would catch a leak: each sees its own cards.
		expect(leaks(alice, aliceCards, BOB).length).toBeGreaterThan(0);

		// Ending the game sends everyone the final ledger and settle-up.
		expect(alice.view.settlement).toBeNull();
		await step(all, alice, { type: "endGame" });
		for (const c of all) {
			expect(c.view.status).toBe("ended");
			expect(c.view.settlement).toEqual([
				{ from: bob.view.you.playerId, fromName: "Bob", to: alice.view.you.playerId, toName: "Alice", amount: 6_000 },
			]);
		}
	});

	it("shows hands only once a hand reaches showdown", async () => {
		const { alice, bob, all } = await twoPlayerTable();
		await step(all, alice, { type: "startGame" });
		const bobCards = ownCards(bob);
		// Check/call it down.
		while (alice.view.hand) {
			const toAct = alice.view.hand.toAct!;
			const who = toAct === 1 ? alice : bob;
			const action = who.view.you.legal!.canCheck ? { type: "check" as const } : { type: "call" as const };
			await step(all, who, { type: "act", hand: 1, action });
		}
		const reveal = alice.raw.findIndex((r) => bobCards.some((c) => r.includes(`"${c}"`)));
		expect(reveal).toBe(alice.raw.length - 1);
		const shown = alice.view.lastHand!.shown;
		expect(shown.map((s) => s.seat).sort()).toEqual([1, 2]);
		expect(shown.find((s) => s.seat === 2)!.cards).toEqual(bobCards);
		expect(shown.every((s) => s.labels.every((l) => l.length > 0))).toBe(true);
		const total = alice.view.ledger.reduce((sum, r) => sum + r.net, 0);
		expect(total).toBe(0);
	});

	it("plays a double-board Hi/Lo bomb pot with correct per-seat views and no leaks", async () => {
		const tableId = await createTable(ALICE, {
			autoStart: false,
			variant: "PLOHL",
			boards: 2,
			bombPotMode: "everyHand",
			bombPotAnteBB: 2,
		});
		const alice = await Client.connect(tableId, ALICE);
		const bob = await Client.connect(tableId, BOB);
		const carol = await Client.connect(tableId, token("carol")); // spectator
		const all = [alice, bob, carol];
		await step(all, alice, { type: "requestSeat", seat: 1, nickname: "Alice", buyIn: 100_000, postBlind: false });
		await step(all, bob, { type: "requestSeat", seat: 2, nickname: "Bob", buyIn: 60_000, postBlind: false });
		await step(all, alice, { type: "approveRequest", requestId: alice.view.requests![0]!.id, stack: 60_000 });

		// Hand 1: a bomb pot. Everyone antes 2 BB (2 × 2000 = 4000); no blinds, no
		// preflop betting: it starts on the flop of both boards.
		await step(all, alice, { type: "startGame" });
		for (const c of all) {
			const hand = c.view.hand!;
			expect(hand).toMatchObject({ number: 1, bombPot: true, street: "flop", pot: 8_000, boardShares: [4_000, 4_000] });
			expect(hand.boards.map((b) => b.length)).toEqual([3, 3]);
			expect(c.view.seats.slice(0, 2).map((s) => s!.stack)).toEqual([96_000, 56_000]);
			expect(c.view.seats.slice(0, 2).map((s) => s!.bet)).toEqual([0, 0]);
		}
		// Per-seat views: your own 4 cards; everyone else's face down; spectators see none.
		const aliceCards = ownCards(alice);
		const bobCards = ownCards(bob);
		expect(aliceCards).toHaveLength(4);
		expect(alice.view.seats[1]!.cards).toEqual([null, null, null, null]);
		expect(bob.view.seats[0]!.cards).toEqual([null, null, null, null]);
		expect(carol.view.seats.slice(0, 2).map((s) => s!.cards)).toEqual([
			[null, null, null, null],
			[null, null, null, null],
		]);
		// Hand labels: one per board, each showing both halves in Hi/Lo.
		for (const c of [alice, bob]) {
			expect(c.view.you.labels).toHaveLength(2);
			for (const label of c.view.you.labels!) expect(label).toMatch(/ \/ (no low|\d-\d low)$/);
		}
		expect(carol.view.you.labels).toBeNull();
		// Heads-up, Alice has the button, so Bob acts first on the flop.
		expect(bob.view.you.legal).toMatchObject({ canCheck: true });
		expect(alice.view.you.legal).toBeNull();

		const act = (who: Client, action: PlayerAction, hand = 1) => step(all, who, { type: "act", hand, action });
		await act(bob, { type: "check" });
		await act(alice, { type: "check" });
		expect(alice.view.hand!.boards.map((b) => b.length)).toEqual([4, 4]);
		await act(bob, { type: "raise", to: 8_000 }); // pot-sized bet
		await act(alice, { type: "call" });
		expect(alice.view.hand).toMatchObject({ street: "river", pot: 24_000, boardShares: [12_000, 12_000] });
		await act(bob, { type: "check" });
		await act(alice, { type: "raise", to: 10_000 });
		await act(bob, { type: "fold" });

		// Uncontested: one whole-pot slice. Alice wins 24,000 (12,000 of it Bob's).
		expect(alice.view.lastHand).toMatchObject({
			number: 1,
			bombPot: true,
			shown: [],
			pots: [{ amount: 24_000, slices: [{ board: null, half: null, amount: 24_000, winners: [{ seat: 1, amount: 24_000 }] }] }],
		});
		expect(alice.view.lastHand!.boards.map((b) => b.length)).toEqual([5, 5]);
		// Alice: 100,000 − 12,000 in + 24,000 pot = 112,000. Bob: 60,000 − 12,000 = 48,000.
		expect(alice.view.seats.slice(0, 2).map((s) => s!.stack)).toEqual([112_000, 48_000]);

		// No leaks: neither player's hole cards (nor the deck or tokens) ever
		// reached anyone else, including the spectator.
		const leaks = (c: Client, cards: string[], ...tokens: string[]) =>
			c.raw.filter((r) => cards.some((card) => r.includes(`"${card}"`)) || tokens.some((t) => r.includes(t)) || r.includes('"deck"'));
		expect(leaks(alice, bobCards, BOB)).toEqual([]);
		expect(leaks(bob, aliceCards, ALICE)).toEqual([]);
		expect(leaks(carol, [...aliceCards, ...bobCards], ALICE, BOB)).toEqual([]);

		// Hand 2, checked down: the showdown splits each board's share, and
		// cards are revealed only in the final view.
		await step(all, alice, { type: "startGame" });
		const bobCards2 = ownCards(bob);
		const before = carol.raw.length;
		while (alice.view.hand) {
			const who = alice.view.hand.toAct === 1 ? alice : bob;
			await act(who, { type: "check" }, 2);
		}
		// (Raw text can't be scanned here: hand 1's public boards may contain any
		// card of hand 2's new deck. Check the structured views instead.)
		const views = carol.messages.slice(before).flatMap((m) => (m.type === "view" ? [m.view] : []));
		for (const v of views.slice(0, -1)) {
			expect(v.seats[1]!.cards!.every((c) => c === null)).toBe(true);
			expect(v.lastHand!.number).toBe(1);
		}
		const last = carol.view.lastHand!;
		expect(last.number).toBe(2);
		expect(last.shown.find((s) => s.seat === 2)!.cards).toEqual(bobCards2);
		expect(last.shown.map((s) => s.labels.length)).toEqual([2, 2]);
		const slices = last.pots.flatMap((p) => p.slices);
		expect(new Set(slices.map((s) => s.board))).toEqual(new Set([0, 1]));
		// Each board gets half of the 8,000 pot, split high/low or scooped by the high.
		for (const board of [0, 1]) {
			const share = slices.filter((s) => s.board === board).reduce((sum, s) => sum + s.amount, 0);
			expect(share).toBe(4_000);
		}
		expect(carol.view.ledger.reduce((sum, r) => sum + r.net, 0)).toBe(0);
	});

	it("runs it twice when everyone accepts, and rabbit cards reach no one until asked", async () => {
		const tableId = await createTable(ALICE, { autoStart: false, runItTwice: "ask", rabbitHunt: true });
		const alice = await Client.connect(tableId, ALICE);
		const bob = await Client.connect(tableId, BOB);
		const carol = await Client.connect(tableId, token("carol")); // spectator
		const all = [alice, bob, carol];
		await step(all, alice, { type: "requestSeat", seat: 1, nickname: "Alice", buyIn: 100_000, postBlind: false });
		await step(all, bob, { type: "requestSeat", seat: 2, nickname: "Bob", buyIn: 50_000, postBlind: false });
		await step(all, alice, { type: "approveRequest", requestId: alice.view.requests![0]!.id, stack: 50_000 });

		// Hand 1: all-in preflop, both accept run it twice.
		await step(all, alice, { type: "startGame" });
		await step(all, alice, { type: "act", hand: 1, action: { type: "raise", to: 50_000 } });
		await step(all, bob, { type: "act", hand: 1, action: { type: "call" } });
		for (const c of all) expect(c.view.hand!.ritOffer).toMatchObject({ seats: [1, 2], accepted: [] });
		await step(all, bob, { type: "runItTwice", hand: 1, accept: true });
		await step(all, alice, { type: "runItTwice", hand: 1, accept: true });
		const ran = carol.view.lastHand!;
		expect(ran.secondRun).toHaveLength(1);
		expect(ran.pots[0]!.slices.map((s) => s.run)).toEqual([0, 1]);
		expect(ran.pots[0]!.slices.map((s) => s.amount)).toEqual([50_000, 50_000]);
		expect(ran.rabbitAvailable).toBe(false); // the board ran out

		// Hand 2 (if both still have chips): a preflop fold leaves a board to hunt.
		if (alice.view.seats.slice(0, 2).some((s) => s!.stack === 0)) {
			await step(all, alice, { type: "adjustStack", playerId: alice.view.seats[0]!.playerId, op: "set", amount: 50_000 });
			await step(all, alice, { type: "adjustStack", playerId: bob.view.you.playerId, op: "set", amount: 50_000 });
		}
		await step(all, alice, { type: "startGame" });
		const toAct = alice.view.hand!.toAct === 1 ? alice : bob;
		const other = toAct === alice ? bob : alice;
		await step(all, toAct, { type: "act", hand: 2, action: { type: "raise", to: 6_000 } });
		await step(all, other, { type: "act", hand: 2, action: { type: "fold" } });
		expect(carol.view.lastHand).toMatchObject({ number: 2, rabbitAvailable: true, rabbit: null });

		// The server knows the rabbit cards; no client has received any of them.
		const prev = await runInDurableObject(env.TABLE.getByName(tableId), (room: TableRoom) =>
			(room as unknown as { data: { prevHand: Parameters<typeof rabbitCards>[0] } }).data.prevHand,
		);
		const rabbit = rabbitCards(prev).flat().map(cardToString);
		expect(rabbit).toHaveLength(5);
		const counts = all.map((c) => c.raw.length);
		const since = (c: Client, i: number) => c.raw.slice(counts[i]!);
		const hand2Start = all.map((c) => c.raw.findIndex((r) => r.includes('"number":2')));
		all.forEach((c, i) => {
			for (const r of c.raw.slice(hand2Start[i]!)) {
				// Hand 1's result is still in these views; only its boards could share
				// card strings, so strip them before scanning.
				const view = JSON.parse(r).view;
				const text = JSON.stringify({ ...view, lastHand: view?.lastHand?.number === 1 ? null : view?.lastHand });
				for (const card of rabbit) expect(text).not.toContain(`"${card}"`);
			}
		});

		await step(all, bob, { type: "rabbitHunt", hand: 2 });
		all.forEach((c, i) => {
			expect(since(c, i).length).toBeGreaterThan(0);
			expect(c.view.lastHand!.rabbit).toEqual({ boards: [rabbit], by: "Bob" });
		});
		expect(carol.view.ledger.reduce((sum, r) => sum + r.net, 0)).toBe(0);
	});

	it("keeps a seat across reconnects and after the object is evicted", async () => {
		const { tableId, alice, bob, all } = await twoPlayerTable();
		await step(all, alice, { type: "startGame" });
		const cards = ownCards(bob);

		// Alice sees Bob go offline, but his seat stays.
		const before = alice.rev;
		bob.close();
		await alice.waitForRev(before + 1);
		expect(alice.view.seats[1]).toMatchObject({ nickname: "Bob", connected: false });
		const bob2 = await Client.connect(tableId, BOB);
		expect(bob2.view.you.seat).toBe(2);
		expect(ownCards(bob2)).toEqual(cards);

		// Evict the Durable Object from memory: state reloads from storage and
		// hibernated sockets keep working.
		await evictDurableObject(env.TABLE.getByName(tableId));
		await step([alice, bob2], alice, { type: "act", hand: 1, action: { type: "call" } });
		expect(bob2.view.hand).toMatchObject({ toAct: 2 });
		expect(ownCards(bob2)).toEqual(cards);
	});

	it("auto-acts when the decision timer and time bank run out", async () => {
		const { tableId, alice, all } = await twoPlayerTable();
		await step(all, alice, { type: "startGame" });
		const stub = env.TABLE.getByName(tableId);
		const { decisionDeadline, bankDeadline } = alice.view.hand!;
		expect(bankDeadline! - decisionDeadline!).toBe(60_000);
		// serverNow is stamped at broadcast, a moment after the turn started.
		expect(decisionDeadline! - alice.view.serverNow).toBeGreaterThan(19_000);
		expect(decisionDeadline! - alice.view.serverNow).toBeLessThanOrEqual(20_000);

		// Jump the clock past decision time + the 60 s bank and fire the alarm.
		await runInDurableObject(stub, (room: TableRoom) => {
			const start = Date.now();
			room.now = () => start + 81_000;
		});
		const rev = alice.rev;
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await alice.waitForRev(rev + 1);
		// Alice (to act, facing the BB) was folded; Bob wins the blinds.
		expect(alice.view.hand).toBeNull();
		expect(alice.view.seats[0]).toMatchObject({ stack: 99_000, timeBankMs: 0 });
	});
});
