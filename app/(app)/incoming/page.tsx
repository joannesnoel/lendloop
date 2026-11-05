"use client";

import { useMutation, useQuery } from "convex/react";
import { LoanCard, type Loan } from "@/components/loan-card";
import {
  Button,
  EmptyState,
  ErrorNote,
  LoadingList,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { useRun } from "@/lib/use-run";

export default function IncomingPage() {
  const loans = useQuery(api.loans.incoming);

  if (loans === undefined) {
    return (
      <>
        <Header />
        <LoadingList />
      </>
    );
  }

  const waiting = loans.filter((loan) => loan.status === "pending");
  const out = loans.filter((loan) => loan.status === "approved");
  const past = loans.filter(
    (loan) => loan.status !== "pending" && loan.status !== "approved",
  );

  return (
    <>
      <Header />
      {loans.length === 0 ? (
        <EmptyState
          title="No requests yet"
          body="When a neighbor asks to borrow one of your tools, it shows up here."
        />
      ) : (
        <div className="space-y-8">
          <Section title="Needs your answer" loans={waiting} />
          <Section title="Out on loan" loans={out} />
          <Section title="History" loans={past} />
        </div>
      )}
    </>
  );
}

function Header() {
  return (
    <PageHeader
      title="Incoming requests"
      description="Requests on your tools. Approve, decline, or confirm a return."
    />
  );
}

function Section({ title, loans }: { title: string; loans: Loan[] }) {
  if (loans.length === 0) return null;
  return (
    <section>
      <SectionTitle count={loans.length}>{title}</SectionTitle>
      <div className="space-y-3">
        {loans.map((loan) => (
          <IncomingCard key={loan._id} loan={loan} />
        ))}
      </div>
    </section>
  );
}

function IncomingCard({ loan }: { loan: Loan }) {
  const decide = useMutation(api.loans.decide);
  const markReturned = useMutation(api.loans.markReturned);
  const { run, pending, error } = useRun();

  return (
    <LoanCard
      loan={loan}
      view="lender"
      actions={
        loan.status === "pending" ? (
          <>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => decide({ loanId: loan._id, decision: "declined" }))}
            >
              Decline
            </Button>
            <Button
              disabled={pending}
              onClick={() => run(() => decide({ loanId: loan._id, decision: "approved" }))}
            >
              Approve
            </Button>
          </>
        ) : loan.status === "approved" ? (
          <Button
            disabled={pending}
            onClick={() => run(() => markReturned({ loanId: loan._id }))}
          >
            Mark as returned
          </Button>
        ) : null
      }
      error={
        error && (
          <div className="mt-3">
            <ErrorNote message={error} />
          </div>
        )
      }
    />
  );
}
