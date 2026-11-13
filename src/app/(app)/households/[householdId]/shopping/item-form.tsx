"use client";

import { useActionState, useId } from "react";
import {
  AssigneeField,
  type AssigneeOption,
} from "@/components/assignee-field";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { TextField } from "@/components/text-field";
import { FieldGroup } from "@/components/ui/field";
import {
  EMPTY_ITEM_FORM,
  ITEM_NAME_MAX,
  ITEM_NOTE_MAX,
  ITEM_QUANTITY_MAX,
  type RawItemForm,
} from "@/lib/shopping/form";
import type { ItemFormState } from "./actions";

type Action = (
  previous: ItemFormState,
  formData: FormData,
) => Promise<ItemFormState>;

/**
 * An item on the shopping list: adding one (the form stays, empty, for the
 * next) or editing one. Each answer from the server is numbered so the fields
 * start again from what was submitted, or empty after an add: React resets a
 * form's fields after its action, and a select would otherwise go back to its
 * first option silently.
 */
export function ItemForm({
  mode,
  action,
  hidden,
  requestKey,
  members,
  former,
  viewerId,
  defaults,
}: {
  mode: "add" | "edit";
  action: Action;
  /** Hidden fields naming the household and item; the server re-checks them. */
  hidden: Record<string, string>;
  /** The first add's key; each successful add brings the next. */
  requestKey?: string;
  members: AssigneeOption[];
  former?: AssigneeOption | null;
  viewerId: string;
  defaults: RawItemForm;
}) {
  const [state, formAction] = useActionState<
    ItemFormState & { attempt?: number },
    FormData
  >(
    async (previous, formData) => {
      const result = await action(previous, formData);
      return {
        ...result,
        // After an error, the same key again: the item may have been added.
        nextKey: result.nextKey ?? previous.nextKey,
        attempt: (previous.attempt ?? 0) + 1,
      };
    },
    { status: "idle" },
  );
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const key = state.nextKey ?? requestKey;
  const values =
    state.status === "error"
      ? (state.raw ?? defaults)
      : mode === "add"
        ? EMPTY_ITEM_FORM
        : defaults;

  return (
    <form action={formAction} noValidate className="space-y-5">
      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}
      {state.status === "success" && state.message ? (
        <FormAlert tone="success">{state.message}</FormAlert>
      ) : null}
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {key ? <input type="hidden" name="requestKey" value={key} /> : null}
      <FieldGroup key={state.attempt ?? 0}>
        <div className="grid gap-5 sm:grid-cols-[2fr_1fr]">
          <TextField
            id={fid("name")}
            name="name"
            label="Item"
            maxLength={ITEM_NAME_MAX}
            autoComplete="off"
            required
            defaultValue={values.name}
            error={state.fieldErrors?.name}
          />
          <TextField
            id={fid("quantity")}
            name="quantity"
            label="Quantity (optional)"
            description="Like 2, 1 kg or a big bag."
            maxLength={ITEM_QUANTITY_MAX}
            autoComplete="off"
            defaultValue={values.quantity}
            error={state.fieldErrors?.quantity}
          />
        </div>
        <AssigneeField
          id={fid("assignee")}
          label="Who's getting it? (optional)"
          members={members}
          former={former}
          viewerId={viewerId}
          defaultValue={values.assignee}
          error={state.fieldErrors?.assignee}
        />
        <TextField
          id={fid("note")}
          name="note"
          label="Note (optional)"
          description="Like a brand or a size. Shown on the list only."
          maxLength={ITEM_NOTE_MAX}
          autoComplete="off"
          defaultValue={values.note}
          error={state.fieldErrors?.note}
        />
      </FieldGroup>
      <SubmitButton pendingLabel={mode === "add" ? "Adding…" : "Saving…"}>
        {mode === "add" ? "Add to the list" : "Save changes"}
      </SubmitButton>
    </form>
  );
}
