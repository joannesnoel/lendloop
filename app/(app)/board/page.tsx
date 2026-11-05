"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";
import { BorrowDialog } from "@/components/borrow-dialog";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  EmptyState,
  LoadingList,
  PageHeader,
  TrustedBadge,
} from "@/components/ui";
import { api } from "@/convex/_generated/api";
import {
  CATEGORIES,
  categoryLabel,
  conditionLabel,
  type Category,
} from "@/convex/lib/domain";
import { formatDay } from "@/lib/format";

type Tool = FunctionReturnType<typeof api.tools.list>[number];

export default function BoardPage() {
  const [category, setCategory] = useState<Category | undefined>(undefined);
  const [borrowing, setBorrowing] = useState<Tool | null>(null);
  const tools = useQuery(api.tools.list, { category });

  return (
    <>
      <PageHeader
        title="Tool board"
        description="Everything your neighbors are lending right now."
        action={
          <Link href="/listings" className={buttonClass("secondary")}>
            List a tool
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <FilterChip active={category === undefined} onClick={() => setCategory(undefined)}>
          All
        </FilterChip>
        {CATEGORIES.map((option) => (
          <FilterChip
            key={option.value}
            active={category === option.value}
            onClick={() => setCategory(option.value)}
          >
            {option.label}
          </FilterChip>
        ))}
      </div>

      {tools === undefined ? (
        <LoadingList />
      ) : tools.length === 0 ? (
        <EmptyState
          title={category ? `No ${categoryLabel(category).toLowerCase()} listed yet` : "The board is empty"}
          body="List something you own and get the loop started."
          action={
            <Link href="/listings" className={buttonClass("primary")}>
              List a tool
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tools.map((tool) => (
            <ToolCard key={tool._id} tool={tool} onBorrow={() => setBorrowing(tool)} />
          ))}
        </div>
      )}

      {borrowing && (
        <BorrowDialog tool={borrowing} onClose={() => setBorrowing(null)} />
      )}
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? "border-ink bg-ink text-white"
          : "border-line bg-surface text-muted hover:border-ink/30 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ToolCard({ tool, onBorrow }: { tool: Tool; onBorrow: () => void }) {
  const available = tool.status === "available";

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-medium">{tool.name}</h2>
        {available ? (
          <Badge tone="good">Available</Badge>
        ) : (
          <Badge tone="warn">
            On loan{tool.dueDate ? ` · due ${formatDay(tool.dueDate)}` : ""}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        {categoryLabel(tool.category)} · {conditionLabel(tool.condition)}
      </p>
      {tool.description && <p className="mt-3 text-sm">{tool.description}</p>}

      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
          {tool.isMine ? "Your listing" : `Lent by ${tool.ownerName}`}
          {tool.ownerTrusted && <TrustedBadge />}
        </p>
        {!tool.isMine &&
          (tool.iRequested ? (
            <Button variant="secondary" disabled>
              Requested
            </Button>
          ) : (
            <Button onClick={onBorrow} disabled={!available}>
              Request to borrow
            </Button>
          ))}
      </div>
    </Card>
  );
}
