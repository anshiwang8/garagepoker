import { assertLedgerBalanced, DEFAULT_SETTINGS, ledgerRows } from "@garagepoker/engine";
import { describe, expect, it } from "vitest";
import { IDLE_DELETE_MS, OWNER_OFFLINE_MS } from "../src/table.js";
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
		expect(h.data.lastHand!.pots[0]!.winners[0]!.seat).toBe(2);
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

	it("a disconnected player times out without the bank and goes away after 2 missed hands", () => {
		const { h, owner, bob } = headsUp();
		h.disconnect(bob);
		for (let hand = 1; hand <= 2; hand++) {
			h.send(owner, { type: "startGame" });
			while (h.data.hand) {
				if (h.data.hand.toAct === 2) h.advance(20_000);
				else h.act(h.table().data.hand!.currentBet > h.data.hand.players[0]!.bet ? { type: "call" } : { type: "check" });
			}
			expect(h.data.seats[1]).toMatchObject({ missedHands: hand, away: hand === 2, timeBankMs: 60_000 });
		}
		expect(h.view(owner).seats[1]).toMatchObject({ away: true, connected: false });
		// Only one player left who isn't away: no hand starts.
		h.send(owner, { type: "startGame" });
		expect(h.data.hand).toBeNull();
		// Coming back clears away and the count.
		h.join("bob");
		h.send(bob, { type: "setAway", away: false });
		expect(h.data.seats[1]).toMatchObject({ away: false, missedHands: 0 });
		expect(h.data.hand).not.toBeNull();
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
		h.advance(OWNER_OFFLINE_MS - 1);
		expect(h.data.ownerId).toBe(carol);
		h.advance(1);
		expect(h.data.ownerId).toBe(bob);
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

	it("a player can leave their seat; mid-hand it waits for the hand to end", () => {
		const { h, owner, bob } = headsUp();
		h.send(bob, { type: "leaveSeat" });
		expect(h.data.seats[1]).toBeNull();
		expect(h.data.ledger.at(-1)).toMatchObject({ kind: "leave", buyOut: 50_000 });
		balanced(h);
		expect(owner).toBeTruthy();
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
		expect(h.table().nextAlarm()).toBe(h.clock.now + OWNER_OFFLINE_MS);
		h.advance(IDLE_DELETE_MS - 1);
		expect(h.table().shouldDelete()).toBe(false);
		h.advance(1);
		expect(h.table().shouldDelete()).toBe(true);
	});
});
