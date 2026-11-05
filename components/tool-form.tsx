"use client";

import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CATEGORIES,
  CONDITIONS,
  LIMITS,
  type Category,
  type Condition,
} from "@/convex/lib/domain";
import { useRun } from "@/lib/use-run";
import { Button, ErrorNote, Field, inputClass } from "./ui";

export type ToolDraft = {
  _id: Id<"tools">;
  name: string;
  category: Category;
  condition: Condition;
  description: string;
};

/** Create a listing, or edit one when `tool` is given. */
export function ToolForm({
  tool,
  onDone,
}: {
  tool?: ToolDraft;
  onDone: () => void;
}) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const { run, pending, error } = useRun();

  const [name, setName] = useState(tool?.name ?? "");
  const [category, setCategory] = useState<Category>(tool?.category ?? "power_tools");
  const [condition, setCondition] = useState<Condition>(tool?.condition ?? "good");
  const [description, setDescription] = useState(tool?.description ?? "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fields = { name, category, condition, description };
    const saved = await run(() =>
      tool ? update({ toolId: tool._id, ...fields }) : create(fields),
    );
    if (saved) onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name">
        <input
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Cordless drill"
          minLength={LIMITS.toolNameMin}
          maxLength={LIMITS.toolNameMax}
          required
          autoFocus
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category">
          <select
            className={inputClass}
            value={category}
            onChange={(event) => setCategory(event.target.value as Category)}
          >
            {CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condition">
          <select
            className={inputClass}
            value={condition}
            onChange={(event) => setCondition(event.target.value as Condition)}
          >
            {CONDITIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        label="Short description"
        hint={`${description.length}/${LIMITS.descriptionMax}`}
      >
        <textarea
          className={inputClass}
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What's included, anything a borrower should know"
          maxLength={LIMITS.descriptionMax}
        />
      </Field>
      <ErrorNote message={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : tool ? "Save changes" : "List tool"}
        </Button>
      </div>
    </form>
  );
}
