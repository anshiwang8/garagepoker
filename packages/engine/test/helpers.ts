import {
  applyAction,
  type Card,
  type DeckSize,
  type HandConfig,
  type HandState,
  makeDeck,
  parseCards,
  type RandomSource,
  startHand,
  VARIANTS,
} from "../src/index.js";

/** Deterministic RandomSource (mulberry32) so statistical tests never flake. */
export function seededRandom(seed: number): RandomSource {
  let a = seed >>> 0;
  return (buf) => {
    for (let i = 0; i < buf.length; i++) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      buf[i] = (t ^ (t >>> 14)) >>> 0;
    }
  };
}

/** The real CSPRNG, as the server will pass it in. */
export const cryptoRandom: RandomSource = (buf) => {
  (globalThis as unknown as { crypto: { getRandomValues(b: Uint32Array): void } }).crypto.getRandomValues(buf);
};

export const NL: HandConfig = {
  variant: VARIANTS.NLH,
  smallBlind: 10,
  bigBlind: 20,
  ante: 0,
  straddle: false,
};

export const PL: HandConfig = { ...NL, variant: VARIANTS.PLO };

/**
 * A deck that deals the given hole cards (one string per player, in deal
 * order: first seat left of the button first) and then the board.
 */
export function stackDeck(holes: string[], board: string, deckSize: DeckSize = 52): Card[] {
  const top = [...holes.flatMap(parseCards), ...parseCards(board)];
  return [...top, ...makeDeck(deckSize).filter((c) => !top.includes(c))];
}

export function start(
  stacks: Record<number, number>,
  button: number,
  config: HandConfig = NL,
  deck: Card[] = makeDeck(config.variant.deckSize),
  postBlind: number[] = [],
): HandState {
  const players = Object.entries(stacks).map(([seat, stack]) => ({
    seat: Number(seat),
    stack,
    postBlind: postBlind.includes(Number(seat)),
  }));
  return startHand({ config, players, button, deck });
}

/** Applies actions written like "1 call", "2 raise 60", "3 fold". */
export function play(state: HandState, ...actions: string[]): HandState {
  let s = state;
  for (const a of actions) {
    const [seatText, type, to] = a.split(" ");
    const seat = Number(seatText);
    if (type === "raise") s = applyAction(s, { type, seat, to: Number(to) });
    else s = applyAction(s, { type: type as "fold" | "check" | "call", seat });
  }
  return s;
}

/** Checks the hand down to the end. */
export function checkDown(state: HandState): HandState {
  let s = state;
  while (s.toAct !== null) s = applyAction(s, { type: "check", seat: s.toAct });
  return s;
}

export const player = (s: HandState, seat: number) => s.players.find((p) => p.seat === seat)!;
export const stack = (s: HandState, seat: number) => player(s, seat).stack;
export const bet = (s: HandState, seat: number) => player(s, seat).bet;
