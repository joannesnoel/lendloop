import { ConvexError } from "convex/values";

const dayFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Nov 5" for a YYYY-MM-DD date. */
export function formatDay(iso: string): string {
  return dayFormat.format(new Date(`${iso}T00:00:00Z`));
}

export function formatRange(start: string, end: string): string {
  return start === end
    ? formatDay(start)
    : `${formatDay(start)} – ${formatDay(end)}`;
}

/** Today in the viewer's own time zone, as YYYY-MM-DD. */
export function localToday(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "2 days ago", "5 minutes ago", "just now". */
export function timeAgo(timestamp: number, now: number): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86_400), "day");
}

/** The message a Convex function failed with, safe to show to the user. */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | string;
    if (typeof data === "string") return data;
    if (typeof data?.message === "string") return data.message;
  }
  return "Something went wrong. Please try again.";
}
