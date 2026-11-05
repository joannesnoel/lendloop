import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { fail, getCurrentUser, requireAdmin } from "./lib/auth";
import { roleValidator } from "./lib/domain";

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Syncs the signed-in Clerk user into the `users` table. Called by the client
 * after sign-in. Takes no arguments: everything comes from the verified JWT,
 * so a caller cannot choose their own name, email, or role.
 */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("UNAUTHENTICATED", "Sign in to continue.");

    const email = identity.email?.toLowerCase();
    const name =
      identity.name ??
      identity.nickname ??
      identity.givenName ??
      email?.split("@")[0] ??
      "Neighbor";
    // Bootstrap admins from the ADMIN_EMAILS env var, but only for addresses
    // the identity provider has verified.
    const isBootstrapAdmin =
      email !== undefined &&
      identity.emailVerified === true &&
      adminEmails().includes(email);

    const existing = await getCurrentUser(ctx);
    if (existing) {
      const patch: { name?: string; email?: string; role?: "admin" } = {};
      if (existing.name !== name) patch.name = name;
      if (email !== undefined && existing.email !== email) patch.email = email;
      if (isBootstrapAdmin && existing.role !== "admin") patch.role = "admin";
      if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: isBootstrapAdmin ? "admin" : "user",
      trustedLender: false,
    });
  },
});

/** The current user's own profile, or null if signed out / not yet synced. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      trustedLender: user.trustedLender,
    };
  },
});

/** Admin: everyone on the board, with how many tools they list. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(200);
    return await Promise.all(
      users.map(async (user) => {
        const tools = await ctx.db
          .query("tools")
          .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
          .collect();
        return {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          trustedLender: user.trustedLender,
          listingCount: tools.filter((t) => t.removedAt === undefined).length,
        };
      }),
    );
  },
});

/** Admin: grant or revoke the "Trusted Lender" badge. */
export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) fail("NOT_FOUND", "User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/**
 * Promote or demote a user. Internal: only callable by someone with access to
 * the deployment, e.g.
 *   npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
 */
export const setRole = internalMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .first();
    if (!user) {
      throw new Error(`No user with email ${email}. They must sign in once first.`);
    }
    await ctx.db.patch(user._id, { role });
    return { userId: user._id, role };
  },
});
