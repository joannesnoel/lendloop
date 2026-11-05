import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  categoryValidator,
  conditionValidator,
  deliveryStatusValidator,
  loanStatusValidator,
  notificationTypeValidator,
  reminderStatusValidator,
  roleValidator,
  toolStatusValidator,
} from "./lib/domain";

export default defineSchema({
  users: defineTable({
    // Clerk identity (`issuer|subject`). The only link to the auth provider.
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    // Authorization lives here, never in client-controlled state.
    role: roleValidator,
    trustedLender: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    status: toolStatusValidator,
    // Listings are soft-deleted so loan history keeps a valid reference.
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_removed_category", ["removedAt", "category"])
    .index("by_removed_status", ["removedAt", "status"]),

  // A borrow request and, once approved, the loan it turns into.
  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD, inclusive
    message: v.optional(v.string()),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_tool_status", ["toolId", "status"])
    .index("by_status_endDate", ["status", "endDate"]),

  // Outbox for the n8n "request notification" webhook. One row per event, so
  // delivery can be retried and its outcome shown in the app.
  notificationEvents: defineTable({
    loanId: v.id("loans"),
    type: notificationTypeValidator,
    recipientId: v.id("users"),
    actorId: v.id("users"),
    status: deliveryStatusValidator,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_loan", ["loanId"])
    .index("by_status", ["status"]),

  // Overdue reminders written back by n8n. `idempotencyKey` is
  // `${loanId}:${reminderDate}`: at most one row per loan per day.
  reminders: defineTable({
    idempotencyKey: v.string(),
    loanId: v.id("loans"),
    reminderDate: v.string(), // YYYY-MM-DD
    status: reminderStatusValidator,
    channel: v.string(),
    error: v.optional(v.string()),
    executionId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  // Failed n8n executions reported by the error workflow.
  automationErrors: defineTable({
    executionId: v.string(),
    workflowName: v.string(),
    nodeName: v.optional(v.string()),
    message: v.string(),
    executionUrl: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
  }).index("by_execution", ["executionId"]),
});
