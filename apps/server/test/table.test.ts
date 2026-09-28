import { assertLedgerBalanced, cardToString, DEFAULT_SETTINGS, ledgerRows, rabbitCards } from "@garagepoker/engine";
import { describe, expect, it } from "vitest";
import { ALARM_CLAMP_MS, scheduleAlarm } from "../src/index.js";
import { IDLE_DELETE_MS, OWNER_OFFLINE_MS, RIT_DECISION_MS } from "../src/table.js";
import { harness, token } from "./helpers.js";

/** Owner in seat 1 and Bob in seat 2, game not started. */
function headsUp(settings = {}) {
	const h = harness(settings);
	h.seat("owner", 1, 100_000);
	const bob = h.seat("bob", 2, 50_000);
	return { h, owner: h.ownerId, bob };
}

const balanced = (h: ReturnType<typeof harness>) =>
	assertLedgerBalanced(ledgerRows(h.data.ledger, h.table().stacksByPlayer()));

describe("seat requests", () => {
	it("owner approves with an edited stack, or declines", () => {
		const h = harness();
		h.seat("owner", 1, 100_000);
		const bob = h.join("bob");
		h.send(bob, { type: "requestSeat", seat: 2, nickname: "Bob", buyIn: 50_000, postBlind: false });
		expect(h.view(h.ownerId).requests).toHaveLength(1);
		expect(h.view(bob).requests).toBeNull();
		expect(h.view(bob).you.request).toMatchObject({ seat: 2, amount: 50_000 });

		const requestId = h.data.requests[0]!.id;
		expect(() => h.send(bob, { type: "approveRequest", requestId, stack: 1 })).toThrow(/owner/);
		h.send(h.ownerId, { type: "approveRequest", requestId, stack: 75_000 });
		expect(h.view(bob).you.seat).toBe(2);
		expect(h.view(bob).seats[1]).toMatchObject({ nickname: "Bob", stack: 75_000 });
		expect(h.data.ledger.at(-1)).toMatchObject({ kind: "sitIn", buyIn: 75_000, nickname: "Bob" });

		const carol = h.join("carol");
		h.send(carol, { type: "requestSeat", seat: 3, nickname: "Carol", buyIn: 1000, postBlind: false });
		h.send(h.ownerId, { type: "declineRequest", requestId: h.data.requests[0]!.id });
		expect(h.view(carol).you.notice).toMatch(/declined/);
		expect(h.view(carol).seats[2]).toBeNull();
		balanced(h);
	});

	it("rejects taken seats, taken names and missing seats", () => {
		const { h } = headsUp();
		const carol = h.join("carol");
		const dave = h.join("dave");
		const ask = (id: string, seat: number, nickname: string) =>
			h.send(id, { type: "requestSeat", seat, nickname, buyIn: 1000, postBlind: false });
		expect(() => ask(carol, 2, "Carol")).toThrow(/taken/);
		expect(() => ask(carol, 9, "Carol")).toThrow(/No such seat/);
		expect(() => ask(carol, 3, "BOB")).toThrow(/name is taken/);
		ask(dave, 3, "Dave");
		expect(() => ask(carol, 3, "Carol")).toThrow(/already asked/);
	});

	it("handles rebuys through the owner, and only when enabled", () => {
		const { h, owner, bob } = headsUp();
		h.send(bob, { type: "requestRebuy", amount: 10_000 });
		h.send(owner, { type: "approveRequest", requestId: h.data.requests[0]!.id, stack: 20_000 });
		expect(h.view(bob).seats[1]!.stack).toBe(70_000);
		expect(h.data.ledger.at(-1)).toMatchObject({ kind: "rebuy", buyIn: 20_000 });

		const off = headsUp({ rebuys: false });
		expect(() => off.h.send(off.bob, { type: "requestRebuy", amount: 1 })).toThrow(/Rebuys/);
	});
});

describe("hands and views", () => {
	it("shows each player only their own hole cards; spectators see none", () => {
		const { h, owner, bob } = headsUp();
		const carol = h.join("carol");
		h.send(owner, { type: "startGame" });
		expect(h.data.hand).not.toBeNull();

		const mine = h.view(owner);
		expect(mine.seats[0]!.cards!.every((c) => typeof c === "string")).toBe(true);
		expect(mine.seats[1]!.cards).toEqual([null, null]);
		expect(h.view(bob).seats[0]!.cards).toEqual([null, null]);
		expect(h.view(carol).seats.slice(0, 2).map((s) => s!.cards)).toEqual([
			[null, null],
			[null, null],
		]);
		expect(h.view(carol).you.legal).toBeNull();
		for (const id of [owner, bob, carol]) {
			const json = JSON.stringify(h.view(id));
			expect(json).not.toContain('"deck"');
			expect(json).not.toContain(token("owner"));
			expect(json).not.toContain(token("bob"));
		}
	});

	it("rejects out-of-turn, stale and illegal actions", () => {
		const { h, owner, bob } = headsUp();
		h.send(owner, { type: "startGame" });
		expect(h.data.hand!.toAct).toBe(1);
		expect(() => h.send(bob, { type: "act", hand: 1, action: { type: "check" } })).toThrow(/not your turn/);
		expect(() => h.send(owner, { type: "act", hand: 7, action: { type: "call" } })).toThrow(/hand is over/);
		expect(() => h.send(owner, { type: "act", hand: 1, action: { type: "raise", to: 2001 } })).toThrow(
			/minimum raise/,
		);
	});

	it("auto-starts the next hand after 3 s and moves the button", () => {
		const { h, owner } = headsUp({ autoStart: true });
		h.send(owner, { type: "startGame" });
		expect(h.data.button).toBe(1);
		h.act({ type: "fold" });
		expect(h.data.hand).toBeNull();
		h.advance(2_999);
		expect(h.data.hand).toBeNull();
		h.advance(1);
		expect(h.data.handNumber).toBe(2);
		expect(h.data.button).toBe(2);
	});
});

describe("timers", () => {
	it("a connected player uses their time bank, then times out: fold facing a bet", () => {
		const { h, owner } = headsUp();
		h.send(owner, { type: "startGame" });
		h.advance(20_000);
		expect(h.data.hand!.toAct).toBe(1); // into the bank
		h.advance(59_999);
		expect(h.data.hand!.toAct).toBe(1);
		h.advance(1);
		expect(h.data.hand).toBeNull();
		expect(h.data.lastHand!.pots[0]!.slices[0]!.winners[0]!.seat).toBe(2);
		expect(h.data.seats[0]!.timeBankMs).toBe(0);
	});

	it("checks instead of folding when checking is free", () => {
		const { h, owner } = headsUp();
		h.send(owner, { type: "startGame" });
		h.act({ type: "call" });
		h.advance(80_000);
		expect(h.data.hand!.street).toBe("flop");
	});

	it("charges the bank only for time used past the decision time", () => {
		const { h, owner } = headsUp();
		h.send(owner, { type: "startGame" });
		h.advance(25_000);
		h.act({ type: "call" });
		expect(h.data.seats[0]!.timeBankMs).toBe(55_000);
		expect(h.view(owner).hand).toMatchObject({ toAct: 2 });
	});

	it("a disconnect mid-hand isn't away until the hand ends; then the 2-player table pauses", () => {
		const { h, owner, bob } = headsUp({ autoStart: true });
		h.send(owner, { type: "startGame" });
		h.act({ type: "call" }); // owner completes the small blind; Bob's option
		h.disconnect(bob);
		// Mid-hand Bob keeps his seat and his turns time out (check when free),
		// without his time bank; he isn't away yet.
		while (h.data.hand) {
			expect(h.data.seats[1]!.away).toBe(false);
			if (h.data.hand.toAct === 2) h.advance(DEFAULT_SETTINGS.decisionTimeSec * 1000);
			else h.act({ type: "check" });
		}
		// Still disconnected as the hand ends: away for the next one.
		expect(h.data.seats[1]).toMatchObject({ away: true, timeBankMs: 60_000 });
		// One active player left: paused, not waiting for the 3 s auto-start.
		expect(h.data).toMatchObject({ status: "paused", pausedReason: "waitingForPlayers", nextHandAt: null });
		expect(h.view(owner)).toMatchObject({ status: "paused", pausedReason: "waitingForPlayers" });

		// Reconnecting doesn't clear away; Bob taps "I'm back".
		h.join("bob");
		expect(h.data.seats[1]!.away).toBe(true);
		expect(() => h.send(owner, { type: "startGame" })).toThrow(/Waiting for players/);
		h.send(bob, { type: "setAway", away: false });
		// Back to 2 active players, but it stays paused until the owner presses Start.
		expect(h.data.status).toBe("paused");
		expect(() => h.send(bob, { type: "startGame" })).toThrow(/owner/);
		h.send(owner, { type: "startGame" });
		expect(h.data).toMatchObject({ status: "running", pausedReason: null });
		expect(h.data.handNumber).toBe(2);
	});

	it("everyone disconnects: all away at hand end, paused, and only idle delete is scheduled", () => {
		const { h, owner, bob } = headsUp({ autoStart: true });
		h.send(owner, { type: "startGame" });
		h.disconnect(owner);
		h.disconnect(bob);
		// Each turn times out at the decision deadline until the hand ends.
		while (h.data.hand) h.advance(DEFAULT_SETTINGS.decisionTimeSec * 1000);
		expect(h.data.seats.slice(0, 2).map((s) => s!.away)).toEqual([true, true]);
		expect(h.data).toMatchObject({ status: "paused", pausedReason: "waitingForPlayers", nextHandAt: null });
		const idle = { at: h.data.emptySince! + IDLE_DELETE_MS, timer: "idleDelete" };
		expect(h.table().nextAlarm()).toEqual(idle);
		// Nothing else ever wakes the table: an hour later it's the same, and
		// the offline owner is still the owner (nobody here to take over).
		h.advance(60 * 60_000);
		expect(h.table().nextAlarm()).toEqual(idle);
		expect(h.data.ownerId).toBe(owner);
	});

	it("refills time banks by 10 s every 10 hands", () => {
		const { h, owner } = headsUp();
		h.data.seats[0]!.timeBankMs = 30_000;
		for (let i = 0; i < 10; i++) {
			h.send(owner, { type: "startGame" });
			h.act({ type: "fold" });
		}
		expect(h.data.handNumber).toBe(10);
		expect(h.data.seats[0]!.timeBankMs).toBe(40_000);
		expect(h.data.seats[1]!.timeBankMs).toBe(60_000);
	});
});

describe("owner menu", () => {
	it("kicks after the current hand and cashes the stack out to the ledger", () => {
		const { h, owner, bob } = headsUp();
		h.send(owner, { type: "startGame" });
		h.send(owner, { type: "kick", playerId: bob });
		expect(h.view(owner).seats[1]).toMatchObject({ leaving: true });
		h.act({ type: "fold" });
		expect(h.data.seats[1]).toBeNull();
		expect(h.data.ledger.at(-1)).toMatchObject({ kind: "kick", buyOut: 51_000, stackAfter: 0 });
		expect(h.view(bob).you.notice).toMatch(/removed/);
		const rows = h.view(owner).ledger;
		expect(rows.map((r) => r.net)).toEqual([-1_000, 1_000]);
		expect(() => h.send(owner, { type: "kick", playerId: owner })).toThrow(/Leave seat/);
	});

	it("adds, removes and sets stacks with ledger entries; mid-hand changes wait", () => {
		const { h, owner, bob } = headsUp();
		const adjust = (op: "add" | "remove" | "set", amount: number) =>
			h.send(owner, { type: "adjustStack", playerId: bob, op, amount });
		adjust("add", 5_000);
		expect(h.data.seats[1]!.stack).toBe(55_000);
		expect(() => adjust("remove", 60_000)).toThrow(/more than their stack/);
		adjust("remove", 15_000);
		adjust("set", 30_000);
		expect(h.data.ledger.slice(-3).map((e) => [e.kind, e.buyIn, e.buyOut])).toEqual([
			["add", 5_000, 0],
			["remove", 0, 15_000],
			["set", 0, 10_000],
		]);
		expect(h.data.seats[1]!.stack).toBe(30_000);

		h.send(owner, { type: "startGame" });
		const events = h.data.ledger.length;
		adjust("add", 1_000);
		expect(h.data.ledger.length).toBe(events);
		h.act({ type: "fold" });
		expect(h.data.ledger.at(-1)).toMatchObject({ kind: "add", buyIn: 1_000 });
		expect(h.data.seats[1]!.stack).toBe(32_000);
		balanced(h);
	});

	it("validates settings and applies mid-hand changes from the next hand", () => {
		const { h, owner, bob } = headsUp();
		const update = (patch: object) =>
			h.send(owner, { type: "updateSettings", settings: { ...DEFAULT_SETTINGS, autoStart: false, ...patch } });
		expect(() => update({ seats: 10 })).toThrow(/Seats must be/);
		expect(() => update({ smallBlind: 5_000 })).toThrow(/Small blind/);
		expect(() => update({ seats: 1 })).toThrow(/Seats must be/);
		expect(() => h.send(bob, { type: "updateSettings", settings: DEFAULT_SETTINGS })).toThrow(/owner/);

		h.send(owner, { type: "startGame" });
		update({ bigBlind: 4_000, smallBlind: 2_000 });
		expect(h.data.settings.bigBlind).toBe(2_000);
		expect(h.view(bob).pendingSettings).toMatchObject({ bigBlind: 4_000 });
		h.act({ type: "fold" });
		expect(h.data.settings.bigBlind).toBe(4_000);
		expect(h.data.pendingSettings).toBeNull();

		const carol = h.seat("carol", 5, 1_000);
		expect(carol).toBeTruthy();
		expect(() => update({ seats: 4 })).toThrow(/Seat 5 is occupied/);
	});

	it("pause and end take effect after the current hand", () => {
		const { h, owner, bob } = headsUp({ autoStart: true });
		h.send(owner, { type: "startGame" });
		h.send(owner, { type: "pauseGame" });
		expect(h.data).toMatchObject({ status: "running", pauseRequested: true });
		h.act({ type: "fold" });
		expect(h.data).toMatchObject({ status: "paused", pauseRequested: false, nextHandAt: null });

		h.send(owner, { type: "startGame" });
		h.send(owner, { type: "endGame" });
		expect(h.data.status).toBe("running");
		h.act({ type: "fold" });
		expect(h.data.status).toBe("ended");
		expect(() => h.send(bob, { type: "setAway", away: true })).toThrow(/ended/);
		balanced(h);
	});

	it("sends the settle-up payments once the game has ended", () => {
		const { h, owner, bob } = headsUp();
		h.send(owner, { type: "startGame" });
		h.act({ type: "fold" }); // owner (SB) folds: Bob wins the 1,000 small blind
		expect(h.view(bob).settlement).toBeNull();
		h.send(owner, { type: "endGame" });
		const view = h.view(bob);
		expect(view.ledger.map((r) => [r.nickname, r.net])).toEqual([
			["owner", -1_000],
			["bob", 1_000],
		]);
		expect(view.settlement).toEqual([{ from: owner, fromName: "owner", to: bob, toName: "bob", amount: 1_000 }]);
		expect(h.view(owner).settlement).toEqual(view.settlement);
	});

	it("pauses automatically when everyone is away", () => {
		const { h, owner, bob } = headsUp({ autoStart: true });
		h.send(owner, { type: "startGame" });
		h.send(owner, { type: "setAway", away: true });
		h.send(bob, { type: "setAway", away: true });
		h.act({ type: "fold" });
		expect(h.data.status).toBe("paused");
	});

	it("transfers ownership, and hands it off when the owner is offline 5 minutes", () => {
		const { h, owner, bob } = headsUp();
		h.advance(1_000);
		const carol = h.seat("carol", 3, 1_000);
		h.send(owner, { type: "transferOwnership", playerId: carol });
		expect(h.view(carol).you.isOwner).toBe(true);
		expect(() => h.send(owner, { type: "startGame" })).toThrow(/owner/);

		// Carol goes offline. The original owner (seated longest) is offline too,
		// so Bob is the longest-seated connected, active player.
		h.disconnect(owner);
		h.disconnect(carol);
		// Time passing alone never hands off: there's no timer (SPEC §4).
		h.advance(OWNER_OFFLINE_MS);
		expect(h.data.ownerId).toBe(carol);
		expect(h.table().nextAlarm()).toBeNull();
		// The next presence change after 5 minutes does: Dave connects to watch.
		h.join("dave");
		expect(h.data.ownerId).toBe(bob);
	});

	it("doesn't hand off on a presence change before 5 minutes", () => {
		const { h, owner, bob } = headsUp();
		h.disconnect(owner);
		h.advance(OWNER_OFFLINE_MS - 1);
		h.join("dave");
		expect(h.data.ownerId).toBe(owner);
		expect(bob).toBeTruthy();
	});
});

describe("joining a game in progress", () => {
	it("a new player waits for the big blind; posting a blind deals them in now", () => {
		const { h, owner } = headsUp();
		h.send(owner, { type: "startGame" });
		h.act({ type: "fold" });
		h.seat("carol", 3, 50_000);
		expect(h.data.seats[2]).toMatchObject({ waitingForBB: true });

		const dealt = () => h.data.hand!.players.map((p) => p.seat);
		h.send(owner, { type: "startGame" }); // hand 2: button 2, seat 1 would be BB
		expect(dealt()).toEqual([1, 2]);
		expect(h.view(owner).seats[2]).toMatchObject({ waitingForBB: true, inHand: false });
		while (h.data.hand) h.act({ type: "fold" });
		h.send(owner, { type: "startGame" }); // hand 3: button 1, Carol is the BB
		expect(dealt()).toEqual([1, 2, 3]);
		expect(h.data.hand!.log.find((e) => e.type === "bigBlind")!.seat).toBe(3);

		while (h.data.hand) h.act({ type: "fold" });
		const dave = h.join("dave");
		h.send(dave, { type: "requestSeat", seat: 4, nickname: "Dave", buyIn: 50_000, postBlind: true });
		h.send(owner, { type: "approveRequest", requestId: h.data.requests[0]!.id, stack: 50_000 });
		h.send(owner, { type: "startGame" });
		expect(dealt()).toContain(4);
		expect(h.data.hand!.log.some((e) => e.seat === 4 && (e.type === "post" || e.type.endsWith("Blind")))).toBe(true);
	});

	it("bomb pots deal in everyone who isn't away, even players waiting for the BB", () => {
		const { h, owner } = headsUp({ bombPotMode: "everyN", bombPotEvery: 2, bombPotAnteBB: 2, straddle: true });
		h.send(owner, { type: "startGame" });
		expect(h.data.hand!.bombPot).toBe(false); // hand 1
		h.act({ type: "fold" });
		h.seat("carol", 3, 50_000);
		const dave = h.seat("dave", 4, 50_000);
		h.send(dave, { type: "setAway", away: true });
		expect(h.data.seats[2]).toMatchObject({ waitingForBB: true });

		h.send(owner, { type: "startGame" }); // hand 2: every 2nd hand is a bomb pot
		const hand = h.data.hand!;
		expect(hand.bombPot).toBe(true);
		expect(hand.players.map((p) => p.seat)).toEqual([1, 2, 3]); // Dave is away
		// 2 BB ante each, nothing else: no blinds and no straddle.
		expect(hand.log.map((e) => [e.type, e.amount])).toEqual([
			["ante", 4_000],
			["ante", 4_000],
			["ante", 4_000],
		]);
		expect(hand.street).toBe("flop");
		expect(h.data.seats[2]).toMatchObject({ waitingForBB: false });
		expect(h.view(owner).hand).toMatchObject({ bombPot: true, pot: 12_000 });
	});

	it("a player can leave their seat; mid-hand it waits for the hand to end", () => {
		const { h, owner, bob } = headsUp();
		h.send(bob, { type: "leaveSeat" });
		expect(h.data.seats[1]).toBeNull();
		expect(h.data.ledger.at(-1)).toMatchObject({ kind: "leave", buyOut: 50_000 });
		balanced(h);
		expect(owner).toBeTruthy();
	});
});

describe("run it twice", () => {
	/** Heads-up all-in preflop: owner shoves 100,000, Bob calls all-in for 50,000. */
	function allIn(settings: object) {
		const { h, owner, bob } = headsUp(settings);
		h.send(owner, { type: "startGame" });
		h.act({ type: "raise", to: 100_000 });
		h.act({ type: "call" });
		return { h, owner, bob };
	}

	it("offers it to everyone in the pot for 5 s; all accepting runs it twice", () => {
		const { h, owner, bob } = allIn({ runItTwice: "ask" });
		const offer = h.view(bob).hand!.ritOffer;
		expect(offer).toEqual({ seats: [1, 2], accepted: [], deadline: h.clock.now + RIT_DECISION_MS });
		expect(h.view(owner).you.legal).toBeNull();
		expect(h.table().nextAlarm()).toEqual({ at: h.clock.now + RIT_DECISION_MS, timer: "runItTwice" });

		h.send(bob, { type: "runItTwice", hand: 1, accept: true });
		expect(h.view(owner).hand!.ritOffer!.accepted).toEqual([2]);
		expect(() => h.send(bob, { type: "runItTwice", hand: 1, accept: true })).toThrow(/already accepted/);
		h.send(owner, { type: "runItTwice", hand: 1, accept: true });

		const last = h.view(owner).lastHand!;
		expect(last.secondRun).toHaveLength(1);
		expect(last.secondRun![0]).toHaveLength(5);
		expect(new Set(last.pots.flatMap((p) => p.slices.map((s) => s.run)))).toEqual(new Set([0, 1]));
		expect(last.shown.every((s) => s.secondRunLabels?.length === 1)).toBe(true);
		balanced(h);
	});

	it("any decline, or no answer within 5 s, runs it once", () => {
		const declined = allIn({ runItTwice: "ask" });
		declined.h.send(declined.owner, { type: "runItTwice", hand: 1, accept: false });
		expect(declined.h.view(declined.owner).lastHand!.secondRun).toBeNull();

		const slow = allIn({ runItTwice: "ask" });
		slow.h.send(slow.owner, { type: "runItTwice", hand: 1, accept: true });
		slow.h.advance(RIT_DECISION_MS - 1);
		expect(slow.h.data.hand!.ritOffer).not.toBeNull();
		slow.h.advance(1);
		expect(slow.h.data.hand).toBeNull();
		expect(slow.h.view(slow.bob).lastHand!.secondRun).toBeNull();
		balanced(slow.h);
	});

	it("'always' runs twice without asking; 'no' never offers", () => {
		const always = allIn({ runItTwice: "always" });
		expect(always.h.view(always.owner).lastHand!.secondRun).toHaveLength(1);
		const no = allIn({ runItTwice: "no" });
		expect(no.h.view(no.owner).lastHand!.secondRun).toBeNull();
		expect(() => no.h.send(no.bob, { type: "runItTwice", hand: 1, accept: true })).toThrow(/hand is over/);
	});

	it("rejects answers from players outside the pot", () => {
		const { h } = allIn({ runItTwice: "ask" });
		const carol = h.seat("carol", 3, 1_000);
		expect(() => h.send(carol, { type: "runItTwice", hand: 1, accept: true })).toThrow(/not in this pot/);
	});
});

describe("rabbit hunt", () => {
	/** Owner raises preflop and Bob folds: the hand ends with no board. */
	function foldedPreflop(settings: object = { rabbitHunt: true }) {
		const { h, owner, bob } = headsUp(settings);
		const carol = h.join("carol"); // spectator
		h.send(owner, { type: "startGame" });
		h.act({ type: "raise", to: 6_000 });
		h.act({ type: "fold" });
		const rabbit = rabbitCards(h.data.prevHand!).map((b) => b.map(cardToString));
		return { h, owner, bob, carol, rabbit };
	}

	it("keeps the rabbit cards off every client until a seated player asks", () => {
		const { h, owner, bob, carol, rabbit } = foldedPreflop();
		expect(rabbit[0]).toHaveLength(5);
		for (const id of [owner, bob, carol]) {
			const json = JSON.stringify(h.view(id));
			for (const card of rabbit.flat()) expect(json).not.toContain(`"${card}"`);
			expect(h.view(id).lastHand).toMatchObject({ rabbitAvailable: true, rabbit: null });
		}
		expect(() => h.send(carol, { type: "rabbitHunt", hand: 1 })).toThrow(/isn't seated/);
		expect(() => h.send(bob, { type: "rabbitHunt", hand: 7 })).toThrow(/nothing to rabbit hunt/);

		h.send(bob, { type: "rabbitHunt", hand: 1 });
		for (const id of [owner, bob, carol]) {
			expect(h.view(id).lastHand).toMatchObject({ rabbitAvailable: false, rabbit: { boards: rabbit, by: "bob" } });
		}
		expect(() => h.send(owner, { type: "rabbitHunt", hand: 1 })).toThrow(/nothing to rabbit hunt/);
		// Display only: Bob still lost the blind he posted.
		expect(h.data.seats[1]!.stack).toBe(48_000);
	});

	it("isn't available when it's off, after a full board, or once the next hand starts", () => {
		const off = foldedPreflop({ rabbitHunt: false });
		expect(off.h.view(off.bob).lastHand!.rabbitAvailable).toBe(false);
		expect(() => off.h.send(off.bob, { type: "rabbitHunt", hand: 1 })).toThrow(/turned off/);

		const { h, owner, bob } = headsUp({ rabbitHunt: true });
		h.send(owner, { type: "startGame" });
		h.act({ type: "raise", to: 100_000 });
		h.act({ type: "call" }); // all-in: the board runs out to the river
		expect(h.view(bob).lastHand!.rabbitAvailable).toBe(false);

		const next = foldedPreflop();
		next.h.send(next.owner, { type: "startGame" });
		expect(next.h.view(next.bob).lastHand!.rabbitAvailable).toBe(false);
	});
});

describe("Pineapple", () => {
	const holeOf = (h: ReturnType<typeof harness>, seat: number) =>
		h.data.hand!.players.find((p) => p.seat === seat)!.hole.map(cardToString);

	it("discards at once before betting; discarded cards reach no client; a timeout discards the lowest", () => {
		const { h, owner, bob } = headsUp({ variant: "PINEAPPLE" });
		const carol = h.join("carol"); // spectator
		h.send(owner, { type: "startGame" });
		const deadline = h.clock.now + DEFAULT_SETTINGS.decisionTimeSec * 1000;
		expect(h.view(carol).hand!.discard).toEqual({ seats: [1, 2], deadline });
		expect(h.view(owner).you.legal).toBeNull();
		expect(h.view(owner).seats[0]!.cards).toHaveLength(5);

		const ownerCard = holeOf(h, 1)[2]!;
		expect(() => h.send(owner, { type: "discard", hand: 1, card: holeOf(h, 2)[0]! })).toThrow(/don't hold/);
		h.send(owner, { type: "discard", hand: 1, card: ownerCard });
		expect(() => h.send(owner, { type: "discard", hand: 1, card: holeOf(h, 1)[0]! })).toThrow(/nothing to discard/);
		expect(h.view(bob).hand!.discard!.seats).toEqual([2]);

		// Bob never answers: at the deadline his lowest card goes.
		const bobHole = h.data.hand!.players.find((p) => p.seat === 2)!.hole;
		const bobLowest = cardToString(Math.min(...bobHole));
		h.advance(DEFAULT_SETTINGS.decisionTimeSec * 1000);
		expect(h.data.hand!.discard).toBeNull();
		expect(holeOf(h, 2)).not.toContain(bobLowest);
		expect(h.view(owner).hand!.toAct).toBe(1); // preflop betting starts

		// Neither discard appears in any view, including the discarders' own.
		for (const id of [owner, bob, carol]) {
			const json = JSON.stringify(h.view(id));
			expect(json).not.toContain(`"${ownerCard}"`);
			expect(json).not.toContain(`"${bobLowest}"`);
		}
		expect(h.view(owner).seats[0]!.cards).toHaveLength(4);
		expect(h.view(bob).seats[0]!.cards).toEqual([null, null, null, null]);
	});

	it("plays to showdown holding 2 cards each", () => {
		const { h, owner } = headsUp({ variant: "PINEAPPLE" });
		h.send(owner, { type: "startGame" });
		while (h.data.hand) {
			if (h.data.hand.discard) h.advance(DEFAULT_SETTINGS.decisionTimeSec * 1000);
			else h.act(h.table().data.hand!.currentBet > h.data.hand.players.find((p) => p.seat === h.data.hand!.toAct)!.bet ? { type: "call" } : { type: "check" });
		}
		expect(h.data.lastHand!.shown.every((s) => s.cards.length === 2)).toBe(true);
		balanced(h);
	});
});

describe("short deck", () => {
	it("deals from a 36-card deck", () => {
		const { h, owner } = headsUp({ variant: "SHORT" });
		h.send(owner, { type: "startGame" });
		expect(h.data.hand!.deck).toHaveLength(36);
		const ranks = new Set(h.data.hand!.deck.map((c) => cardToString(c)[0]));
		for (const low of ["2", "3", "4", "5"]) expect(ranks.has(low)).toBe(false);
	});
});

describe("alarms", () => {
	it("owner offline with no one to take over: no alarm in the past, and a seated player connecting takes over", () => {
		const { h, owner, bob } = headsUp();
		h.join("carol"); // a spectator keeps the table from being empty
		h.disconnect(bob);
		h.disconnect(owner);
		// The owner hand-off never has a timer (SPEC §4): nothing is scheduled.
		expect(h.table().nextAlarm()).toBeNull();

		// Five minutes pass: Carol isn't seated and Bob is offline, so nobody qualifies.
		h.advance(OWNER_OFFLINE_MS);
		expect(h.data.ownerId).toBe(owner);
		expect(h.data.ownerOfflineSince).not.toBeNull();
		// The hand-off isn't rescheduled for a time that's already passed.
		expect(h.table().nextAlarm()).toBeNull();
		h.advance(60 * 60_000);
		expect(h.table().nextAlarm()).toBeNull();
		expect(h.data.ownerId).toBe(owner);

		// Bob connects: presence alone (no timer) hands him the table.
		h.connected.add(bob);
		h.table().syncPresence();
		expect(h.data.ownerId).toBe(bob);
		expect(h.data.ownerOfflineSince).toBeNull();
		expect(h.view(bob).you.isOwner).toBe(true);
	});

	it("an away player isn't a candidate until they come back", () => {
		const { h, owner, bob } = headsUp();
		h.send(bob, { type: "setAway", away: true });
		h.disconnect(owner);
		h.advance(OWNER_OFFLINE_MS);
		expect(h.data.ownerId).toBe(owner);
		expect(h.table().nextAlarm()).toBeNull();
		h.send(bob, { type: "setAway", away: false });
		expect(h.data.ownerId).toBe(bob);
	});

	it("with the game going on, hands off at a hand end once the owner has been offline 5 minutes", () => {
		const { h, owner, bob } = headsUp({ autoStart: true });
		const carol = h.seat("carol", 3, 50_000);
		h.send(owner, { type: "startGame" });
		const left = h.clock.now;
		h.disconnect(owner);
		// Bob and Carol keep playing (check or fold after 5 s); the owner times
		// out, then sits out as away. No timer is ever set for the hand-off.
		for (let steps = 0; h.data.ownerId === owner; steps++) {
			expect(steps).toBeLessThan(2_000);
			expect(h.data.ownerId === owner || h.data.hand === null).toBe(true);
			h.advance(5_000);
			const hand = h.data.hand;
			const toAct = hand?.toAct ? h.data.seats[hand.toAct - 1]!.playerId : null;
			if (toAct === bob || toAct === carol) {
				h.act(h.view(toAct).you.legal!.canCheck ? { type: "check" } : { type: "fold" });
			}
		}
		// It moved when a hand ended, 5+ minutes after the owner left, to Bob,
		// the longest-seated connected player who isn't away.
		expect(h.data.ownerId).toBe(bob);
		expect(h.data.hand).toBeNull();
		expect(h.clock.now - left).toBeGreaterThanOrEqual(OWNER_OFFLINE_MS);
		expect(h.data.handNumber).toBeGreaterThan(3);
	});

	it("never schedules the next hand during a hand", () => {
		const { h, owner } = headsUp({ autoStart: true });
		h.send(owner, { type: "startGame" });
		h.data.nextHandAt = h.clock.now - 1; // inconsistent state: must not wake us
		expect(h.table().nextAlarm()!.timer).toBe("turn");
	});

	it("TableRoom's safety net clamps a due or past alarm to +5 s", () => {
		const now = 1_000_000;
		expect(scheduleAlarm(now + 1, now)).toEqual({ at: now + 1, clamped: false });
		expect(scheduleAlarm(now, now)).toEqual({ at: now + ALARM_CLAMP_MS, clamped: true });
		expect(scheduleAlarm(now - 60_000, now)).toEqual({ at: now + ALARM_CLAMP_MS, clamped: true });
		expect(ALARM_CLAMP_MS).toBe(5_000);
	});
});

describe("ledger invariant", () => {
	it("throws after a hand if the nets don't sum to 0", () => {
		const { h, owner } = headsUp();
		h.send(owner, { type: "startGame" });
		h.data.hand!.players[1]!.stack += 1; // simulate a pot-splitting bug
		expect(() => h.act({ type: "fold" })).toThrow(/ledger nets sum to 1/);
	});
});

describe("lifetime", () => {
	it("is deleted after 12 hours with nobody connected", () => {
		const { h, owner, bob } = headsUp();
		h.disconnect(owner);
		h.disconnect(bob);
		expect(h.table().nextAlarm()).toEqual({ at: h.clock.now + IDLE_DELETE_MS, timer: "idleDelete" });
		h.advance(IDLE_DELETE_MS - 1);
		expect(h.table().shouldDelete()).toBe(false);
		h.advance(1);
		expect(h.table().shouldDelete()).toBe(true);
	});
});
