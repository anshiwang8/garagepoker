"use client";

import {
  BOMB_POT_MODES,
  RUN_IT_TWICE_MODES,
  type RunItTwiceMode,
  type BombPotMode,
  type ConfigIssue,
  MAX_BOMB_POT_ANTE_BB,
  MAX_SEATS,
  MIN_SEATS,
  type TableSettings,
  validateConfig,
  VARIANT_NAMES,
  type VariantName,
} from "@garagepoker/engine";
import { useMemo, useState } from "react";
import { chipsToInput } from "@/lib/chips";
import { Button, ChipInput, Field, inputClass, Toggle } from "./ui";

export const VARIANT_LABELS: Record<VariantName, { name: string; detail: string }> = {
  NLH: { name: "No-limit Hold'em", detail: "2 cards, no limit" },
  PLO: { name: "Pot-limit Omaha", detail: "4 cards, use exactly 2" },
  PLO5: { name: "5-card PLO", detail: "5 cards, use exactly 2" },
  PLOHL: { name: "PLO Hi/Lo", detail: "4 cards, split 8-or-better" },
  PLO5HL: { name: "PLO5 Hi/Lo", detail: "5 cards, split 8-or-better" },
  PINEAPPLE: { name: "Pineapple (5-card)", detail: "Discard 1 preflop, flop, turn" },
  SHORT: { name: "Short deck", detail: "36 cards; flush beats a full house" },
  TICTACTOE: { name: "Tic-Tac-Toe Hold'em", detail: "3×3 board; both cards + a line" },
};

const DECISION_TIMES = [10, 15, 20, 30, 45, 60, 90];
const TIME_BANKS = [0, 30, 60, 120, 180];
type ChipField = "smallBlind" | "bigBlind" | "ante";

/** Why a candidate value can't be chosen, from validateConfig; undefined if it can. */
/**
 * Why a candidate value can't be chosen, from validateConfig; undefined if it
 * can. Deck-math issues name every setting involved, so the right option greys out.
 */
function reasonFor(candidate: TableSettings, field: keyof TableSettings): string | undefined {
  return validateConfig(candidate).find((i) => i.related.includes(field))?.message;
}

const BOMB_POT_LABELS: Record<BombPotMode, string> = { off: "Off", everyHand: "Every hand", everyN: "Every N hands" };
const RIT_LABELS: Record<RunItTwiceMode, string> = { no: "No", ask: "Ask", always: "Always" };

export function SettingsForm({
  initial,
  submitLabel,
  onSubmit,
  busy = false,
  highestOccupiedSeat = 0,
  footer,
  sectionsOpen = false,
  extraActions,
}: {
  initial: TableSettings;
  submitLabel: string;
  onSubmit: (settings: TableSettings) => void;
  busy?: boolean;
  /** Seat counts below this are greyed out: someone is sitting there. */
  highestOccupiedSeat?: number;
  footer?: React.ReactNode;
  /** Start with the advanced sections expanded (the owner menu); creating a table keeps them folded. */
  sectionsOpen?: boolean;
  /** More buttons beside Submit, given the settings as they stand (e.g. Save as preset). */
  extraActions?: (settings: TableSettings, invalid: boolean) => React.ReactNode;
}) {
  const [s, setS] = useState<TableSettings>(initial);
  const textsFor = (v: TableSettings): Record<ChipField, string> => ({
    smallBlind: chipsToInput(v.smallBlind, v.displayCents),
    bigBlind: chipsToInput(v.bigBlind, v.displayCents),
    ante: chipsToInput(v.ante, v.displayCents),
  });
  const [texts, setTexts] = useState<Record<ChipField, string>>(() => textsFor(initial));
  const [badText, setBadText] = useState<Partial<Record<ChipField, boolean>>>({});

  const set = <K extends keyof TableSettings>(key: K, value: TableSettings[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const issues: ConfigIssue[] = useMemo(() => validateConfig(s), [s]);
  const issue = (field: keyof TableSettings) => issues.find((i) => i.field === field)?.message;
  const invalid = issues.length > 0 || Object.values(badText).some(Boolean);

  const chipField = (field: ChipField, label: string) => (
    <Field
      label={label}
      error={badText[field] ? (s.displayCents ? "Enter an amount like 10 or 0.50" : "Enter a whole number") : issue(field)}
    >
      <ChipInput
        centMode={s.displayCents}
        text={texts[field]}
        ariaLabel={label}
        onText={(text, cents) => {
          setTexts((t) => ({ ...t, [field]: text }));
          setBadText((b) => ({ ...b, [field]: cents === null }));
          if (cents !== null) set(field, cents);
        }}
      />
    </Field>
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) onSubmit(s);
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Game</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {VARIANT_NAMES.map((v) => {
            const reason = reasonFor({ ...s, variant: v }, "variant");
            const active = s.variant === v;
            return (
              <button
                key={v}
                type="button"
                disabled={!!reason}
                title={reason}
                onClick={() => set("variant", v)}
                aria-pressed={active}
                className={`min-h-11 rounded-xl border px-2.5 py-2 text-left transition-colors disabled:opacity-40 ${
                  active ? "border-gold bg-gold/10" : "border-line bg-ink hover:border-muted"
                }`}
              >
                <div className="text-sm font-semibold leading-tight">{VARIANT_LABELS[v].name}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-muted">{reason ?? VARIANT_LABELS[v].detail}</div>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-3 gap-3">
        {chipField("smallBlind", "Small blind")}
        {chipField("bigBlind", "Big blind")}
        {chipField("ante", "Ante")}
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Seats</legend>
        <div className="grid grid-cols-8 gap-1.5">
          {Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => i + MIN_SEATS).map((n) => {
            const reason =
              n < highestOccupiedSeat ? `Seat ${highestOccupiedSeat} is occupied` : reasonFor({ ...s, seats: n }, "seats");
            return (
              <button
                key={n}
                type="button"
                disabled={!!reason}
                title={reason}
                aria-label={reason ? `${n} seats: ${reason}` : `${n} seats`}
                onClick={() => set("seats", n)}
                className={`min-h-11 rounded-lg border text-sm tabular disabled:opacity-30 disabled:line-through ${
                  s.seats === n ? "border-gold bg-gold/15 font-semibold" : "border-line bg-ink"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
        <SeatReasons settings={s} highestOccupiedSeat={highestOccupiedSeat} />
      </fieldset>

      <Section
        title="Table options"
        summary={tableOptionsSummary(s)}
        open={sectionsOpen}
      >
        <fieldset>
          <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Boards</legend>
          <Segmented
            value={s.boards}
            onChange={(v) => set("boards", v)}
            options={([1, 2] as const).map((b) => ({
              value: b,
              label: b === 1 ? "1 board" : "2 boards",
              reason: reasonFor({ ...s, boards: b }, "boards"),
            }))}
          />
          <p className="mt-1.5 text-xs text-muted">
            {reasonFor({ ...s, boards: 2 }, "boards") ?? "With 2 boards, each board takes half of every pot."}
          </p>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Bomb pots</legend>
          <Segmented
            value={s.bombPotMode}
            onChange={(v) => set("bombPotMode", v)}
            options={BOMB_POT_MODES.map((m) => ({ value: m, label: BOMB_POT_LABELS[m] }))}
          />
          {s.bombPotMode !== "off" && (
            <div className="grid grid-cols-2 gap-3">
              {s.bombPotMode === "everyN" ? (
                <Field label="Every" error={issue("bombPotEvery")}>
                  <div className="flex items-center gap-2">
                    <input
                      className={inputClass}
                      inputMode="numeric"
                      aria-label="Bomb pot every N hands"
                      value={Number.isNaN(s.bombPotEvery) ? "" : s.bombPotEvery}
                      onChange={(e) => set("bombPotEvery", e.target.value === "" ? Number.NaN : Math.trunc(Number(e.target.value)))}
                    />
                    <span className="text-sm text-muted">hands</span>
                  </div>
                </Field>
              ) : (
                <div />
              )}
              <Field label="Ante" hint="Everyone who isn't away">
                <select className={inputClass} value={s.bombPotAnteBB} onChange={(e) => set("bombPotAnteBB", Number(e.target.value))}>
                  {Array.from({ length: MAX_BOMB_POT_ANTE_BB }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n} BB
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          {s.bombPotMode !== "off" && (
            <p className="text-xs text-muted">No preflop betting: action starts on the flop. Straddle is off in bomb pots.</p>
          )}
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Run it twice</legend>
          <Segmented
            value={s.runItTwice}
            onChange={(v) => set("runItTwice", v)}
            options={RUN_IT_TWICE_MODES.map((m) => ({
              value: m,
              label: RIT_LABELS[m],
              reason: m === "no" ? undefined : reasonFor({ ...s, runItTwice: m }, "runItTwice"),
            }))}
          />
          <p className="mt-1.5 text-xs text-muted">
            {reasonFor({ ...s, runItTwice: "ask" }, "runItTwice") ??
              "When everyone left is all-in: each run takes half of every pot. “Ask” needs everyone in the pot to agree within 5 s."}
          </p>
        </fieldset>
        <div className="flex flex-col divide-y divide-line rounded-xl border border-line bg-ink px-3">
          <Toggle label="UTG straddle (2 BB)" checked={s.straddle} onChange={(v) => set("straddle", v)} hint="Never heads-up" />
          <Toggle
            label="Show hands when all in"
            checked={s.revealAllIn}
            onChange={(v) => set("revealAllIn", v)}
            hint="Once nobody can bet, every live hand is shown before the rest is dealt"
          />
          <Toggle
            label="Rabbit hunt"
            checked={s.rabbitHunt}
            onChange={(v) => set("rabbitHunt", v)}
            hint="After a hand ends early, show what would have come"
          />
        </div>
      </Section>

      <Section title="Timers" summary={timersSummary(s)} open={sectionsOpen}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Decision time">
            <select className={inputClass} value={s.decisionTimeSec} onChange={(e) => set("decisionTimeSec", Number(e.target.value))}>
              {DECISION_TIMES.map((t) => (
                <option key={t} value={t}>
                  {t} s
                </option>
              ))}
            </select>
          </Field>
          <Field label="Time bank">
            <select className={inputClass} value={s.timeBankSec} onChange={(e) => set("timeBankSec", Number(e.target.value))}>
              {TIME_BANKS.map((t) => (
                <option key={t} value={t}>
                  {t === 0 ? "None" : `${t} s`}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-col divide-y divide-line rounded-xl border border-line bg-ink px-3">
          <Toggle label="Auto-start next hand" checked={s.autoStart} onChange={(v) => set("autoStart", v)} hint="3 s to show results" />
        </div>
      </Section>

      <Section title="House rules" summary={houseRulesSummary(s)} open={sectionsOpen}>
        <Field
          label="7-2 bounty"
          hint="Win a pot with 7-2 offsuit and show it: everyone else dealt in pays you. 2-card games with a full deck only."
          error={issue("sevenDeuceBB")}
        >
          <select className={inputClass} value={s.sevenDeuceBB} onChange={(e) => set("sevenDeuceBB", Number(e.target.value))}>
            {[0, 1, 2, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Off" : `${n} BB from each player`}
              </option>
            ))}
          </select>
        </Field>
        <fieldset>
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Mixed games</legend>
          <p className="mb-2 text-xs text-muted">
            Pick two or more to rotate, one orbit each, in the order you pick them. The table&apos;s game changes as it goes.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {VARIANT_NAMES.map((v) => {
              const at = s.mixedGames.indexOf(v);
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={at >= 0}
                  onClick={() =>
                    set("mixedGames", at >= 0 ? s.mixedGames.filter((x) => x !== v) : [...s.mixedGames, v])
                  }
                  className={`min-h-11 rounded-full border px-3 text-sm ${at >= 0 ? "border-gold bg-gold/15 font-semibold" : "border-line bg-ink"}`}
                >
                  {at >= 0 && <span className="tabular mr-1 text-gold">{at + 1}.</span>}
                  {VARIANT_LABELS[v].name}
                </button>
              );
            })}
          </div>
          {issue("mixedGames") && <p className="mt-1.5 text-xs text-danger-text">{issue("mixedGames")}</p>}
        </fieldset>
      </Section>

      <Section title="Players and display" summary={playersSummary(s)} open={sectionsOpen}>
        <div className="flex flex-col divide-y divide-line rounded-xl border border-line bg-ink px-3">
          <Toggle
            label="Spectators"
            checked={s.spectators}
            onChange={(v) => set("spectators", v)}
            hint="Anyone with the link can watch without a seat"
          />
          <Toggle label="Chat" checked={s.chat} onChange={(v) => set("chat", v)} hint="Table chat for players (and spectators)" />
          <Toggle label="Allow rebuys" checked={s.rebuys} onChange={(v) => set("rebuys", v)} hint="Through your approval" />
          <Toggle
            label="Cent mode"
            checked={s.displayCents}
            onChange={(v) => {
              // Stored amounts don't change; re-show them in the new mode.
              const next = { ...s, displayCents: v };
              setS(next);
              setTexts(textsFor(next));
              setBadText({});
            }}
            hint={s.displayCents ? "Amounts show as 19.80; type decimals like 0.50" : "Amounts show as whole numbers like 1980"}
          />
        </div>
      </Section>

      {issues.length > 0 && (
        <ul className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {issues.map((i) => (
            <li key={`${i.field}-${i.message}`}>{i.message}</li>
          ))}
        </ul>
      )}

      {/* The submit row stays in reach at the bottom of the screen, however long the form gets. */}
      <div className="sticky bottom-0 z-10 -mx-4 flex items-center gap-3 border-t border-line bg-panel px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <Button type="submit" variant="primary" className="min-h-12 flex-1 py-3 text-base" disabled={invalid || busy}>
          {busy ? "Working…" : submitLabel}
        </Button>
      </div>
      {extraActions?.(s, invalid)}
      {footer}
    </form>
  );
}

/** A row of options; greyed-out options show their reason in place of a label. */
function Segmented<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; reason?: string }[];
}) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          disabled={!!o.reason}
          title={o.reason}
          aria-label={o.reason ? `${o.label}: ${o.reason}` : o.label}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-11 rounded-lg border px-2 py-1.5 text-sm disabled:opacity-35 disabled:line-through ${
            value === o.value ? "border-gold bg-gold/15 font-semibold" : "border-line bg-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Lists why any seat counts are greyed out, so phones (no hover) see the reason. */
function SeatReasons({ settings, highestOccupiedSeat }: { settings: TableSettings; highestOccupiedSeat: number }) {
  const reasons = new Set<string>();
  for (let n = MIN_SEATS; n <= MAX_SEATS; n++) {
    if (n < highestOccupiedSeat) reasons.add(`Fewer than ${highestOccupiedSeat} seats: seat ${highestOccupiedSeat} is occupied`);
    const r = reasonFor({ ...settings, seats: n }, "seats");
    if (r && !r.startsWith("Seats must be")) reasons.add(r);
  }
  if (reasons.size === 0) return null;
  return (
    <ul className="mt-2 text-xs text-muted">
      {[...reasons].map((r) => (
        <li key={r}>• {r}</li>
      ))}
    </ul>
  );
}

/**
 * A collapsible group of advanced settings: a header with a one-line summary
 * of what's set, so nothing hides silently.
 */
function Section({ title, summary, open, children }: { title: string; summary: string; open: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border border-line bg-ink/40 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">{title}</span>
          <span className="truncate text-xs text-muted">{summary}</span>
        </span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-5 border-t border-line px-3 pb-4 pt-4">{children}</div>
    </details>
  );
}

const onOff = (b: boolean) => (b ? "on" : "off");

function houseRulesSummary(s: TableSettings): string {
  const parts = [
    s.sevenDeuceBB > 0 ? `7-2 bounty ${s.sevenDeuceBB} BB` : "no 7-2 bounty",
    s.mixedGames.length >= 2 ? `mixed: ${s.mixedGames.map((v) => VARIANT_LABELS[v].name).join(" → ")}` : "one game",
  ];
  return parts.join(" · ");
}

function tableOptionsSummary(s: TableSettings): string {
  const bomb = s.bombPotMode === "off" ? "no bomb pots" : s.bombPotMode === "everyHand" ? "bomb pot every hand" : `bomb pot every ${s.bombPotEvery}`;
  return [
    s.boards === 2 ? "2 boards" : "1 board",
    bomb,
    `run it twice: ${RIT_LABELS[s.runItTwice].toLowerCase()}`,
    s.straddle && "straddle",
    s.rabbitHunt && "rabbit hunt",
  ]
    .filter(Boolean)
    .join(" · ");
}

function timersSummary(s: TableSettings): string {
  return `${s.decisionTimeSec} s to act · ${s.timeBankSec ? `${s.timeBankSec} s bank` : "no bank"} · auto-start ${onOff(s.autoStart)}`;
}

function playersSummary(s: TableSettings): string {
  return `spectators ${onOff(s.spectators)} · chat ${onOff(s.chat)} · rebuys ${onOff(s.rebuys)} · cent mode ${onOff(s.displayCents)}`;
}
