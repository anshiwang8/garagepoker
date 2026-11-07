"use client";

import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from "react";
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

/** Open modals, innermost last: only the top one answers Escape. */
const modalStack: symbol[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet on phones, centered dialog on larger screens. Keyboard focus
 * moves into it and stays there (Tab wraps), returns to where it was on
 * close, and Escape closes only the topmost dialog.
 */
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
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const me = Symbol(title);
    modalStack.push(me);
    const returnTo = document.activeElement as HTMLElement | null;
    const el = panel.current;
    // Focus an autofocused field if there is one, else the dialog itself.
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== me) return;
      if (e.key === "Escape" && close.current) {
        e.stopPropagation();
        close.current();
      } else if (e.key === "Tab" && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      modalStack.splice(modalStack.indexOf(me), 1);
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [title]);

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} max-h-sheet overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-panel border border-line shadow-2xl safe-bottom outline-none`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-panel py-1.5 pl-4 pr-1.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-panel-2 hover:text-text"
              aria-label="Close"
            >
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
      {error ? <span className="text-xs text-danger-text">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
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
  centMode,
  placeholder,
  className = "",
  autoFocus,
  ariaLabel,
}: {
  text: string;
  onText: (text: string, amount: number | null) => void;
  /** Cent mode on: decimals allowed and multiplied by 100. Off: whole numbers. */
  centMode: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  return (
    <input
      inputMode={centMode ? "decimal" : "numeric"}
      autoComplete="off"
      className={`${inputClass} ${className}`}
      value={text}
      placeholder={placeholder}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      onChange={(e) => onText(e.target.value, parseChips(e.target.value, centMode))}
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
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] ${checked ? "bg-gold" : "bg-line"}`}
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

/**
 * Copies text. The Clipboard API needs a secure context (https or localhost);
 * elsewhere (e.g. a LAN address) fall back to a hidden textarea.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** "Copy link" for the table URL; shows "Copied" briefly. */
export function CopyLinkButton() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      variant="primary"
      className="mt-1 px-5 py-2.5"
      onClick={async () => {
        setState((await copyText(window.location.href)) ? "copied" : "failed");
        setTimeout(() => setState("idle"), 1_500);
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy: use the address bar" : "Copy link"}
    </Button>
  );
}
