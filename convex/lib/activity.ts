import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { NotificationType } from "./domain";

// Recent automation activity for a loan: webhook notifications sent through
// n8n and overdue reminders n8n wrote back.

export type ActivityItem = {
  id: string;
  kind: "notification" | "reminder";
  label: string;
  tone: "ok" | "pending" | "problem";
  at: number;
};

const NOTIFICATION_NAMES: Record<NotificationType, string> = {
  "request.created": "New request notification",
  "request.approved": "Approval notification",
  "request.declined": "Decline notification",
  "request.cancelled": "Cancellation notification",
  "loan.returned": "Return confirmation",
};

function describeNotification(event: Doc<"notificationEvents">): ActivityItem {
  const name = NOTIFICATION_NAMES[event.type];
  const base = { id: event._id, kind: "notification" as const };
  switch (event.status) {
    case "delivered":
      return {
        ...base,
        label: `${name} sent`,
        tone: "ok",
        at: event.deliveredAt ?? event._creationTime,
      };
    case "pending":
      return {
        ...base,
        label: event.attempts > 0 ? `${name} retrying` : `${name} queued`,
        tone: "pending",
        at: event._creationTime,
      };
    case "skipped":
      return {
        ...base,
        label: `${name} skipped`,
        tone: "pending",
        at: event._creationTime,
      };
    case "failed":
      return {
        ...base,
        label: `${name} failed`,
        tone: "problem",
        at: event._creationTime,
      };
  }
}

function describeReminder(reminder: Doc<"reminders">): ActivityItem {
  return {
    id: reminder._id,
    kind: "reminder",
    label:
      reminder.status === "sent"
        ? "Overdue reminder sent"
        : "Overdue reminder failed",
    tone: reminder.status === "sent" ? "ok" : "problem",
    at: reminder.updatedAt,
  };
}

export async function loanActivity(
  ctx: QueryCtx,
  loanId: Id<"loans">,
  limit = 4,
): Promise<ActivityItem[]> {
  const events = await ctx.db
    .query("notificationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .order("desc")
    .take(limit);
  const reminders = await ctx.db
    .query("reminders")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .order("desc")
    .take(limit);
  return [
    ...events.map(describeNotification),
    ...reminders.map(describeReminder),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
