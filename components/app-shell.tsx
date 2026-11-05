"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { Logo } from "./logo";
import { Badge, buttonClass } from "./ui";

const TRAY = "M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14";
const ICONS = {
  board: "M4.5 3.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Zm10 0h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Zm-10 10h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Zm10 0h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Z",
  listings: "M3.5 12.4V5A1.5 1.5 0 0 1 5 3.5h7.4a1.5 1.5 0 0 1 1.06.44l6.6 6.6a1.5 1.5 0 0 1 0 2.12l-7.4 7.4a1.5 1.5 0 0 1-2.12 0l-6.6-6.6a1.5 1.5 0 0 1-.44-1.06ZM8 8h.01",
  requests: `M12 15V4m0 0L8 8m4-4 4 4${TRAY}`,
  incoming: `M12 4v11m0 0-4-4m4 4 4-4${TRAY}`,
  admin: "M12 3.5 5 6.2v5.3c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6.2L12 3.5Zm-2.8 8.6 2 2 3.6-3.8",
};

type NavLink = { href: string; label: string; short: string; icon: keyof typeof ICONS };

// `short` is the label under the icon in the phone tab bar.
const NAV: NavLink[] = [
  { href: "/board", label: "Board", short: "Board", icon: "board" },
  { href: "/listings", label: "My listings", short: "Listings", icon: "listings" },
  { href: "/requests", label: "My requests", short: "Requests", icon: "requests" },
  { href: "/incoming", label: "Incoming", short: "Incoming", icon: "incoming" },
];
const ADMIN_LINK: NavLink = { href: "/admin", label: "Admin", short: "Admin", icon: "admin" };

/**
 * Frame for the signed-in pages. Waits for Convex to accept the Clerk session
 * and for the user's record to exist before showing anything, so pages inside
 * can assume a ready, authenticated user.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensure);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const [syncFailed, setSyncFailed] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    ensureUser().catch(() => setSyncFailed(true));
  }, [isAuthenticated, ensureUser]);

  let content: ReactNode;
  if (isLoading || (isAuthenticated && !me && !syncFailed)) {
    content = <p className="py-24 text-center text-sm text-muted">Loading…</p>;
  } else if (!isAuthenticated || !me) {
    content = <SignedOutNotice />;
  } else {
    content = children;
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Logo href="/board" />
          <div className="flex items-center gap-3">
            {me?.trustedLender && <Badge tone="good">Trusted Lender</Badge>}
            {me?.role === "admin" && <Badge>Admin</Badge>}
            <UserButton />
          </div>
        </div>
        {me && <Nav isAdmin={me.role === "admin"} />}
      </header>
      {/* Extra room at the bottom on phones, where the tab bar sits. */}
      <main
        className={`mx-auto w-full max-w-5xl flex-1 px-6 pt-8 ${me ? "pb-28 sm:pb-8" : "pb-8"}`}
      >
        {content}
      </main>
    </div>
  );
}

/** Tabs under the header on wider screens, a fixed tab bar on phones. */
function Nav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const incoming = useQuery(api.loans.incoming);
  const waiting = incoming?.filter((loan) => loan.status === "pending").length ?? 0;
  const links = isAdmin ? [...NAV, ADMIN_LINK] : NAV;

  return (
    <>
      <nav className="mx-auto hidden max-w-5xl gap-1 px-4 sm:flex" aria-label="Main">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "border-accent text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {link.label}
              {link.href === "/incoming" && waiting > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-xs text-white">
                  {waiting}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
        aria-label="Main"
      >
        <div className="mx-auto flex max-w-md">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 border-t-2 text-[11px] font-medium transition-colors ${
                  active ? "border-accent text-accent" : "border-transparent text-muted"
                }`}
              >
                <span className="relative">
                  <svg
                    viewBox="0 0 24 24"
                    className="size-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d={ICONS[link.icon]} />
                  </svg>
                  {link.href === "/incoming" && waiting > 0 && (
                    <span className="absolute -right-2.5 -top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 text-white">
                      {waiting}
                      <span className="sr-only"> waiting for your answer</span>
                    </span>
                  )}
                </span>
                {link.short}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function SignedOutNotice() {
  const { isSignedIn } = useAuth();

  // Clerk has a session but Convex rejected its token: a setup problem, and
  // far easier to fix when the page says so.
  if (isSignedIn) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-xl font-semibold">Almost there</h1>
        <p className="mt-2 text-sm text-muted">
          You&rsquo;re signed in, but the backend didn&rsquo;t accept your session.
          Check that the Convex integration is enabled in Clerk and that{" "}
          <code className="font-mono text-xs">CLERK_JWT_ISSUER_DOMAIN</code> is set
          on your Convex deployment.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-xl font-semibold">Sign in to continue</h1>
      <p className="mt-2 text-sm text-muted">
        The tool board is for signed-in neighbors.
      </p>
      <div className="mt-6">
        <SignInButton mode="modal">
          <button type="button" className={buttonClass("primary")}>
            Sign in to lend or borrow
          </button>
        </SignInButton>
      </div>
    </div>
  );
}
