/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

// Every Convex module, loaded lazily by convex-test.
const modules = import.meta.glob([
  "./**/*.{ts,js}",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
]);

export function setup() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof setup>;

/** Signs a user in and syncs them into the `users` table, as the app does. */
export async function signIn(
  t: T,
  name: string,
  options: { email?: string; emailVerified?: boolean } = {},
) {
  const email = options.email ?? `${name.toLowerCase()}@example.com`;
  const as = t.withIdentity({
    name,
    email,
    emailVerified: options.emailVerified ?? true,
    subject: `user_${name.toLowerCase()}`,
    issuer: "https://clerk.test",
    tokenIdentifier: `https://clerk.test|user_${name.toLowerCase()}`,
  });
  const userId = await as.mutation(api.users.ensure, {});
  return { as, userId, email };
}

export const drill = {
  name: "Cordless drill",
  category: "power_tools" as const,
  condition: "good" as const,
  description: "18V, two batteries.",
};

/** A date `offset` days from today, as YYYY-MM-DD (UTC). */
export function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}
