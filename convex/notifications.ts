import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import type { LoanStatus, NotificationType } from "./lib/domain";
import { hmacSha256Hex, SIGNATURE_HEADER } from "./lib/signing";

// Convex -> n8n "request notification" webhook.
//
// Mutations never call n8n directly. They write an outbox row in the same
// transaction as the change and schedule `deliver`, so a notification exists
// if and only if the change committed, and a slow or failing n8n can never
// break a user action. Delivery is retried with backoff; the final outcome
// stays on the row so failures show up in the app instead of disappearing.

/** Delay before each retry. Initial attempt + these = 5 attempts in total. */
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000];
// Long enough for n8n to finish its own email retries before answering.
const REQUEST_TIMEOUT_MS = 30_000;

export async function enqueueNotification(
  ctx: MutationCtx,
  event: {
    loanId: Id<"loans">;
    type: NotificationType;
    recipientId: Id<"users">;
    actorId: Id<"users">;
  },
): Promise<Id<"notificationEvents">> {
  const eventId = await ctx.db.insert("notificationEvents", {
    ...event,
    status: "pending",
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId });
  return eventId;
}

/** What n8n receives. Deliberately only what the notification needs. */
type WebhookPayload = {
  eventId: Id<"notificationEvents">;
  type: NotificationType;
  recipient: { name: string; email: string };
  actorName: string;
  loan: {
    id: Id<"loans">;
    toolName: string;
    startDate: string;
    endDate: string;
    status: LoanStatus;
  };
};

type DeliveryJob =
  | { kind: "send"; payload: WebhookPayload }
  | { kind: "skip"; reason: string }
  | null;

export const loadForDelivery = internalQuery({
  args: { eventId: v.id("notificationEvents") },
  handler: async (ctx, { eventId }): Promise<DeliveryJob> => {
    const event = await ctx.db.get(eventId);
    // Nothing to do if it was already delivered (e.g. a duplicate schedule).
    if (!event || event.status !== "pending") return null;

    const loan = await ctx.db.get(event.loanId);
    const recipient = await ctx.db.get(event.recipientId);
    const actor = await ctx.db.get(event.actorId);
    const tool = loan ? await ctx.db.get(loan.toolId) : null;
    if (!loan || !tool || !recipient) {
      return { kind: "skip", reason: "Loan, tool, or recipient no longer exists." };
    }
    if (!recipient.email) {
      return { kind: "skip", reason: "Recipient has no email address." };
    }

    return {
      kind: "send",
      payload: {
        eventId,
        type: event.type,
        recipient: { name: recipient.name, email: recipient.email },
        actorName: actor?.name ?? "A neighbor",
        loan: {
          id: loan._id,
          toolName: tool.name,
          startDate: loan.startDate,
          endDate: loan.endDate,
          status: loan.status,
        },
      },
    };
  },
});

export const recordResult = internalMutation({
  args: {
    eventId: v.id("notificationEvents"),
    outcome: v.union(
      v.literal("delivered"),
      v.literal("skipped"),
      v.literal("error"),
    ),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, outcome, detail }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending") return;

    if (outcome === "delivered") {
      await ctx.db.patch(eventId, {
        status: "delivered",
        attempts: event.attempts + 1,
        deliveredAt: Date.now(),
        lastError: undefined,
      });
      return;
    }
    if (outcome === "skipped") {
      await ctx.db.patch(eventId, { status: "skipped", lastError: detail });
      return;
    }

    const attempts = event.attempts + 1;
    const retryDelay = RETRY_DELAYS_MS[attempts - 1];
    if (retryDelay === undefined) {
      // Out of retries: leave a visible failure for the admin view.
      await ctx.db.patch(eventId, { status: "failed", attempts, lastError: detail });
      console.error(`Notification ${eventId} failed permanently: ${detail}`);
      return;
    }
    await ctx.db.patch(eventId, { attempts, lastError: detail });
    await ctx.scheduler.runAfter(retryDelay, internal.notifications.deliver, {
      eventId,
    });
  },
});

export const deliver = internalAction({
  args: { eventId: v.id("notificationEvents") },
  handler: async (ctx, { eventId }): Promise<null> => {
    const job: DeliveryJob = await ctx.runQuery(
      internal.notifications.loadForDelivery,
      { eventId },
    );
    if (job === null) return null;

    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_WEBHOOK_SECRET;
    if (job.kind === "skip" || !url || !secret) {
      await ctx.runMutation(internal.notifications.recordResult, {
        eventId,
        outcome: "skipped",
        detail:
          job.kind === "skip"
            ? job.reason
            : "N8N_WEBHOOK_URL or LENDLOOP_WEBHOOK_SECRET is not set.",
      });
      return null;
    }

    // `sentAt` is inside the signed body so the receiver can reject replays.
    const body = JSON.stringify({ ...job.payload, sentAt: Date.now() });
    const signature = await hmacSha256Hex(secret, body);

    let failure: string | null = null;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SIGNATURE_HEADER]: `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) failure = `n8n responded with HTTP ${response.status}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    await ctx.runMutation(internal.notifications.recordResult, {
      eventId,
      outcome: failure === null ? "delivered" : "error",
      detail: failure ?? undefined,
    });
    return null;
  },
});
