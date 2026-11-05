"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { CATEGORIES, categoryLabel } from "@/convex/lib/domain";
import { Badge, buttonClass } from "./ui";

/** "Sign in to lend or borrow", or a link into the app once signed in. */
export function LandingCta({ large = false }: { large?: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (isLoaded && isSignedIn) {
    return (
      <Link href="/board" className={buttonClass("primary", large)}>
        Open the board
      </Link>
    );
  }
  return (
    <SignInButton mode="modal" forceRedirectUrl="/board">
      <button type="button" className={buttonClass("primary", large)}>
        Sign in to lend or borrow
      </button>
    </SignInButton>
  );
}

/**
 * Read-only list of available tools for visitors. The query behind it returns
 * only a name and category, so there is nothing else to leak here.
 */
export function PublicToolList() {
  const tools = useQuery(api.tools.listPublic);

  if (tools === undefined) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-xl border border-line bg-surface"
          />
        ))}
      </div>
    );
  }

  if (tools.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
        Nothing is listed yet. Sign in and be the first neighbor to lend a tool.
      </p>
    );
  }

  // Group by category, in the same order the categories are defined.
  const groups = CATEGORIES.map((category) => ({
    category: category.value,
    tools: tools.filter((tool) => tool.category === category.value),
  })).filter((group) => group.tools.length > 0);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.category}>
          <h3 className="mb-2 text-sm font-medium text-muted">
            {categoryLabel(group.category)}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.tools.map((tool) => (
              <li
                key={tool._id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3"
              >
                <span className="truncate font-medium">{tool.name}</span>
                <Badge tone="good">Available</Badge>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
