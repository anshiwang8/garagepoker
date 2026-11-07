"use client";

import type { HighlightView, HistoryEntryView, TableView } from "@garagepoker/protocol";
import { Download, Image as ImageIcon } from "lucide-react";
import { useEffect } from "react";
import { formatChips } from "@/lib/chips";
import type { Send } from "@/lib/useTableSocket";
import { Button, Modal } from "../ui";
import { VARIANT_SHORT } from "./tableText";

/** Saves text as a file in the browser. */
export function downloadText(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const signed = (n: number, dc: boolean) => (n > 0 ? `+${formatChips(n, dc)}` : n < 0 ? `−${formatChips(-n, dc)}` : "0");
const netClass = (n: number) => (n > 0 ? "text-act-text" : n < 0 ? "text-danger-text" : "text-muted");

/**
 * The session's hands, newest first: tap one to replay it. Fetched when
 * shown and again after each hand. "Download" saves your permitted history
 * (your cards, and cards that were shown) as text.
 */
export function HandsPanel({ view, send, history }: { view: TableView; send: Send; history: HistoryEntryView[] | null }) {
  const lastHand = view.lastHand?.number ?? 0;
  useEffect(() => {
    send({ type: "getHistory" });
  }, [send, lastHand]);
  const dc = view.settings.displayCents;
  if (!history) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {history.length === 0 ? (
        <p className="text-sm text-muted">No finished hands yet.</p>
      ) : (
        <ol className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto" aria-label="Hands this session">
          {history.map((h) => (
            <li key={h.hand}>
              <button
                type="button"
                onClick={() => send({ type: "getReplay", hand: h.hand })}
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-white/5"
                aria-label={`Replay hand ${h.hand}`}
              >
                <span className="tabular w-10 shrink-0 text-muted">#{h.hand}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {h.winners.length ? `${h.winners.join(", ")} won ${formatChips(h.pot, dc)}` : `Pot ${formatChips(h.pot, dc)}`}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {VARIANT_SHORT[h.variant] ?? h.variant}
                    {h.best ? ` · ${h.best}` : ""}
                  </span>
                </span>
                {h.yourNet !== null && <span className={`tabular shrink-0 text-xs font-semibold ${netClass(h.yourNet)}`}>{signed(h.yourNet, dc)}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
      <Button className="min-h-11" disabled={history.length === 0} onClick={() => send({ type: "exportHistory" })}>
        <Download size={16} aria-hidden /> Download my hand history
      </Button>
      <p className="text-[11px] text-muted">Last 200 hands, this session only. Downloads include your cards and cards that were shown, nothing else.</p>
    </div>
  );
}

const STAT_HELP: [string, string][] = [
  ["VPIP", "how often they put chips in before the flop by choice (not blinds)"],
  ["PFR", "how often they raised before the flop"],
  ["SD", "hands that went to a showdown, and how many of those they won"],
  ["Won", "pots won, and the biggest one"],
];

/** Statistics for everyone dealt in this session, from public actions only. */
export function StatsPanel({ view, send, onRecap }: { view: TableView; send: Send; onRecap: () => void }) {
  const s = view.session;
  const dc = view.settings.displayCents;
  if (!s || s.hands === 0) return <p className="text-sm text-muted">Statistics appear after the first hand.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <p className="text-xs text-muted">{s.hands} hands this session</p>
      <div className="overflow-x-auto">
        <table className="tabular w-full text-xs">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 pr-2 font-medium">Player</th>
              <th className="px-1 font-medium" title="Hands dealt in">
                Hands
              </th>
              <th className="px-1 font-medium">VPIP</th>
              <th className="px-1 font-medium">PFR</th>
              <th className="px-1 font-medium">SD</th>
              <th className="px-1 font-medium">Won</th>
              <th className="pl-1 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {s.stats.map((r) => (
              <tr key={r.nickname} className="border-t border-white/5">
                <td className="max-w-24 truncate py-1.5 pr-2 font-semibold">{r.nickname}</td>
                <td className="px-1">{r.hands}</td>
                <td className="px-1">{r.vpip === null ? "–" : `${r.vpip}%`}</td>
                <td className="px-1">{r.pfr === null ? "–" : `${r.pfr}%`}</td>
                <td className="px-1">
                  {r.showdownWins}/{r.showdowns}
                </td>
                <td className="px-1" title={`Biggest pot ${formatChips(r.biggestPot, dc)}`}>
                  {r.potsWon}
                </td>
                <td className={`pl-1 text-right font-semibold ${netClass(r.net)}`}>{signed(r.net, dc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-muted">
        {STAT_HELP.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold text-white/70">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <Highlights highlights={s.highlights} dc={dc} send={send} />
      <Button className="min-h-11" onClick={onRecap}>
        Session recap
      </Button>
    </div>
  );
}

function Highlights({ highlights, dc, send }: { highlights: HighlightView[]; dc: boolean; send: Send }) {
  if (highlights.length === 0) return null;
  return (
    <section aria-label="Highlights">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Highlights</h3>
      <ul className="flex flex-col gap-1">
        {highlights.map((h) => (
          <li key={`${h.kind}-${h.hand}-${h.detail}`}>
            <button
              type="button"
              onClick={() => send({ type: "getReplay", hand: h.hand })}
              className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-white/5"
              aria-label={`${h.title}: ${h.detail}. Replay hand ${h.hand}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-gold">{h.title}</span>
                <span className="block truncate text-xs text-muted">
                  {h.detail} · hand #{h.hand}
                </span>
              </span>
              {h.amount !== null && <span className="tabular shrink-0 text-xs">{formatChips(h.amount, dc)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * End-of-session recap: results from the ledger, hands played and the
 * highlights. Downloadable as an image (drawn in the browser, nothing
 * uploaded) to share with the group.
 */
export function RecapDialog({ view, onClose }: { view: TableView; onClose: () => void }) {
  const dc = view.settings.displayCents;
  const s = view.session;
  const results = [...view.ledger].sort((a, b) => b.net - a.net);
  return (
    <Modal title="Session recap" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">
          {s?.hands ?? 0} hands · {VARIANT_SHORT[view.settings.variant]} {formatChips(view.settings.smallBlind, dc)}/
          {formatChips(view.settings.bigBlind, dc)}
        </p>
        <section aria-label="Results">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Results</h3>
          <ul className="flex flex-col divide-y divide-line/60">
            {results.map((r) => (
              <li key={r.playerId} className="flex justify-between py-1.5">
                <span className="font-semibold">{r.nickname}</span>
                <span className={`tabular font-semibold ${netClass(r.net)}`}>{signed(r.net, dc)}</span>
              </li>
            ))}
          </ul>
        </section>
        {s && s.highlights.length > 0 && (
          <section aria-label="Highlights">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Highlights</h3>
            <ul className="flex flex-col gap-1">
              {s.highlights.map((h) => (
                <li key={`${h.kind}-${h.hand}-${h.detail}`}>
                  <span className="font-semibold text-gold">{h.title}</span>
                  <span className="text-muted">
                    {" "}
                    · {h.detail}
                    {h.amount !== null ? ` · ${formatChips(h.amount, dc)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Button variant="primary" className="min-h-11" onClick={() => downloadRecapImage(view)}>
          <ImageIcon size={16} aria-hidden /> Download recap image
        </Button>
        <p className="text-xs text-muted">Play chips only. The image shows nicknames, results and highlights: share it with your group if you like.</p>
      </div>
    </Modal>
  );
}

/** Draws the recap on a canvas (1080×1350, a phone-friendly portrait) and saves it as a PNG. */
function downloadRecapImage(view: TableView) {
  const dc = view.settings.displayCents;
  const s = view.session;
  const results = [...view.ledger].sort((a, b) => b.net - a.net);
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const g = canvas.getContext("2d");
  if (!g) return;
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const gold = color("--color-gold", "#e9b949");
  const text = color("--color-text", "#e8efe9");
  const muted = color("--color-muted", "#93a59c");
  const win = color("--color-act-text", "#4ade80");
  const lose = color("--color-danger-text", "#f87171");

  const bg = g.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, "#0f3f28");
  bg.addColorStop(1, "#0b1210");
  g.fillStyle = bg;
  g.fillRect(0, 0, canvas.width, canvas.height);

  const font = (size: number, weight = 500) => `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  let y = 120;
  g.fillStyle = text;
  g.font = font(64, 800);
  g.fillText("Garage", 80, y);
  const w = g.measureText("Garage").width;
  g.fillStyle = gold;
  g.fillText("Poker", 80 + w, y);
  y += 60;
  g.fillStyle = muted;
  g.font = font(34);
  g.fillText(
    `Session recap · ${s?.hands ?? 0} hands · ${VARIANT_SHORT[view.settings.variant]} ${formatChips(view.settings.smallBlind, dc)}/${formatChips(view.settings.bigBlind, dc)}`,
    80,
    y,
  );

  y += 90;
  g.fillStyle = gold;
  g.font = font(30, 700);
  g.fillText("RESULTS", 80, y);
  y += 20;
  for (const r of results.slice(0, 9)) {
    y += 62;
    g.fillStyle = text;
    g.font = font(44, 600);
    g.fillText(r.nickname, 80, y);
    g.fillStyle = r.net > 0 ? win : r.net < 0 ? lose : muted;
    g.textAlign = "right";
    g.fillText(signed(r.net, dc), 1000, y);
    g.textAlign = "left";
  }

  const highlights = s?.highlights.slice(0, 4) ?? [];
  if (highlights.length) {
    y += 100;
    g.fillStyle = gold;
    g.font = font(30, 700);
    g.fillText("HIGHLIGHTS", 80, y);
    for (const h of highlights) {
      y += 70;
      g.fillStyle = text;
      g.font = font(36, 700);
      g.fillText(h.title, 80, y);
      g.fillStyle = muted;
      g.font = font(30);
      const line = `${h.detail}${h.amount !== null ? ` · ${formatChips(h.amount, dc)}` : ""}`;
      g.fillText(line.length > 52 ? `${line.slice(0, 51)}…` : line, 80, y + 40);
      y += 40;
    }
  }
  g.fillStyle = muted;
  g.font = font(26);
  g.fillText("Play chips only · garagepoker", 80, canvas.height - 70);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `garagepoker-recap-${view.tableId}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }, "image/png");
}
