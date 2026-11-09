/**
 * Builds a viewer's replay of the last finished hand by re-running its
 * recorded actions through the engine. Like views, frames are assembled
 * field by field: a viewer sees their own hole cards and cards shown at
 * showdown or after the hand, never anyone else's cards, discards or the deck.
 */
import {
	type BoardLayout,
	cardToString,
	extraRoundOfPosition,
	type HandState,
	handLabel,
	potTotal,
	replayHand,
	type Street,
	streetOfPosition,
} from "@garagepoker/engine";
import { RED_RIVER_STOPS, type ReplayEvent, type ReplayFrame, type ReplayView, streetTitle } from "@garagepoker/protocol";
import type { StoredHand } from "./session.js";
import { isBlocked, needsCode, type TableData } from "./table.js";

const cards = (cs: readonly number[]) => cs.map(cardToString);

/**
 * Board cards added between two states, grouped by street (each red river
 * round on its own), run and board.
 */
function dealEvents(layout: BoardLayout, before: Card2D | null, after: Card2D, run: number): ReplayEvent[] {
	const events: ReplayEvent[] = [];
	after.forEach((board, b) => {
		const from = before?.[b]?.length ?? 0;
		const groups: { street: Street; extraRound: number; dealt: number[] }[] = [];
		for (let i = from; i < board.length; i++) {
			const street = streetOfPosition(layout, i);
			const extraRound = extraRoundOfPosition(layout, i);
			const group = groups.find((g) => g.street === street && g.extraRound === extraRound);
			if (group) group.dealt.push(board[i]!);
			else groups.push({ street, extraRound, dealt: [board[i]!] });
		}
		for (const { street, extraRound, dealt } of groups) {
			events.push({ kind: "deal", street, ...(extraRound > 0 && { extraRound }), run, board: b, cards: cards(dealt) });
		}
	});
	return events;
}
type Card2D = readonly (readonly number[])[];

/** Whether this viewer may see the table's hands at all (same rule as views). */
export function canReview(data: TableData, viewerId: string): boolean {
	if (viewerId === data.ownerId) return true;
	if (isBlocked(data, viewerId) || needsCode(data, viewerId)) return false;
	return data.settings.spectators || data.seats.some((s) => s?.playerId === viewerId);
}

/**
 * A viewer's replay of a finished hand: the last one (from the table record)
 * or an earlier one loaded from storage (`stored`).
 */
export function buildReplay(data: TableData, viewerId: string, stored?: StoredHand | null): ReplayView | null {
	const rec = stored ?? data.prevRecord;
	if (!rec) return null;
	if (!canReview(data, viewerId)) return null;

	const states = replayHand(rec.record);
	const final = states[states.length - 1]!;
	const mySeat = rec.players.find((p) => p.playerId === viewerId)?.seat ?? null;
	const names = new Map(rec.players.map((p) => [p.seat, p.nickname]));
	const shownSeats = new Set(final.result?.showdown.map((h) => h.seat) ?? []);
	// Cards players chose to show after the hand: saved with stored hands, or the last hand's so far.
	const showed = stored ? stored.showed : data.lastHand?.number === rec.hand ? (data.lastHand.showed ?? []) : [];
	const showedCards = new Set(showed.flatMap((s) => s.cards));

	const frames = states.map((st: HandState, i): ReplayFrame => {
		const prev = i > 0 ? states[i - 1]! : null;
		const events: ReplayEvent[] = st.log.slice(prev ? prev.log.length : 0).map((e) => ({
			kind: "action" as const,
			seat: e.seat,
			type: e.type,
			amount: e.amount,
			...(e.to !== undefined && { to: e.to }),
			...(e.allIn !== undefined && { allIn: e.allIn }),
		}));
		const layout = st.config.variant.board;
		events.push(...dealEvents(layout, prev?.boards ?? null, st.boards, 0));
		if (st.secondRun) events.push(...dealEvents(layout, prev?.secondRun ?? st.boards.map(() => []), st.secondRun, 1));

		const complete = st.street === "complete";
		if (complete && st.result) {
			for (const h of st.result.showdown) {
				events.push({
					kind: "showdown",
					seat: h.seat,
					cards: cards(h.hole),
					labels: st.boards.map((b) => handLabel(st.config.variant, h.hole, b).text),
				});
			}
			for (const p of st.result.payouts) events.push({ kind: "win", seat: p.seat, amount: p.amount });
			for (const s of showed) events.push({ kind: "show", seat: s.seat, cards: cards(s.cards) });
		}

		return {
			events,
			street: st.street,
			...(st.street === "extra" && { extraRound: st.extraRound }),
			boards: st.boards.map(cards),
			secondRun: st.secondRun?.map(cards) ?? null,
			pot: complete ? 0 : potTotal(st),
			seats: st.players.map((p) => {
				// Your own cards as they were then; others' only once shown at showdown.
				const visible = p.seat === mySeat || (complete && shownSeats.has(p.seat));
				return {
					seat: p.seat,
					nickname: names.get(p.seat) ?? `Seat ${p.seat}`,
					stack: p.stack,
					bet: p.bet,
					folded: p.folded,
					cards: p.hole.map((c) => (visible || (complete && showedCards.has(c)) ? cardToString(c) : null)),
				};
			}),
		};
	});

	return {
		hand: rec.hand,
		grid: final.config.variant.board.grid ?? null,
		frames,
		redRiverStopped: final.redRiverStopped ?? false,
		pots: (final.result?.pots ?? []).map((pot) => ({
			amount: pot.amount,
			slices: pot.slices.map((s) => ({
				run: s.run,
				board: s.board,
				half: s.half,
				amount: s.amount,
				winners: s.winners.map((w) => ({ seat: w.seat, amount: w.amount })),
			})),
		})),
	};
}

// ---------------------------------------------------------------------------
// Text export: the viewer's permitted history, one block per hand.
// ---------------------------------------------------------------------------

/** "1980" or, in cent mode, "19.80". */
function chips(amount: number, cents: boolean): string {
	return cents ? (amount / 100).toFixed(2) : String(amount);
}

function actionLine(type: string, amount: number, to: number | undefined, cents: boolean): string {
	switch (type) {
		case "fold":
		case "check":
			return type === "fold" ? "folds" : "checks";
		case "raise":
		case "bet":
			return `${type === "raise" ? "raises" : "bets"} to ${chips(to ?? amount, cents)}`;
		case "ritAccept":
			return "agrees to run it twice";
		case "ritDecline":
			return "runs it once";
		case "discard":
			return "discards";
		case "uncalled":
			return `gets ${chips(amount, cents)} back (uncalled)`;
		default:
			return `${type.replace(/([A-Z])/g, " $1").toLowerCase()} ${chips(amount, cents)}`;
	}
}

/** One hand as text, from the viewer's replay: only cards they were allowed to see. */
export function replayText(replay: ReplayView, meta: { variant: string; endedAt: number; cents: boolean; viewerSeat: number | null }): string {
	const first = replay.frames[0]!;
	const last = replay.frames[replay.frames.length - 1]!;
	const names = new Map(first.seats.map((s) => [s.seat, s.nickname]));
	const name = (seat: number) => names.get(seat) ?? `Seat ${seat}`;
	const lines = [`Hand #${replay.hand} · ${meta.variant} · ${new Date(meta.endedAt).toISOString().replace("T", " ").slice(0, 16)} UTC`];
	lines.push(`Seats: ${first.seats.map((s) => `${s.seat} ${s.nickname} (${chips(s.stack + s.bet, meta.cents)})`).join(" · ")}`);
	// Every hole card the viewer held: the frame with the most (later streets add cards in Reverse Pineapple; Pineapple's discard only shrinks the hand, so its first frame still wins).
	let mine: (typeof first.seats)[number] | undefined;
	if (meta.viewerSeat !== null) {
		for (const f of replay.frames) {
			const seat = f.seats.find((s) => s.seat === meta.viewerSeat);
			if (seat && seat.cards.every(Boolean) && (!mine || seat.cards.length > mine.cards.length)) mine = seat;
		}
	}
	if (mine && mine.cards.length > 0) lines.push(`Your cards: ${mine.cards.join(" ")}`);
	lines.push(`${streetTitle("preflop")}:`);
	// Red river stopped once the last round's cards and betting were done, so the note goes before the result.
	let stopNoted = !replay.redRiverStopped;
	for (const f of replay.frames) {
		for (const e of f.events) {
			if (!stopNoted && (e.kind === "showdown" || e.kind === "win")) {
				lines.push(RED_RIVER_STOPS);
				stopNoted = true;
			}
			if (e.kind === "action") lines.push(`  ${name(e.seat)} ${actionLine(e.type, e.amount, e.to, meta.cents)}${e.allIn ? " (all in)" : ""}`);
			else if (e.kind === "deal") lines.push(`${streetTitle(e.street, e.extraRound)}${e.run ? ` (run ${e.run + 1})` : ""}${e.board ? ` (board ${e.board + 1})` : ""}: ${e.cards.join(" ")}`);
			else if (e.kind === "showdown") lines.push(`  ${name(e.seat)} shows ${e.cards.join(" ")} (${e.labels.join(" | ")})`);
			else if (e.kind === "win") lines.push(`  ${name(e.seat)} wins ${chips(e.amount, meta.cents)}`);
			else if (e.kind === "show") lines.push(`  ${name(e.seat)} shows ${e.cards.join(" ")}`);
		}
	}
	if (last.boards.some((b) => b.length > 0)) lines.push(`Board: ${last.boards.map((b) => b.join(" ")).join(" / ")}`);
	return lines.join("\n");
}
