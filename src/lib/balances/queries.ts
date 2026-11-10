import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  checkBalances,
  checkEntries,
  type BalanceErrorCode,
} from "@/domain/money/balances";
import { getHousehold, type Household } from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";
import {
  parseBalancesPayload,
  type BalancePerson,
  type BalanceSummary,
} from "./parse";

// Balances are calculated by Postgres (public.household_balances, ADR-005)
// as the signed-in member, under RLS, and verified here before anything is
// shown: if a check fails, the pages show an error instead of figures.

export type BalancesView =
  | {
      ok: true;
      household: Household;
      balances: BalanceSummary;
      /** The person asked about, when there is one. */
      focus: BalancePerson | null;
      /** Every expense behind the focus person's balance is listed. */
      complete: boolean;
    }
  | {
      ok: false;
      household: Household;
      /** not_reconciled: an expense doesn't add up (HJ013). */
      reason: "not_reconciled" | "not_verified";
      expenseId: string | null;
    };

/**
 * A household's balances. With `focusUserId`, also the expenses behind that
 * person's balance; a 404 if they aren't part of this household's balances.
 * Non-members get the household's 404 (getHousehold).
 */
export async function getBalances(
  householdId: string,
  focusUserId?: string,
): Promise<BalancesView> {
  const household = await getHousehold(householdId);
  if (focusUserId !== undefined && !z.uuid().safeParse(focusUserId).success) {
    notFound();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("household_balances", {
    target_household_id: household.id,
    ...(focusUserId ? { focus_user_id: focusUserId } : {}),
  });

  if (error) {
    if (error.code === "HJ013") {
      const expenseId = z.uuid().safeParse(error.details).success
        ? error.details
        : null;
      return { ok: false, household, reason: "not_reconciled", expenseId };
    }
    // Membership ended after getHousehold: the same answer as for anyone else.
    if (error.code === "42501") notFound();
    throw new Error("Could not load the balances.");
  }

  const unverified = (code: BalanceErrorCode | "malformed"): BalancesView => {
    // The reason only: no figures, names or ids in logs.
    console.error(`Balances failed verification: ${code}`);
    return { ok: false, household, reason: "not_verified", expenseId: null };
  };

  const balances = parseBalancesPayload(data);
  if (!balances) return unverified("malformed");
  const check = checkBalances(balances);
  if (!check.ok) return unverified(check.code);

  if (!focusUserId) {
    return { ok: true, household, balances, focus: null, complete: true };
  }
  const focus = balances.people.find((p) => p.userId === focusUserId);
  if (!focus) notFound();
  const complete = balances.entries.length === balances.entryCount;
  const entries = checkEntries(focus, balances.pairs, balances.entries, {
    complete,
  });
  if (!entries.ok) return unverified(entries.code);

  return { ok: true, household, balances, focus, complete };
}
