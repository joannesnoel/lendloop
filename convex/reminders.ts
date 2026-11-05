import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { daysBetween, isIsoDate, reminderStatusValidator } from "./lib/domain";

// Backing functions for the n8n "overdue reminders" workflow. They are
// internal: the only way in from outside is the signed HTTP endpoints in
// http.ts.

export function reminderKey(loanId: string, reminderDate: string): string {
  return `${loanId}:${reminderDate}`;
}

/**
 * Approved loans whose end date has passed and that have not been reminded
 * successfully today. Leaving out already-reminded loans makes the whole
 * workflow safe to re-run: a second run the same day sends nothing twice.
 */
export const overdue = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) =>
        q.eq("status", "approved").lt("endDate", today),
      )
      .take(500);

    const due = [];
    for (const loan of loans) {
      const idempotencyKey = reminderKey(loan._id, today);
      const existing = await ctx.db
        .query("reminders")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();
      if (existing?.status === "sent") continue;

      const borrower = await ctx.db.get(loan.borrowerId);
      const tool = await ctx.db.get(loan.toolId);
      // Without an address there is nobody to remind.
      if (!borrower?.email || !tool) continue;

      due.push({
        loanId: loan._id,
        reminderDate: today,
        toolName: tool.name,
        dueDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
        borrower: { name: borrower.name, email: borrower.email },
      });
    }
    return due;
  },
});

/**
 * Idempotent write-back of a reminder's outcome. Keyed on loan + date, so a
 * retried request finds the existing row instead of inserting another. Convex
 * mutations are serializable transactions, so two concurrent retries cannot
 * both insert. A "sent" reminder is final; "failed" may later become "sent".
 */
export const record = internalMutation({
  args: {
    loanId: v.string(),
    reminderDate: v.string(),
    status: reminderStatusValidator,
    channel: v.string(),
    error: v.optional(v.string()),
    executionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loanId = ctx.db.normalizeId("loans", args.loanId);
    const loan = loanId ? await ctx.db.get(loanId) : null;
    if (!loanId || !loan) {
      return { ok: false as const, reason: "Unknown loan." };
    }
    if (!isIsoDate(args.reminderDate)) {
      return { ok: false as const, reason: "reminderDate must be YYYY-MM-DD." };
    }

    const idempotencyKey = reminderKey(loanId, args.reminderDate);
    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();

    if (existing) {
      if (existing.status === "failed" && args.status === "sent") {
        await ctx.db.patch(existing._id, {
          status: "sent",
          channel: args.channel,
          error: undefined,
          executionId: args.executionId,
          updatedAt: Date.now(),
        });
        return { ok: true as const, created: false, status: "sent" as const };
      }
      return { ok: true as const, created: false, status: existing.status };
    }

    await ctx.db.insert("reminders", {
      idempotencyKey,
      loanId,
      reminderDate: args.reminderDate,
      status: args.status,
      channel: args.channel,
      error: args.error,
      executionId: args.executionId,
      updatedAt: Date.now(),
    });
    return { ok: true as const, created: true, status: args.status };
  },
});
