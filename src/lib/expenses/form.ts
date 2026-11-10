// Reading and validating the expense form (create and edit). Pure: the Server
// Actions use it with the household's real members and currency, and the
// database checks the result again (create_expense / update_expense).

import { z } from "zod";
import { parseAmount, parsePercent } from "@/domain/money/amount";
import {
  computeSplit,
  SPLIT_METHODS,
  type Share,
  type SplitMethod,
} from "@/domain/money/split";
import { CATEGORY_VALUES, type ExpenseCategory } from "./categories";
import { isCalendarDate } from "./dates";

/** The form as typed, kept so it can be shown again after an error. */
export type RawExpenseForm = {
  description: string;
  amount: string;
  category: string;
  expenseDate: string;
  paidBy: string;
  splitMethod: string;
  participants: string[];
  /** Custom split amounts, by user id. */
  shares: Record<string, string>;
  /** Percentage split values, by user id. */
  percents: Record<string, string>;
};

export type ValidExpense = {
  description: string;
  amountMinor: bigint;
  category: ExpenseCategory;
  expenseDate: string;
  paidBy: string;
  splitMethod: SplitMethod;
  shares: Share[];
};

export type ExpenseValidation =
  | { ok: true; expense: ValidExpense }
  | { ok: false; fieldErrors: Record<string, string> };

const fieldsSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Describe the expense, like “Electricity bill”.")
    .max(120, "Use 120 characters or fewer."),
  category: z.enum(CATEGORY_VALUES, "Choose a category."),
  expenseDate: z
    .string()
    .refine(isCalendarDate, "Choose the date the money was spent."),
  splitMethod: z.enum(SPLIT_METHODS, "Choose how to split it."),
});

export function shareField(userId: string): string {
  return `share:${userId}`;
}

export function percentField(userId: string): string {
  return `percent:${userId}`;
}

export function readExpenseForm(formData: FormData): RawExpenseForm {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const shares: Record<string, string> = {};
  const percents: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (key.startsWith("share:")) shares[key.slice(6)] = value;
    if (key.startsWith("percent:")) percents[key.slice(8)] = value;
  }
  return {
    description: text("description"),
    amount: text("amount"),
    category: text("category"),
    expenseDate: text("expenseDate"),
    paidBy: text("paidBy"),
    splitMethod: text("splitMethod"),
    participants: formData
      .getAll("participants")
      .filter((v): v is string => typeof v === "string"),
    shares,
    percents,
  };
}

/**
 * Validates the form against the household: `memberIds` are the active members
 * in the order they joined (ADR-004 uses that order for leftover units), and
 * `exponent` is the currency's decimal places.
 */
export function validateExpenseForm(
  raw: RawExpenseForm,
  context: { memberIds: string[]; exponent: number },
): ExpenseValidation {
  const errors: Record<string, string> = {};

  const fields = fieldsSchema.safeParse(raw);
  if (!fields.success) {
    for (const issue of fields.error.issues) {
      const key = String(issue.path[0]);
      if (!(key in errors)) errors[key] = issue.message;
    }
  }

  const amount = parseAmount(raw.amount, context.exponent);
  if (!amount.ok) errors.amount = amount.error;

  const members = new Set(context.memberIds);
  if (!members.has(raw.paidBy)) errors.paidBy = "Choose who paid.";

  const chosen = new Set(raw.participants);
  if ([...chosen].some((id) => !members.has(id))) {
    errors.participants = "Choose people from this household.";
  }
  // Join order, not the order the boxes were ticked.
  const participants = context.memberIds.filter((id) => chosen.has(id));
  if (participants.length === 0 && !errors.participants) {
    errors.participants = "Choose at least one person to split with.";
  }

  if (!fields.success || !amount.ok || Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  const total = amount.minor;
  const method = fields.data.splitMethod;
  let result;

  if (method === "equal") {
    result = computeSplit({ method, total, participants });
  } else if (method === "percentage") {
    const entries = [];
    for (const userId of participants) {
      const parsed = parsePercent(raw.percents[userId] ?? "");
      if (!parsed.ok) errors[percentField(userId)] = parsed.error;
      else entries.push({ userId, basisPoints: parsed.basisPoints });
    }
    if (Object.keys(errors).length > 0)
      return { ok: false, fieldErrors: errors };
    result = computeSplit({ method, total, participants: entries });
  } else {
    const entries = [];
    for (const userId of participants) {
      const input = (raw.shares[userId] ?? "").trim();
      if (input === "0" || /^0(\.0+)?$/.test(input)) {
        entries.push({ userId, shareMinor: BigInt(0) });
        continue;
      }
      const parsed = parseAmount(input, context.exponent);
      if (!parsed.ok) errors[shareField(userId)] = parsed.error;
      else entries.push({ userId, shareMinor: parsed.minor });
    }
    if (Object.keys(errors).length > 0)
      return { ok: false, fieldErrors: errors };
    result = computeSplit({ method, total, participants: entries });
  }

  if (!result.ok) {
    return { ok: false, fieldErrors: { participants: result.error } };
  }

  return {
    ok: true,
    expense: {
      description: fields.data.description,
      amountMinor: total,
      category: fields.data.category,
      expenseDate: fields.data.expenseDate,
      paidBy: raw.paidBy,
      splitMethod: method,
      shares: result.shares,
    },
  };
}

/** Shares in the shape create_expense / update_expense expect. */
export function sharesJson(shares: Share[]) {
  return shares.map((share) => ({
    user_id: share.userId,
    share_minor: Number(share.shareMinor),
    percentage_bp: share.percentageBp,
  }));
}
