"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { LoanCard } from "@/components/loan-card";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorNote,
  LoadingList,
  PageHeader,
  SectionTitle,
  TimeAgo,
} from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { categoryLabel } from "@/convex/lib/domain";
import { useRun } from "@/lib/use-run";

export default function AdminPage() {
  const me = useQuery(api.users.me);

  if (me === undefined) return <LoadingList />;
  // The queries below reject non-admins on the server; this just avoids
  // calling them when the answer is already known.
  if (me?.role !== "admin") {
    return (
      <EmptyState
        title="Admins only"
        body="You don't have access to this page."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Admin"
        description="Every loan, listing, and member on the board."
      />
      <div className="space-y-10">
        <AutomationSection />
        <LoansSection />
        <ListingsSection />
        <MembersSection />
      </div>
    </>
  );
}

type Overview = FunctionReturnType<typeof api.automation.overview>;

function AutomationSection() {
  const overview = useQuery(api.automation.overview);
  if (overview === undefined) return null;
  const issues = overview.notifications.length + overview.errors.length;

  return (
    <section>
      <SectionTitle count={issues}>Automation issues</SectionTitle>
      {issues === 0 ? (
        <Card className="text-sm text-muted">
          All clear. No failed notifications or workflow runs.
        </Card>
      ) : (
        <div className="space-y-3">
          {overview.errors.map((error) => (
            <WorkflowErrorRow key={error._id} error={error} />
          ))}
          {overview.notifications.map((notification) => (
            <NotificationRow key={notification._id} notification={notification} />
          ))}
        </div>
      )}
    </section>
  );
}

function WorkflowErrorRow({ error }: { error: Overview["errors"][number] }) {
  const resolve = useMutation(api.automation.resolveError);
  const { run, pending, error: failure } = useRun();

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{error.workflowName}</h3>
            <Badge tone="danger">Workflow failed</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {error.nodeName && <>{error.nodeName} · </>}
            <TimeAgo at={error._creationTime} />
          </p>
          <p className="mt-2 break-words font-mono text-xs">{error.message}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {error.executionUrl && (
            <a
              href={error.executionUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-muted hover:bg-ink/5 hover:text-ink"
            >
              Open in n8n
            </a>
          )}
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => resolve({ errorId: error._id }))}
          >
            Mark resolved
          </Button>
        </div>
      </div>
      <ErrorNote message={failure} />
    </Card>
  );
}

function NotificationRow({
  notification,
}: {
  notification: Overview["notifications"][number];
}) {
  const retry = useMutation(api.automation.retryNotification);
  const { run, pending, error } = useRun();
  const failed = notification.status === "failed";

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{notification.toolName}</h3>
            <Badge tone={failed ? "danger" : "warn"}>
              Notification {failed ? "failed" : "skipped"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            <span className="font-mono text-xs">{notification.type}</span> ·{" "}
            {failed && <>{notification.attempts} attempts · </>}
            <TimeAgo at={notification._creationTime} />
          </p>
          {notification.lastError && (
            <p className="mt-2 break-words font-mono text-xs">{notification.lastError}</p>
          )}
        </div>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => retry({ eventId: notification._id }))}
        >
          Retry
        </Button>
      </div>
      <ErrorNote message={error} />
    </Card>
  );
}

function LoansSection() {
  const loans = useQuery(api.loans.listAll);

  return (
    <section>
      <SectionTitle count={loans?.length}>All loans</SectionTitle>
      {loans === undefined ? (
        <LoadingList rows={2} />
      ) : loans.length === 0 ? (
        <Card className="text-sm text-muted">No requests have been made yet.</Card>
      ) : (
        <div className="space-y-3">
          {loans.map((loan) => (
            <LoanCard key={loan._id} loan={loan} view="admin" />
          ))}
        </div>
      )}
    </section>
  );
}

type Tool = FunctionReturnType<typeof api.tools.list>[number];

function ListingsSection() {
  const tools = useQuery(api.tools.list, {});

  return (
    <section>
      <SectionTitle count={tools?.length}>All listings</SectionTitle>
      {tools === undefined ? (
        <LoadingList rows={2} />
      ) : tools.length === 0 ? (
        <Card className="text-sm text-muted">Nothing is listed yet.</Card>
      ) : (
        <Card className="divide-y divide-line py-0">
          {tools.map((tool) => (
            <ListingRow key={tool._id} tool={tool} />
          ))}
        </Card>
      )}
    </section>
  );
}

function ListingRow({ tool }: { tool: Tool }) {
  const remove = useMutation(api.tools.remove);
  const { run, pending, error } = useRun();

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{tool.name}</p>
          <p className="text-sm text-muted">
            {categoryLabel(tool.category)} · {tool.ownerName}
            {tool.status === "on_loan" && " · on loan"}
          </p>
        </div>
        <ConfirmButton
          label="Remove listing"
          confirmLabel="Confirm removal"
          disabled={pending}
          onConfirm={() => run(() => remove({ toolId: tool._id }))}
        />
      </div>
      <ErrorNote message={error} />
    </div>
  );
}

type Member = FunctionReturnType<typeof api.users.list>[number];

function MembersSection() {
  const members = useQuery(api.users.list);

  return (
    <section>
      <SectionTitle count={members?.length}>Members</SectionTitle>
      {members === undefined ? (
        <LoadingList rows={2} />
      ) : (
        <Card className="divide-y divide-line py-0">
          {members.map((member) => (
            <MemberRow key={member._id} member={member} />
          ))}
        </Card>
      )}
    </section>
  );
}

function MemberRow({ member }: { member: Member }) {
  const setTrusted = useMutation(api.users.setTrustedLender);
  const { run, pending, error } = useRun();

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {member.name}
            {member.role === "admin" && <Badge>Admin</Badge>}
            {member.trustedLender && <Badge tone="good">Trusted Lender</Badge>}
          </p>
          <p className="text-sm text-muted">
            {member.email ?? "No email"} · {member.listingCount}{" "}
            {member.listingCount === 1 ? "listing" : "listings"}
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(() =>
              setTrusted({ userId: member._id, trusted: !member.trustedLender }),
            )
          }
        >
          {member.trustedLender ? "Remove Trusted Lender" : "Mark as Trusted Lender"}
        </Button>
      </div>
      <ErrorNote message={error} />
    </div>
  );
}
