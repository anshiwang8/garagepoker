/**
 * Builds a viewer's replay of the last finished hand by re-running its
 * recorded actions through the engine. Like views, frames are assembled
 * field by field: a viewer sees their own hole cards and cards shown at
 * showdown or after the hand, never anyone else's cards, discards or the deck.
 */
import { cardToString, type HandState, handLabel, potTotal, replayHand, type Street } from "@garagepoker/engine";
import type { ReplayEvent, ReplayFrame, ReplayView } from "@garagepoker/protocol";
import type { TableData } from "./table.js";

const cards = (cs: readonly number[]) => cs.map(cardToString);

/** The street a board card at this position was dealt on. */
const streetOf = (position: number): Street => (position < 3 ? "flop" : position === 3 ? "turn" : "river");

/** Board cards added between two states, grouped by street, run and board. */
function dealEvents(before: Card2D | null, after: Card2D, run: number): ReplayEvent[] {
	const events: ReplayEvent[] = [];
	after.forEach((board, b) => {
		const from = before?.[b]?.length ?? 0;
		const byStreet = new Map<Street, number[]>();
		for (let i = from; i < board.length; i++) {
			const street = streetOf(i);
			byStreet.set(street, [...(byStreet.get(street) ?? []), board[i]!]);
		}
		for (const [street, dealt] of byStreet) events.push({ kind: "deal", street, run, board: b, cards: cards(dealt) });
	});
	return events;
}
type Card2D = readonly (readonly number[])[];

export function buildReplay(data: TableData, viewerId: string): ReplayView | null {
	const rec = data.prevRecord;
	if (!rec) return null;
	const seated = data.seats.some((s) => s?.playerId === viewerId);
	if (!data.settings.spectators && !seated && viewerId !== data.ownerId) return null;

	const states = replayHand(rec.record);
	const final = states[states.length - 1]!;
	const mySeat = rec.players.find((p) => p.playerId === viewerId)?.seat ?? null;
	const names = new Map(rec.players.map((p) => [p.seat, p.nickname]));
	const shownSeats = new Set(final.result?.showdown.map((h) => h.seat) ?? []);
	// Cards players chose to show after the hand (only while it's still the last hand).
	const showed = data.lastHand?.number === rec.hand ? (data.lastHand.showed ?? []) : [];
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
		events.push(...dealEvents(prev?.boards ?? null, st.boards, 0));
		if (st.secondRun) events.push(...dealEvents(prev?.secondRun ?? st.boards.map(() => []), st.secondRun, 1));

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
		frames,
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
