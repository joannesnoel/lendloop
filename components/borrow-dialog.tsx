"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/domain";
import { localToday } from "@/lib/format";
import { useRun } from "@/lib/use-run";
import { Button, ErrorNote, Field, inputClass } from "./ui";

/** Modal for requesting a tool for a date range. */
export function BorrowDialog({
  tool,
  onClose,
}: {
  tool: { _id: Id<"tools">; name: string; ownerName: string };
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useMutation(api.loans.request);
  const { run, pending, error } = useRun();

  const [startDate, setStartDate] = useState(() => localToday());
  const [endDate, setEndDate] = useState(() => localToday(2));
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const sent = await run(() =>
      request({ toolId: tool._id, startDate, endDate, message }),
    );
    if (sent) onClose();
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-surface p-6 text-ink"
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Borrow {tool.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {tool.ownerName} will be notified and can approve or decline.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="From">
            <input
              type="date"
              className={inputClass}
              value={startDate}
              min={localToday()}
              onChange={(event) => {
                setStartDate(event.target.value);
                if (event.target.value > endDate) setEndDate(event.target.value);
              }}
              required
            />
          </Field>
          <Field label="Until">
            <input
              type="date"
              className={inputClass}
              value={endDate}
              min={startDate}
              onChange={(event) => setEndDate(event.target.value)}
              required
            />
          </Field>
        </div>
        <Field label="Note" hint="Optional">
          <textarea
            className={inputClass}
            rows={2}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What do you need it for?"
            maxLength={LIMITS.messageMax}
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send request"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
