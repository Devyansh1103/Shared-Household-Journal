import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getHousehold, type Household } from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";
import {
  checkBillDetail,
  checkHouseholdBills,
  parseBillDetail,
  parseHouseholdBills,
  type BillDetail,
  type HouseholdBills,
} from "./payload";

// Data access for recurring bills (roadmap Phase 14). Reads run as the
// signed-in member under RLS; the household is checked first through
// getHousehold (404 for non-members). Writes go through the bill functions.

export type BillsView =
  { ok: true; bills: HouseholdBills } | { ok: false; reason: "not_verified" };

export type BillView =
  { ok: true; detail: BillDetail } | { ok: false; reason: "not_verified" };

/** The household's bills and their open, upcoming and recently paid periods. */
export async function getBills(householdId: string): Promise<BillsView> {
  const household = await getHousehold(householdId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("household_bills", {
    target_household_id: household.id,
  });
  if (error) {
    if (error.code === "42501") notFound();
    throw new Error("Could not load the bills.");
  }
  const bills = parseHouseholdBills(data);
  const check = bills
    ? checkHouseholdBills(bills, household.id)
    : ({ ok: false, code: "malformed" } as const);
  if (!bills || !check.ok) {
    // The reason only: no names, amounts or ids in logs.
    console.error(
      `Bills failed verification: ${check.ok ? "malformed" : check.code}`,
    );
    return { ok: false, reason: "not_verified" };
  }
  return { ok: true, bills };
}

/** One bill of the household with its periods, or a 404 (also for other households' ids). */
export async function getBill(
  householdId: string,
  billId: string,
): Promise<{ household: Household; view: BillView }> {
  const household = await getHousehold(householdId);
  if (!z.uuid().safeParse(billId).success) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recurring_bill", {
    target_bill_id: billId,
  });
  if (error) {
    if (error.code === "HJ018" || error.code === "42501") notFound();
    throw new Error("Could not load the bill.");
  }
  const detail = parseBillDetail(data);
  if (detail && detail.bill.householdId !== household.id) notFound();
  const check = detail
    ? checkBillDetail(detail, household.id)
    : ({ ok: false, code: "malformed" } as const);
  if (!detail || !check.ok) {
    console.error(
      `Bill failed verification: ${check.ok ? "malformed" : check.code}`,
    );
    return { household, view: { ok: false, reason: "not_verified" } };
  }
  return { household, view: { ok: true, detail } };
}
