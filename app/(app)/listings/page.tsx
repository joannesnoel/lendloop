"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ToolForm, type ToolDraft } from "@/components/tool-form";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorNote,
  LoadingList,
  PageHeader,
} from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { categoryLabel, conditionLabel } from "@/convex/lib/domain";
import { useRun } from "@/lib/use-run";

export default function ListingsPage() {
  const tools = useQuery(api.tools.mine);
  // "new" while the create form is open, or the id of the listing being edited.
  const [editing, setEditing] = useState<"new" | ToolDraft["_id"] | null>(null);

  return (
    <>
      <PageHeader
        title="My listings"
        description="Tools you're lending to the neighborhood."
        action={
          editing === null && <Button onClick={() => setEditing("new")}>List a tool</Button>
        }
      />

      {editing === "new" && (
        <Card className="mb-6">
          <h2 className="mb-4 font-medium">New listing</h2>
          <ToolForm onDone={() => setEditing(null)} />
        </Card>
      )}

      {tools === undefined ? (
        <LoadingList />
      ) : tools.length === 0 && editing !== "new" ? (
        <EmptyState
          title="You haven't listed anything yet"
          body="Add a tool you'd be happy to lend. You approve every request before it goes out."
          action={<Button onClick={() => setEditing("new")}>List a tool</Button>}
        />
      ) : (
        <div className="space-y-3">
          {tools.map((tool) =>
            editing === tool._id ? (
              <Card key={tool._id}>
                <ToolForm tool={tool} onDone={() => setEditing(null)} />
              </Card>
            ) : (
              <ListingRow key={tool._id} tool={tool} onEdit={() => setEditing(tool._id)} />
            ),
          )}
        </div>
      )}
    </>
  );
}

function ListingRow({
  tool,
  onEdit,
}: {
  tool: ToolDraft & { status: "available" | "on_loan" };
  onEdit: () => void;
}) {
  const remove = useMutation(api.tools.remove);
  const { run, pending, error } = useRun();

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{tool.name}</h2>
            {tool.status === "available" ? (
              <Badge tone="good">Available</Badge>
            ) : (
              <Badge tone="warn">On loan</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            {categoryLabel(tool.category)} · {conditionLabel(tool.condition)}
          </p>
          {tool.description && <p className="mt-2 text-sm">{tool.description}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={onEdit} disabled={pending}>
            Edit
          </Button>
          <ConfirmButton
            label="Delete"
            confirmLabel="Confirm delete"
            disabled={pending}
            onConfirm={() => run(() => remove({ toolId: tool._id }))}
          />
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}
    </Card>
  );
}
