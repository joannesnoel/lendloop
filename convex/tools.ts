import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { fail, isAdmin, requireUser } from "./lib/auth";
import {
  categoryValidator,
  conditionValidator,
  LIMITS,
} from "./lib/domain";
import { enqueueNotification } from "./notifications";

const toolFields = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

function cleanToolInput(input: { name: string; description: string }) {
  const name = input.name.trim();
  const description = input.description.trim();
  if (name.length < LIMITS.toolNameMin || name.length > LIMITS.toolNameMax) {
    fail(
      "INVALID",
      `Name must be ${LIMITS.toolNameMin}–${LIMITS.toolNameMax} characters.`,
    );
  }
  if (description.length > LIMITS.descriptionMax) {
    fail(
      "INVALID",
      `Description must be ${LIMITS.descriptionMax} characters or fewer.`,
    );
  }
  return { name, description };
}

/**
 * Public, unauthenticated list for the landing page. Returns only the name and
 * category of available tools: no owner, no description, no loan details.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_removed_status", (q) =>
        q.eq("removedAt", undefined).eq("status", "available"),
      )
      .order("desc")
      .take(60);
    return tools.map((tool) => ({
      _id: tool._id,
      name: tool.name,
      category: tool.category,
    }));
  },
});

/** Signed-in board: every active listing with its availability. */
export const list = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const me = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_removed_category", (q) =>
        category === undefined
          ? q.eq("removedAt", undefined)
          : q.eq("removedAt", undefined).eq("category", category),
      )
      .order("desc")
      .take(200);

    return await Promise.all(
      tools.map(async (tool) => {
        const owner = await ctx.db.get(tool.ownerId);
        const activeLoan =
          tool.status === "on_loan"
            ? await ctx.db
                .query("loans")
                .withIndex("by_tool_status", (q) =>
                  q.eq("toolId", tool._id).eq("status", "approved"),
                )
                .first()
            : null;
        const pending = await ctx.db
          .query("loans")
          .withIndex("by_tool_status", (q) =>
            q.eq("toolId", tool._id).eq("status", "pending"),
          )
          .collect();
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          status: tool.status,
          dueDate: activeLoan?.endDate ?? null,
          // Neighbors see a display name and badge, never contact details.
          ownerName: owner?.name ?? "Neighbor",
          ownerTrusted: owner?.trustedLender ?? false,
          isMine: tool.ownerId === me._id,
          iRequested: pending.some((loan) => loan.borrowerId === me._id),
        };
      }),
    );
  },
});

/** The current user's own listings. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
    return tools
      .filter((tool) => tool.removedAt === undefined)
      .map((tool) => ({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        status: tool.status,
      }));
  },
});

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const { name, description } = cleanToolInput(args);
    return await ctx.db.insert("tools", {
      ownerId: me._id,
      name,
      description,
      category: args.category,
      condition: args.condition,
      status: "available",
    });
  },
});

/** Owner only. Admins can remove a listing but not rewrite someone else's. */
export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const me = await requireUser(ctx);
    const tool = await loadActiveTool(ctx, toolId);
    if (tool.ownerId !== me._id) {
      fail("FORBIDDEN", "You can only edit your own listings.");
    }
    const { name, description } = cleanToolInput(args);
    await ctx.db.patch(toolId, {
      name,
      description,
      category: args.category,
      condition: args.condition,
    });
  },
});

/**
 * Owner or admin. Soft-deletes the listing and declines any requests still
 * waiting on it. A loan already in progress stays open until it is returned.
 */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await loadActiveTool(ctx, toolId);
    if (tool.ownerId !== me._id && !isAdmin(me)) {
      fail("FORBIDDEN", "You can only remove your own listings.");
    }

    await ctx.db.patch(toolId, { removedAt: Date.now(), removedBy: me._id });

    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) =>
        q.eq("toolId", toolId).eq("status", "pending"),
      )
      .collect();
    for (const loan of pending) {
      await ctx.db.patch(loan._id, { status: "declined", decidedAt: Date.now() });
      await enqueueNotification(ctx, {
        loanId: loan._id,
        type: "request.declined",
        recipientId: loan.borrowerId,
        actorId: me._id,
      });
    }
  },
});

async function loadActiveTool(
  ctx: MutationCtx,
  toolId: Id<"tools">,
): Promise<Doc<"tools">> {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.removedAt !== undefined) {
    fail("NOT_FOUND", "Listing not found.");
  }
  return tool;
}
