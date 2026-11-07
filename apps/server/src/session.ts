/**
 * The session's memory beyond the last hand: a compact index of every hand,
 * per-player statistics and highlights (kept in the table record), and full
 * hand records for replays (written to their own storage keys by TableRoom,
 * last HISTORY_KEEP only). Everything here is derived from public events:
 * actions, nets, and cards shown at showdown or chosen to be shown.
 */
import {
	type Card,
	Category,
	type HandState,
	handLabel,
	handValue,
	type VariantName,
} from "@garagepoker/engine";
import type { HighlightView, SessionView, StatsRowView } from "@garagepoker/protocol";
import type { TableData, TableHandRecord } from "./table.js";

/** Hands kept for replay and the history list. */
export const HISTORY_KEEP = 200;
/** Storage key for a hand's full record. */
export const handKey = (hand: number) => `hand:${hand}`;

/** A finished hand's record as stored for replays: the engine input and actions, plus cards shown after it. */
export interface StoredHand extends TableHandRecord {
	showed: { seat: number; cards: Card[] }[];
	endedAt: number;
}

/** One line of the history list. */
export interface HistoryEntry {
	hand: number;
	endedAt: number;
	variant: VariantName;
	pot: number;
	bombPot: boolean;
	players: { playerId: string; seat: number; nickname: string; net: number }[];
	/** Nicknames of everyone who won chips. */
	winners: string[];
	/** The best hand shown at showdown (first board), if there was a showdown. */
	best: { nickname: string; label: string; category: Category; score: number } | null;
}

export interface PlayerStats {
	playerId: string;
	nickname: string;
	hands: number;
	/** Hands dealt with preflop betting (not bomb pots): the base for VPIP and PFR. */
	preflopHands: number;
	vpip: number;
	pfr: number;
	showdowns: number;
	showdownWins: number;
	potsWon: number;
	biggestPot: number;
	net: number;
	/** Lowest running net so far, and the biggest climb back from a low. */
	low: number;
	comeback: number;
	comebackHand: number | null;
}

/** A shown bluff: won without a showdown, then chose to show a hand that was only high card. */
export interface ShownBluff {
	hand: number;
	nickname: string;
	cards: Card[];
}

export interface SessionData {
	history: HistoryEntry[];
	stats: Record<string, PlayerStats>;
	bluffs: ShownBluff[];
	/** Finished hands waiting to be written to their own storage keys. */
	outbox: StoredHand[];
}

export function session(d: TableData): SessionData {
	return (d.session ??= { history: [], stats: {}, bluffs: [], outbox: [] });
}

const VOLUNTARY = new Set(["call", "raise", "bet"]);

/**
 * Called as a hand finishes, before lastHand/prevRecord move on: queues the
 * previous hand's full record for storage (it's leaving prevRecord), and
 * adds this hand to the index and the statistics.
 */
export function recordHand(d: TableData, hand: HandState, record: TableHandRecord | null, now: number): void {
	const s = session(d);
	// The hand being replaced as "the last hand" goes to storage, with any cards shown after it.
	if (d.prevRecord) {
		const showed = d.lastHand?.number === d.prevRecord.hand ? (d.lastHand.showed ?? []) : [];
		s.outbox.push({ ...d.prevRecord, showed: showed.map((x) => ({ seat: x.seat, cards: x.cards })), endedAt: d.lastHand?.endedAt ?? now });
	}
	if (!record || !hand.result) return;

	const result = hand.result;
	const won = new Map(result.payouts.map((p) => [p.seat, p.amount]));
	const bySeat = new Map(record.players.map((p) => [p.seat, p]));
	const showdown = new Set(result.showdown.map((h) => h.seat));
	const pot = result.pots.reduce((sum, p) => sum + p.amount, 0);

	// The best hand shown, on the first board of the first run.
	let best: HistoryEntry["best"] = null;
	for (const h of result.showdown) {
		const v = h.boards[0]?.high;
		if (v && (!best || v.score > best.score)) {
			best = {
				nickname: bySeat.get(h.seat)?.nickname ?? `Seat ${h.seat}`,
				label: handLabel(hand.config.variant, h.hole, hand.boards[0]!).text.split(" / ")[0]!,
				category: v.category,
				score: v.score,
			};
		}
	}

	const players = hand.players.map((p) => {
		const who = bySeat.get(p.seat)!;
		return { playerId: who.playerId, seat: p.seat, nickname: who.nickname, net: (won.get(p.seat) ?? 0) - p.committed };
	});
	s.history.push({
		hand: record.hand,
		endedAt: now,
		variant: d.settings.variant,
		pot,
		bombPot: hand.bombPot,
		players,
		winners: players.filter((p) => (won.get(p.seat) ?? 0) > 0).map((p) => p.nickname),
		best,
	});
	if (s.history.length > HISTORY_KEEP) s.history.splice(0, s.history.length - HISTORY_KEEP);

	for (const p of players) {
		const st = (s.stats[p.playerId] ??= {
			playerId: p.playerId,
			nickname: p.nickname,
			hands: 0,
			preflopHands: 0,
			vpip: 0,
			pfr: 0,
			showdowns: 0,
			showdownWins: 0,
			potsWon: 0,
			biggestPot: 0,
			net: 0,
			low: 0,
			comeback: 0,
			comebackHand: null,
		});
		st.nickname = p.nickname;
		st.hands++;
		if (!hand.bombPot) {
			st.preflopHands++;
			const pre = hand.log.filter((e) => e.seat === p.seat && e.street === "preflop");
			if (pre.some((e) => VOLUNTARY.has(e.type))) st.vpip++;
			if (pre.some((e) => e.type === "raise")) st.pfr++;
		}
		const amount = won.get(p.seat) ?? 0;
		if (showdown.has(p.seat)) {
			st.showdowns++;
			if (amount > 0) st.showdownWins++;
		}
		if (amount > 0) {
			st.potsWon++;
			st.biggestPot = Math.max(st.biggestPot, amount);
		}
		st.net += p.net;
		st.low = Math.min(st.low, st.net);
		if (st.net - st.low > st.comeback) {
			st.comeback = st.net - st.low;
			st.comebackHand = record.hand;
		}
	}
}

/**
 * Cards shown after winning without a showdown: if they were all the player's
 * cards and only make high card with the board, that's a bluff shown. (Only
 * what the player chose to reveal counts as evidence.)
 */
export function noteShownCards(d: TableData, nickname: string, seatCards: Card[], shown: Card[], won: boolean): void {
	const last = d.lastHand;
	if (!last || !won || last.shown.length > 0 || shown.length !== seatCards.length) return;
	const board = last.boards[0] ?? [];
	if (board.length < 3) return;
	const variant = d.prevHand?.config.variant;
	if (!variant) return;
	if (handValue(variant, seatCards, board).category === Category.HighCard) {
		const s = session(d);
		if (!s.bluffs.some((b) => b.hand === last.number && b.nickname === nickname)) s.bluffs.push({ hand: last.number, nickname, cards: shown });
		if (s.bluffs.length > 20) s.bluffs.shift();
	}
}

/** Chips that moved outside a pot (the 7-2 bounty) count in the session nets too. */
export function adjustNet(d: TableData, playerId: string, delta: number): void {
	const st = d.session?.stats[playerId];
	if (st) {
		st.net += delta;
		st.low = Math.min(st.low, st.net);
	}
}

const pct = (n: number, of: number) => (of > 0 ? Math.round((n * 100) / of) : null);

/** Session statistics and highlights for views: everyone at the table sees the same. */
export function sessionView(d: TableData): SessionView {
	const s = d.session;
	if (!s || s.history.length === 0) return { hands: 0, stats: [], highlights: [] };
	const stats: StatsRowView[] = Object.values(s.stats)
		.sort((a, b) => b.net - a.net)
		.map((st) => ({
			nickname: st.nickname,
			hands: st.hands,
			vpip: pct(st.vpip, st.preflopHands),
			pfr: pct(st.pfr, st.preflopHands),
			showdowns: st.showdowns,
			showdownWins: st.showdownWins,
			potsWon: st.potsWon,
			biggestPot: st.biggestPot,
			net: st.net,
		}));

	const highlights: HighlightView[] = [];
	const biggest = s.history.reduce<HistoryEntry | null>((m, h) => (!m || h.pot > m.pot ? h : m), null);
	if (biggest && biggest.pot > 0) {
		highlights.push({ kind: "biggestPot", hand: biggest.hand, title: "Biggest pot", detail: `${biggest.winners.join(" and ") || "Split"} won it`, amount: biggest.pot });
	}
	const bestShown = s.history.reduce<HistoryEntry | null>((m, h) => (h.best && (!m?.best || h.best.score > m.best.score) ? h : m), null);
	if (bestShown?.best && bestShown.best.category >= Category.TwoPair) {
		highlights.push({ kind: "bestHand", hand: bestShown.hand, title: "Best hand shown", detail: `${bestShown.best.nickname}: ${bestShown.best.label}`, amount: null });
	}
	const comeback = Object.values(s.stats).reduce<PlayerStats | null>((m, st) => (!m || st.comeback > m.comeback ? st : m), null);
	// A comeback has to be worth telling: at least 10 big blinds back from below zero.
	if (comeback && comeback.comebackHand !== null && comeback.low < 0 && comeback.comeback >= 10 * d.settings.bigBlind) {
		highlights.push({ kind: "comeback", hand: comeback.comebackHand, title: "Biggest comeback", detail: `${comeback.nickname} climbed back`, amount: comeback.comeback });
	}
	for (const h of s.history) {
		if (h.best && h.best.category >= Category.Quads) {
			highlights.push({ kind: "rareHand", hand: h.hand, title: "Rare hand", detail: `${h.best.nickname}: ${h.best.label}`, amount: h.pot });
		}
	}
	for (const b of s.bluffs) {
		highlights.push({ kind: "shownBluff", hand: b.hand, title: "Bluff shown", detail: `${b.nickname} won without a showdown and showed high card`, amount: null });
	}
	return { hands: s.history.length, stats, highlights };
}
