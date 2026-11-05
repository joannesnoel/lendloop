import { auth } from "@clerk/nextjs/server";
import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={<p className="py-24 text-center text-sm text-muted">Loading…</p>}
    >
      <SignedInOnly>{children}</SignedInOnly>
    </Suspense>
  );
}

/** Sends signed-out visitors to sign in before any app page renders. */
async function SignedInOnly({ children }: { children: ReactNode }) {
  await auth.protect();
  return <AppShell>{children}</AppShell>;
}
