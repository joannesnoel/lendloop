import { v, type Infer } from "convex/values";

// Shared domain vocabulary. Imported by Convex functions and by the UI, so the
// form options and the server-side validators can never drift apart.

export const CATEGORIES = [
  { value: "power_tools", label: "Power tools" },
  { value: "hand_tools", label: "Hand tools" },
  { value: "garden", label: "Garden" },
  { value: "kitchen", label: "Kitchen" },
  { value: "camping", label: "Camping" },
  { value: "cleaning", label: "Cleaning" },
  { value: "automotive", label: "Automotive" },
  { value: "other", label: "Other" },
] as const;

export const CONDITIONS = [
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "well_loved", label: "Well loved" },
] as const;

export const categoryValidator = v.union(
  v.literal("power_tools"),
  v.literal("hand_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("cleaning"),
  v.literal("automotive"),
  v.literal("other"),
);

export const conditionValidator = v.union(
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("well_loved"),
);

export const roleValidator = v.union(v.literal("admin"), v.literal("user"));

export const toolStatusValidator = v.union(
  v.literal("available"),
  v.literal("on_loan"),
);

export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export const notificationTypeValidator = v.union(
  v.literal("request.created"),
  v.literal("request.approved"),
  v.literal("request.declined"),
  v.literal("request.cancelled"),
  v.literal("loan.returned"),
);

export const deliveryStatusValidator = v.union(
  v.literal("pending"),
  v.literal("delivered"),
  v.literal("failed"),
  v.literal("skipped"),
);

export const reminderStatusValidator = v.union(
  v.literal("sent"),
  v.literal("failed"),
);

export type Category = Infer<typeof categoryValidator>;
export type Condition = Infer<typeof conditionValidator>;
export type Role = Infer<typeof roleValidator>;
export type ToolStatus = Infer<typeof toolStatusValidator>;
export type LoanStatus = Infer<typeof loanStatusValidator>;
export type NotificationType = Infer<typeof notificationTypeValidator>;
export type DeliveryStatus = Infer<typeof deliveryStatusValidator>;
export type ReminderStatus = Infer<typeof reminderStatusValidator>;

export function categoryLabel(value: Category): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function conditionLabel(value: Condition): string {
  return CONDITIONS.find((c) => c.value === value)?.label ?? value;
}

export const LIMITS = {
  toolNameMin: 2,
  toolNameMax: 80,
  descriptionMax: 280,
  messageMax: 280,
  maxLoanDays: 30,
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && toIsoDate(parsed) === value;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms =
    new Date(`${to}T00:00:00Z`).getTime() -
    new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}
