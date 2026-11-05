import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { fail, requireAdmin } from "./lib/auth";

// Admin visibility into the n8n integration: webhook deliveries that did not
// go through and n8n executions reported by the error workflow.

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const problems = [
      ...(await ctx.db
        .query("notificationEvents")
        .withIndex("by_status", (q) => q.eq("status", "failed"))
        .order("desc")
        .take(25)),
      ...(await ctx.db
        .query("notificationEvents")
        .withIndex("by_status", (q) => q.eq("status", "skipped"))
        .order("desc")
        .take(25)),
    ].sort((a, b) => b._creationTime - a._creationTime);

    const notifications = await Promise.all(
      problems.map(async (event) => {
        const loan = await ctx.db.get(event.loanId);
        const tool = loan ? await ctx.db.get(loan.toolId) : null;
        return {
          _id: event._id,
          _creationTime: event._creationTime,
          type: event.type,
          status: event.status,
          attempts: event.attempts,
          lastError: event.lastError,
          toolName: tool?.name ?? "Removed listing",
        };
      }),
    );

    const errors = (
      await ctx.db.query("automationErrors").order("desc").take(50)
    )
      .filter((error) => error.resolvedAt === undefined)
      .map((error) => ({
        _id: error._id,
        _creationTime: error._creationTime,
        workflowName: error.workflowName,
        nodeName: error.nodeName,
        message: error.message,
        executionUrl: error.executionUrl,
      }));

    return { notifications, errors };
  },
});

/** Admin: put a failed or skipped notification back in the delivery queue. */
export const retryNotification = mutation({
  args: { eventId: v.id("notificationEvents") },
  handler: async (ctx, { eventId }) => {
    await requireAdmin(ctx);
    const event = await ctx.db.get(eventId);
    if (!event) fail("NOT_FOUND", "Notification not found.");
    if (event.status !== "failed" && event.status !== "skipped") {
      fail("CONFLICT", "Only failed or skipped notifications can be retried.");
    }
    await ctx.db.patch(eventId, {
      status: "pending",
      attempts: 0,
      lastError: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId });
  },
});

/** Admin: acknowledge a reported workflow failure. */
export const resolveError = mutation({
  args: { errorId: v.id("automationErrors") },
  handler: async (ctx, { errorId }) => {
    await requireAdmin(ctx);
    const error = await ctx.db.get(errorId);
    if (!error) fail("NOT_FOUND", "Error report not found.");
    await ctx.db.patch(errorId, { resolvedAt: Date.now() });
  },
});

/** Idempotent on executionId: n8n retrying its report stores it only once. */
export const recordError = internalMutation({
  args: {
    executionId: v.string(),
    workflowName: v.string(),
    nodeName: v.optional(v.string()),
    message: v.string(),
    executionUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationErrors")
      .withIndex("by_execution", (q) => q.eq("executionId", args.executionId))
      .unique();
    if (existing) return { created: false };
    await ctx.db.insert("automationErrors", args);
    return { created: true };
  },
});
