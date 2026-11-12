// Reading and validating the "Record a payment" form. Pure: the browser uses
// it before showing the review step, and the Server Action runs it again with
// the household's real members and currency, read on the server. The database
// checks everything a third time (record_settlement).
//
// D9: only the payer or the recipient records a settlement, so the form asks
// for the other person and which way the money went; the viewer is always one
// side, and their id comes from the session, never from the form.

import { z } from "zod";
import { parseAmount } from "@/domain/money/amount";
import { isCalendarDate } from "@/lib/expenses/dates";

export const NOTE_MAX_LENGTH = 200;

/** "paid": the viewer paid the other person. "received": the other way. */
export const DIRECTIONS = ["paid", "received"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** The form as typed, kept so it can be shown again after an error. */
export type RawSettlementForm = {
  otherUserId: string;
  direction: string;
  amount: string;
  settledOn: string;
  note: string;
};

export type ValidSettlement = {
  fromUserId: string;
  toUserId: string;
  amountMinor: bigint;
  settledOn: string;
  /** Trimmed; null when left blank. */
  note: string | null;
};

export type SettlementValidation =
  | { ok: true; settlement: ValidSettlement }
  | {
      ok: false;
      fieldErrors: Partial<Record<keyof RawSettlementForm, string>>;
    };

const noteSchema = z
  .string()
  .trim()
  .max(NOTE_MAX_LENGTH, `Use ${NOTE_MAX_LENGTH} characters or fewer.`);

export function readSettlementForm(formData: FormData): RawSettlementForm {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    otherUserId: text("otherUserId"),
    direction: text("direction"),
    amount: text("amount"),
    settledOn: text("settledOn"),
    note: text("note"),
  };
}

/**
 * Validates the form for `viewerId` against the household: `memberIds` are
 * its active members (O9: a settlement with someone who has left can't be
 * recorded yet), `exponent` is the currency's decimal places.
 */
export function validateSettlementForm(
  raw: RawSettlementForm,
  context: { viewerId: string; memberIds: string[]; exponent: number },
): SettlementValidation {
  const errors: Partial<Record<keyof RawSettlementForm, string>> = {};
  const members = new Set(context.memberIds);

  if (raw.otherUserId === "") {
    errors.otherUserId = "Choose who the payment was with.";
  } else if (raw.otherUserId === context.viewerId) {
    errors.otherUserId = "Choose someone other than yourself.";
  } else if (!members.has(raw.otherUserId)) {
    errors.otherUserId = "Choose someone who's a member of this household.";
  }

  const direction = z.enum(DIRECTIONS).safeParse(raw.direction);
  if (!direction.success) errors.direction = "Choose who paid whom.";

  const amount = parseAmount(raw.amount, context.exponent);
  if (!amount.ok) errors.amount = amount.error;

  if (!isCalendarDate(raw.settledOn)) {
    errors.settledOn = "Choose the date the money was paid.";
  }

  const note = noteSchema.safeParse(raw.note);
  if (!note.success) errors.note = note.error.issues[0]?.message;

  if (
    !direction.success ||
    !amount.ok ||
    !note.success ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, fieldErrors: errors };
  }

  const viewerPaid = direction.data === "paid";
  return {
    ok: true,
    settlement: {
      fromUserId: viewerPaid ? context.viewerId : raw.otherUserId,
      toUserId: viewerPaid ? raw.otherUserId : context.viewerId,
      amountMinor: amount.minor,
      settledOn: raw.settledOn,
      note: note.data === "" ? null : note.data,
    },
  };
}
