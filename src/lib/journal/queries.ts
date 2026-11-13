import "server-only";
import { notFound } from "next/navigation";
import { getHousehold } from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";
import { checkJournal, parseJournalPayload, type JournalPage } from "./payload";
import { JOURNAL_PAGE_SIZE, journalArgs, type JournalQuery } from "./query";

// Data access for the household journal (roadmap Phase 13). The read runs as
// the signed-in member under RLS; the household is checked first through
// getHousehold (404 for non-members).

export type JournalView =
  | { ok: true; page: JournalPage }
  | {
      ok: false;
      /** The entries didn't pass their checks, so none are shown. */
      reason: "not_verified";
    };

/**
 * One page of the household's journal, read by public.household_journal as
 * the signed-in member, then checked (checkJournal) before anything is shown.
 */
export async function getJournal(
  householdId: string,
  query: JournalQuery,
): Promise<JournalView> {
  const household = await getHousehold(householdId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "household_journal",
    journalArgs(household.id, query),
  );
  if (error) {
    // Membership ended after getHousehold: the same answer as for anyone else.
    if (error.code === "42501") notFound();
    throw new Error("Could not load the journal.");
  }

  const page = parseJournalPayload(data);
  const check = page
    ? checkJournal(page, {
        householdId: household.id,
        filter: query.filter,
        before: query.before,
        pageSize: JOURNAL_PAGE_SIZE,
      })
    : ({ ok: false, code: "malformed" } as const);
  if (!page || !check.ok) {
    // The reason only: no names, amounts or ids in logs.
    console.error(
      `Journal failed verification: ${check.ok ? "malformed" : check.code}`,
    );
    return { ok: false, reason: "not_verified" };
  }
  return { ok: true, page };
}
