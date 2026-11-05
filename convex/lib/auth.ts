import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Every public function that touches private data goes through these helpers.
// The UI hides what a user cannot do, but this is where it is enforced.

type Ctx = QueryCtx | MutationCtx;

export function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/** The signed-in user's record, or null when signed out or not yet synced. */
export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("UNAUTHENTICATED", "Sign in to continue.");
  const user = await getCurrentUser(ctx);
  if (!user) fail("UNAUTHENTICATED", "Your account is still being set up.");
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") fail("FORBIDDEN", "Admins only.");
  return user;
}

export function isAdmin(user: Doc<"users">): boolean {
  return user.role === "admin";
}
