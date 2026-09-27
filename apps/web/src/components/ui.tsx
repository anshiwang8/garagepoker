"use client";

import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useState } from "react";
import { chipsToInput, parseChips } from "@/lib/chips";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-gold text-ink hover:bg-gold/90 font-semibold",
  secondary: "bg-panel-2 text-text border border-line hover:bg-line",
  danger: "bg-danger/90 text-white hover:bg-danger font-semibold",
  ghost: "text-muted hover:text-text hover:bg-panel-2",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors disabled:opacity-40 disabled:pointer-events-none ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

/** Bottom sheet on phones, centered dialog on larger screens. */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} max-h-sheet overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-panel border border-line shadow-2xl safe-bottom`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-panel px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          {onClose && (
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-muted hover:text-text" aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-ink px-3 py-2 text-text outline-none focus:border-gold tabular disabled:opacity-40";

/**
 * A chip amount field. Keeps the typed text; reports cents (or null while
 * the text isn't a valid amount).
 */
export function ChipInput({
  text,
  onText,
  placeholder,
  className = "",
  autoFocus,
  ariaLabel,
}: {
  text: string;
  onText: (text: string, cents: number | null) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  return (
    <input
      inputMode="decimal"
      autoComplete="off"
      className={`${inputClass} ${className}`}
      value={text}
      placeholder={placeholder}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      onChange={(e) => onText(e.target.value, parseChips(e.target.value))}
    />
  );
}

export { chipsToInput };

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabledReason,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  /** When set, the toggle is greyed out and shows why. */
  disabledReason?: string;
}) {
  const id = useId();
  const disabled = !!disabledReason;
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${disabled ? "opacity-50" : ""}`} title={disabledReason}>
      <label htmlFor={id} className="flex flex-col">
        <span className="text-sm">{label}</span>
        {(disabledReason ?? hint) && <span className="text-xs text-muted">{disabledReason ?? hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-gold" : "bg-line"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

/** A button that needs a second tap, instead of a blocking confirm() dialog. */
export function ConfirmButton({ label, confirm, onConfirm, variant = "danger" }: { label: string; confirm: string; onConfirm: () => void; variant?: "danger" | "secondary" }) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      variant={armed ? "danger" : variant === "danger" ? "secondary" : variant}
      onClick={() => {
        if (armed) onConfirm();
        setArmed(!armed);
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirm : label}
    </Button>
  );
}
