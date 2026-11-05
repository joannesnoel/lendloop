"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { LoanCard, type Loan } from "@/components/loan-card";
import {
  buttonClass,
  ConfirmButton,
  EmptyState,
  ErrorNote,
  LoadingList,
  PageHeader,
} from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { useRun } from "@/lib/use-run";

export default function RequestsPage() {
  const loans = useQuery(api.loans.myRequests);

  return (
    <>
      <PageHeader
        title="My requests"
        description="Tools you've asked to borrow, and what happened next."
      />
      {loans === undefined ? (
        <LoadingList />
      ) : loans.length === 0 ? (
        <EmptyState
          title="No requests yet"
          body="Find something on the board and ask to borrow it."
          action={
            <Link href="/board" className={buttonClass("primary")}>
              Browse the board
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {loans.map((loan) => (
            <RequestCard key={loan._id} loan={loan} />
          ))}
        </div>
      )}
    </>
  );
}

function RequestCard({ loan }: { loan: Loan }) {
  const cancel = useMutation(api.loans.cancel);
  const { run, pending, error } = useRun();

  return (
    <LoanCard
      loan={loan}
      view="borrower"
      actions={
        loan.status === "pending" && (
          <ConfirmButton
            label="Cancel request"
            confirmLabel="Confirm cancel"
            disabled={pending}
            onConfirm={() => run(() => cancel({ loanId: loan._id }))}
          />
        )
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
