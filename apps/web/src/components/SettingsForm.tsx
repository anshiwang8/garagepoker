"use client";

import {
  BOMB_POT_MODES,
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

export function SettingsForm({
  initial,
  submitLabel,
  onSubmit,
  busy = false,
  highestOccupiedSeat = 0,
  footer,
}: {
  initial: TableSettings;
  submitLabel: string;
  onSubmit: (settings: TableSettings) => void;
  busy?: boolean;
  /** Seat counts below this are greyed out: someone is sitting there. */
  highestOccupiedSeat?: number;
  footer?: React.ReactNode;
}) {
  const [s, setS] = useState<TableSettings>(initial);
  const [texts, setTexts] = useState<Record<ChipField, string>>({
    smallBlind: chipsToInput(initial.smallBlind),
    bigBlind: chipsToInput(initial.bigBlind),
    ante: chipsToInput(initial.ante),
  });
  const [badText, setBadText] = useState<Partial<Record<ChipField, boolean>>>({});

  const set = <K extends keyof TableSettings>(key: K, value: TableSettings[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const issues: ConfigIssue[] = useMemo(() => validateConfig(s), [s]);
  const issue = (field: keyof TableSettings) => issues.find((i) => i.field === field)?.message;
  const invalid = issues.length > 0 || Object.values(badText).some(Boolean);

  const chipField = (field: ChipField, label: string) => (
    <Field label={label} error={badText[field] ? "Enter an amount like 10 or 0.50" : issue(field)}>
      <ChipInput
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-40 ${
                  active ? "border-gold bg-gold/10" : "border-line bg-ink hover:border-muted"
                }`}
              >
                <div className="text-sm font-semibold">{VARIANT_LABELS[v].name}</div>
                <div className="text-xs text-muted">{reason ?? VARIANT_LABELS[v].detail}</div>
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
                className={`rounded-lg border py-2 text-sm tabular disabled:opacity-30 disabled:line-through ${
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
        <Toggle label="UTG straddle (2 BB)" checked={s.straddle} onChange={(v) => set("straddle", v)} hint="Never heads-up" />
        <Toggle label="Auto-start next hand" checked={s.autoStart} onChange={(v) => set("autoStart", v)} hint="3 s to show results" />
        <Toggle label="Allow rebuys" checked={s.rebuys} onChange={(v) => set("rebuys", v)} hint="Through your approval" />
        <Toggle label="Display cents" checked={s.displayCents} onChange={(v) => set("displayCents", v)} hint="Only changes how amounts are shown" />
      </div>

      {issues.length > 0 && (
        <ul className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {issues.map((i) => (
            <li key={`${i.field}-${i.message}`}>{i.message}</li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" className="flex-1 py-3 text-base" disabled={invalid || busy}>
          {busy ? "Working…" : submitLabel}
        </Button>
      </div>
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
          className={`rounded-lg border px-2 py-2 text-sm disabled:opacity-35 disabled:line-through ${
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
