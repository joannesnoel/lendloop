"use client";

import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { timeAgo } from "@/lib/format";

// Small shared building blocks so every screen looks and behaves the same.

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong",
  secondary: "border border-line bg-surface text-ink hover:border-ink/30",
  ghost: "text-muted hover:bg-ink/5 hover:text-ink",
  danger: "border border-danger/30 bg-surface text-danger hover:bg-danger-soft",
};

export function buttonClass(variant: ButtonVariant = "primary", large = false) {
  return [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50",
    large ? "h-11 px-5 text-base" : "h-9 px-3.5 text-sm",
    BUTTON_STYLES[variant],
  ].join(" ");
}

export function Button({
  variant = "primary",
  large = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`${buttonClass(variant, large)} ${className}`}
    />
  );
}

/** A destructive button that asks once more before it acts. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      variant={armed ? "danger" : "ghost"}
      disabled={disabled}
      onClick={() => {
        if (armed) onConfirm();
        setArmed(!armed);
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

type Tone = "neutral" | "good" | "warn" | "danger";

const BADGE_STYLES: Record<Tone, string> = {
  neutral: "bg-ink/5 text-muted",
  good: "bg-accent-soft text-accent-strong",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

export function TrustedBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium text-accent-strong"
      title="Marked as a Trusted Lender by a LendLoop admin"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 1.5 2.5 3.5v4c0 3 2.2 5.4 5.5 7 3.3-1.6 5.5-4 5.5-7v-4L8 1.5Z" />
        <path d="m5.8 8 1.6 1.6 2.9-3.2" />
      </svg>
      Trusted Lender
    </span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-line bg-surface p-5 ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function SectionTitle({
  children,
  count,
}: {
  children: ReactNode;
  count?: number;
}) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
      {children}
      {count !== undefined && (
        <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium normal-case tracking-normal">
          {count}
        </span>
      )}
    </h2>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function LoadingList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-24 animate-pulse rounded-xl border border-line bg-surface"
        />
      ))}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-sm font-medium">
        {label}
        {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** "2 days ago", kept fresh while the page stays open. */
export function TimeAgo({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>
      {timeAgo(at, now)}
    </time>
  );
}
