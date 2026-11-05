"use client";

import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import type { api } from "@/convex/_generated/api";
import type { LoanStatus } from "@/convex/lib/domain";
import { formatDay, formatRange, localToday } from "@/lib/format";
import { Badge, Card, TimeAgo, TrustedBadge } from "./ui";

export type Loan = FunctionReturnType<typeof api.loans.myRequests>[number];

const STATUS: Record<LoanStatus, { label: string; tone: "neutral" | "good" | "warn" | "danger" }> = {
  pending: { label: "Awaiting reply", tone: "warn" },
  approved: { label: "On loan", tone: "good" },
  declined: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  returned: { label: "Returned", tone: "neutral" },
};

export function isOverdue(loan: Pick<Loan, "status" | "endDate">): boolean {
  return loan.status === "approved" && loan.endDate < localToday();
}

export function LoanStatusBadge({ loan }: { loan: Pick<Loan, "status" | "endDate"> }) {
  if (isOverdue(loan)) {
    return <Badge tone="danger">Overdue since {formatDay(loan.endDate)}</Badge>;
  }
  const { label, tone } = STATUS[loan.status];
  return <Badge tone={tone}>{label}</Badge>;
}

const DOT = {
  ok: "bg-accent",
  pending: "bg-muted/50",
  problem: "bg-danger",
};

/** Recent automation activity on a loan, e.g. "Overdue reminder sent 2 days ago". */
export function ActivityList({ activity }: { activity: Loan["activity"] }) {
  if (activity.length === 0) return null;
  return (
    <ul className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs text-muted">
      {activity.map((item) => (
        <li key={item.id} className="flex items-center gap-2">
          <span className={`size-1.5 shrink-0 rounded-full ${DOT[item.tone]}`} />
          <span>
            {item.label} <TimeAgo at={item.at} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One request or loan. `view` decides whose name is shown: a borrower sees the
 * lender, a lender sees the borrower, an admin sees both.
 */
export function LoanCard({
  loan,
  view,
  actions,
  error,
}: {
  loan: Loan;
  view: "borrower" | "lender" | "admin";
  actions?: ReactNode;
  error?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{loan.toolName}</h3>
            <LoanStatusBadge loan={loan} />
            {loan.toolRemoved && <Badge>Listing removed</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>{formatRange(loan.startDate, loan.endDate)}</span>
            <span aria-hidden="true">·</span>
            {view === "borrower" && <span>from {loan.ownerName}</span>}
            {view === "lender" && <span>requested by {loan.borrowerName}</span>}
            {view === "admin" && (
              <span>
                {loan.ownerName} → {loan.borrowerName}
              </span>
            )}
            {view === "borrower" && loan.ownerTrusted && <TrustedBadge />}
          </p>
          {loan.message && (
            <p className="mt-2 text-sm">&ldquo;{loan.message}&rdquo;</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      {error}
      <ActivityList activity={loan.activity} />
    </Card>
  );
}
