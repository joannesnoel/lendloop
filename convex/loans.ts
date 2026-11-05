import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { loanActivity } from "./lib/activity";
import { fail, requireAdmin, requireUser } from "./lib/auth";
import { daysBetween, isIsoDate, LIMITS, toIsoDate } from "./lib/domain";
import { enqueueNotification } from "./notifications";

// Borrow requests and the loans they become.
//
// Who may do what (enforced here, mirrored in the UI):
//   borrower  create a request, cancel it while pending
//   lender    approve / decline requests on their own tools, mark returned
//   admin     read every loan (no extra write access)

/** A loan as shown in lists, with names resolved and automation activity. */
async function present(ctx: QueryCtx, loan: Doc<"loans">) {
  const [tool, owner, borrower, activity] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.ownerId),
    ctx.db.get(loan.borrowerId),
    loanActivity(ctx, loan._id),
  ]);
  return {
    _id: loan._id,
    _creationTime: loan._creationTime,
    toolName: tool?.name ?? "Removed listing",
    toolRemoved: !tool || tool.removedAt !== undefined,
    ownerName: owner?.name ?? "Neighbor",
    ownerTrusted: owner?.trustedLender ?? false,
    borrowerName: borrower?.name ?? "Neighbor",
    startDate: loan.startDate,
    endDate: loan.endDate,
    message: loan.message,
    status: loan.status,
    returnedAt: loan.returnedAt,
    activity,
  };
}

/** Requests the current user has made to borrow other people's tools. */
export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((loan) => present(ctx, loan)));
  },
});

/** Requests other people have made on the current user's tools. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((loan) => present(ctx, loan)));
  },
});

/** Admin: every request and loan on the board. */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(200);
    return await Promise.all(loans.map((loan) => present(ctx, loan)));
  },
});

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);

    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.removedAt !== undefined) {
      fail("NOT_FOUND", "Listing not found.");
    }
    if (tool.ownerId === me._id) {
      fail("INVALID", "You can't borrow your own tool.");
    }
    if (tool.status !== "available") {
      fail("CONFLICT", "This tool is currently on loan.");
    }

    if (!isIsoDate(args.startDate) || !isIsoDate(args.endDate)) {
      fail("INVALID", "Pick a valid start and end date.");
    }
    if (args.endDate < args.startDate) {
      fail("INVALID", "The end date can't be before the start date.");
    }
    // Compare against yesterday (UTC) so a borrower west of UTC can still
    // pick their local "today".
    const yesterday = toIsoDate(new Date(Date.now() - 86_400_000));
    if (args.startDate < yesterday) {
      fail("INVALID", "The start date can't be in the past.");
    }
    if (daysBetween(args.startDate, args.endDate) + 1 > LIMITS.maxLoanDays) {
      fail("INVALID", `Loans are limited to ${LIMITS.maxLoanDays} days.`);
    }

    const message = args.message?.trim() || undefined;
    if (message && message.length > LIMITS.messageMax) {
      fail("INVALID", `Keep the note under ${LIMITS.messageMax} characters.`);
    }

    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) =>
        q.eq("toolId", tool._id).eq("status", "pending"),
      )
      .collect();
    if (pending.some((loan) => loan.borrowerId === me._id)) {
      fail("CONFLICT", "You already have a pending request for this tool.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: me._id,
      startDate: args.startDate,
      endDate: args.endDate,
      message,
      status: "pending",
    });
    await enqueueNotification(ctx, {
      loanId,
      type: "request.created",
      recipientId: tool.ownerId,
      actorId: me._id,
    });
    return loanId;
  },
});

/** Lender approves or declines a pending request on one of their tools. */
export const decide = mutation({
  args: {
    loanId: v.id("loans"),
    decision: v.union(v.literal("approved"), v.literal("declined")),
  },
  handler: async (ctx, { loanId, decision }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) fail("NOT_FOUND", "Request not found.");
    if (loan.ownerId !== me._id) {
      fail("FORBIDDEN", "Only the tool's owner can respond to this request.");
    }
    if (loan.status !== "pending") {
      fail("CONFLICT", "This request has already been handled.");
    }

    if (decision === "approved") {
      const tool = await ctx.db.get(loan.toolId);
      if (!tool || tool.removedAt !== undefined) {
        fail("CONFLICT", "This listing has been removed.");
      }
      if (tool.status !== "available") {
        fail("CONFLICT", "This tool is already on loan.");
      }
      await ctx.db.patch(tool._id, { status: "on_loan" });
    }

    await ctx.db.patch(loanId, { status: decision, decidedAt: Date.now() });
    await enqueueNotification(ctx, {
      loanId,
      type: decision === "approved" ? "request.approved" : "request.declined",
      recipientId: loan.borrowerId,
      actorId: me._id,
    });
  },
});

/** Borrower withdraws their own request while it is still pending. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) fail("NOT_FOUND", "Request not found.");
    if (loan.borrowerId !== me._id) {
      fail("FORBIDDEN", "You can only cancel your own requests.");
    }
    if (loan.status !== "pending") {
      fail("CONFLICT", "Only pending requests can be cancelled.");
    }
    await ctx.db.patch(loanId, { status: "cancelled", decidedAt: Date.now() });
    await enqueueNotification(ctx, {
      loanId,
      type: "request.cancelled",
      recipientId: loan.ownerId,
      actorId: me._id,
    });
  },
});

/** Lender confirms the tool is back, which makes it available again. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) fail("NOT_FOUND", "Loan not found.");
    if (loan.ownerId !== me._id) {
      fail("FORBIDDEN", "Only the tool's owner can mark it as returned.");
    }
    if (loan.status !== "approved") {
      fail("CONFLICT", "Only an active loan can be marked as returned.");
    }
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await ctx.db.patch(loan.toolId, { status: "available" });
    await enqueueNotification(ctx, {
      loanId,
      type: "loan.returned",
      recipientId: loan.borrowerId,
      actorId: me._id,
    });
  },
});
