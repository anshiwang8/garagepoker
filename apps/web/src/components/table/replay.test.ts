import type { ReplayEvent, ReplayFrame, ReplayView } from "@garagepoker/protocol";
import { describe, expect, it } from "vitest";
import { eventText, stopPoint } from "./ReplayDialog";

const frame = (events: ReplayFrame["events"], street: ReplayFrame["street"] = "river", extraRound?: number): ReplayFrame => ({
  events,
  street,
  extraRound,
  boards: [],
  secondRun: null,
  pot: 0,
  seats: [],
});

const replay = (frames: ReplayFrame[], redRiverStopped: boolean): ReplayView => ({ hand: 7, grid: null, frames, pots: [], redRiverStopped });

describe("last-hand replay (red river)", () => {
  it("names red river deals by round", () => {
    const deal: ReplayEvent = { kind: "deal", street: "extra", extraRound: 2, run: 1, board: 0, cards: ["4h"] };
    expect(eventText(deal, String, false, 2, true)).toBe("Red river 2 (Run 2, board 1): 4h");
    expect(eventText({ kind: "deal", street: "river", run: 0, board: 0, cards: ["4h"] }, String, false, 1, false)).toBe("River: 4h");
  });

  it("puts the 'No cards left' note just before the first showdown or win, only when red river stopped", () => {
    const frames = [
      frame([{ kind: "deal", street: "extra", extraRound: 3, run: 0, board: 0, cards: ["9d"] }], "extra", 3),
      frame([
        { kind: "action", seat: 1, type: "check", amount: 0 },
        { kind: "showdown", seat: 2, cards: ["As", "Ad"], labels: ["Pair"] },
        { kind: "win", seat: 2, amount: 400 },
      ]),
    ];
    expect(stopPoint(replay(frames, true))).toEqual({ frame: 1, event: 1 });
    expect(stopPoint(replay(frames, false))).toBeNull();
    // No showdown or win anywhere: at the very end.
    expect(stopPoint(replay(frames.slice(0, 1), true))).toEqual({ frame: 0, event: 1 });
  });
});
