// Reads what public.household_balances returns. Money arrives as text and is
// parsed with BigInt, so it's exact at any size (a JSON number is a double,
// and a household's totals aren't capped the way one expense is). Anything
// without exactly the expected shape is refused rather than guessed at.

import { z } from "zod";
import type {
  BalanceEntry,
  PairBalance,
  PersonBalance,
} from "@/domain/money/balances";

const minor = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)$/)
  .transform((value) => BigInt(value));
const count = z.number().int().min(0);
const id = z.uuid();

const payloadSchema = z.object({
  expense_count: count,
  total_minor: minor,
  people: z.array(
    z.object({
      user_id: id,
      display_name: z.string().nullable(),
      is_active: z.boolean(),
      paid_minor: minor,
      share_minor: minor,
      net_minor: minor,
      paid_count: count,
      share_count: count,
    }),
  ),
  pairs: z.array(
    z.object({ debtor_id: id, creditor_id: id, amount_minor: minor }),
  ),
  entry_count: count,
  entries: z.array(
    z.object({
      expense_id: id,
      description: z.string(),
      expense_date: z.iso.date(),
      amount_minor: minor,
      paid_by: id,
      paid_minor: minor,
      share_minor: minor,
      net_minor: minor,
      counterparts: z.array(z.object({ user_id: id, minor })),
    }),
  ),
});

export type BalancePerson = PersonBalance & {
  displayName: string;
  /** False for someone who has left but is still in counted expenses (D13). */
  isActive: boolean;
};

export type BalanceLine = BalanceEntry & {
  description: string;
  expenseDate: string;
  amountMinor: bigint;
  paidBy: string;
};

export type BalanceSummary = {
  expenseCount: number;
  totalMinor: bigint;
  people: BalancePerson[];
  pairs: PairBalance[];
  /** All counted expenses behind the focus person's balance. */
  entryCount: number;
  /** The newest of them (all of them unless the database capped the list). */
  entries: BalanceLine[];
};

/** The payload as typed values, or null if it isn't exactly what's expected. */
export function parseBalancesPayload(payload: unknown): BalanceSummary | null {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const data = parsed.data;

  return {
    expenseCount: data.expense_count,
    totalMinor: data.total_minor,
    people: data.people.map((person) => ({
      userId: person.user_id,
      displayName: person.display_name ?? "Former member",
      isActive: person.is_active,
      paidMinor: person.paid_minor,
      shareMinor: person.share_minor,
      netMinor: person.net_minor,
      paidCount: person.paid_count,
      shareCount: person.share_count,
    })),
    pairs: data.pairs.map((pair) => ({
      debtorId: pair.debtor_id,
      creditorId: pair.creditor_id,
      amountMinor: pair.amount_minor,
    })),
    entryCount: data.entry_count,
    entries: data.entries.map((entry) => ({
      expenseId: entry.expense_id,
      description: entry.description,
      expenseDate: entry.expense_date,
      amountMinor: entry.amount_minor,
      paidBy: entry.paid_by,
      paidMinor: entry.paid_minor,
      shareMinor: entry.share_minor,
      netMinor: entry.net_minor,
      counterparts: entry.counterparts.map((c) => ({
        userId: c.user_id,
        minor: c.minor,
      })),
    })),
  };
}
