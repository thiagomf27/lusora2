"use client";
/**
 * Design-system primitives — the five components the Claude Design bundle
 * exposes (Button, StatusBadge, TextInput, Dropdown) plus the switch every
 * screen in the mockup draws inline, as real React components.
 */
import { useEffect, useId, useRef, useState } from "react";
import s from "./ds.module.css";

export type Tone = "success" | "info" | "neutral" | "danger" | "warning";
export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "warning";
export type ButtonSize = "sm" | "md" | "lg";

const TONE_CLASS: Record<Tone, string> = {
  success: s.toneSuccess,
  info: s.toneInfo,
  neutral: s.toneNeutral,
  danger: s.toneDanger,
  warning: s.toneWarning,
};

export function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return <span className={`${s.badge} ${TONE_CLASS[tone] ?? s.toneNeutral}`}>{label}</span>;
}

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={[s.btn, s[size], s[variant], className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

export function TextInput({
  label,
  error,
  multiline = false,
  rows = 4,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> &
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label?: string;
    error?: string | null;
    multiline?: boolean;
  }) {
  const id = useId();
  const cls = [s.input, error ? s.invalid : null, className].filter(Boolean).join(" ");
  return (
    <div className={s.fieldWrap}>
      {label && (
        <label htmlFor={id} className={`${s.label}${rest.disabled ? " " + s.disabled : ""}`}>
          {label}
        </label>
      )}
      {multiline ? (
        <textarea id={id} rows={rows} className={cls} {...rest} />
      ) : (
        <input id={id} type="text" className={cls} {...rest} />
      )}
      {error && <div className={s.error}>{error}</div>}
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

/** Accepts plain strings (value === label) or {value,label} pairs. */
function normalize(options: (string | Option)[]): Option[] {
  return options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

export function Dropdown({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
  disabled = false,
  emptyNote = "Nothing to choose from.",
}: {
  label?: string;
  options: (string | Option)[];
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  emptyNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const opts = normalize(options);
  const current = opts.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className={s.fieldWrap}>
      {label && <div className={`${s.label}${disabled ? " " + s.disabled : ""}`}>{label}</div>}
      <div className={s.ddWrap} ref={ref}>
        <button
          type="button"
          className={s.ddTrigger}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={s.ddValue}>{current?.label ?? value ?? placeholder}</span>
          <svg
            className={`${s.ddChevron}${open ? " " + s.open : ""}`}
            width="14" height="14" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        {open && (
          <div className={s.ddMenu}>
            {opts.length === 0 && <div className={s.ddEmpty}>{emptyNote}</div>}
            {opts.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`${s.ddOption}${o.value === value ? " " + s.selected : ""}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      className={`${s.toggle}${checked ? " " + s.on : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className={s.knob} />
    </button>
  );
}
