// Reading and validating the shopping list's item form (roadmap Phase 15).
// Pure: the Server Actions pass the household's real active members; the
// database checks everything again (lengths, the assignee, membership).

export const ITEM_NAME_MAX = 120;
export const ITEM_QUANTITY_MAX = 40;
export const ITEM_NOTE_MAX = 300;

/** The form as typed, kept to show again after an error. */
export type RawItemForm = {
  name: string;
  quantity: string;
  note: string;
  /** A member's id, or "" for nobody. */
  assignee: string;
};

export type ItemValues = {
  name: string;
  quantity: string | null;
  note: string | null;
  assigneeId: string | null;
};

export type Validation<T> =
  { ok: true; value: T } | { ok: false; fieldErrors: Record<string, string> };

export const EMPTY_ITEM_FORM: RawItemForm = {
  name: "",
  quantity: "",
  note: "",
  assignee: "",
};

export function readItemForm(formData: FormData): RawItemForm {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    name: text("name"),
    quantity: text("quantity"),
    note: text("note"),
    assignee: text("assignee"),
  };
}

/**
 * Whether `assignee` may be chosen: nobody, an active member, or whoever it's
 * assigned to already (a former member's assignment stays until changed, D13).
 */
export function validAssignee(
  assignee: string,
  context: { memberIds: readonly string[]; currentAssigneeId?: string | null },
): boolean {
  return (
    assignee === "" ||
    context.memberIds.includes(assignee) ||
    (context.currentAssigneeId != null &&
      assignee === context.currentAssigneeId)
  );
}

export function validateItem(
  raw: RawItemForm,
  context: { memberIds: readonly string[]; currentAssigneeId?: string | null },
): Validation<ItemValues> {
  const errors: Record<string, string> = {};
  const name = raw.name.trim();
  const quantity = raw.quantity.trim();
  const note = raw.note.trim();

  if (name === "") errors.name = "Say what's needed, like “Milk”.";
  else if (name.length > ITEM_NAME_MAX) {
    errors.name = `Use ${ITEM_NAME_MAX} characters or fewer.`;
  }
  if (quantity.length > ITEM_QUANTITY_MAX) {
    errors.quantity = `Use ${ITEM_QUANTITY_MAX} characters or fewer.`;
  }
  if (note.length > ITEM_NOTE_MAX) {
    errors.note = `Use ${ITEM_NOTE_MAX} characters or fewer.`;
  }
  if (!validAssignee(raw.assignee, context)) {
    errors.assignee = "Choose a current member, or nobody.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    value: {
      name,
      quantity: quantity === "" ? null : quantity,
      note: note === "" ? null : note,
      assigneeId: raw.assignee === "" ? null : raw.assignee,
    },
  };
}
