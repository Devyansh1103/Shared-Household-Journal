import "server-only";
import { notFound } from "next/navigation";
import { getHousehold } from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";
import { checkAnalytics, parseAnalytics, type Analytics } from "./payload";
import type { AnalyticsQuery } from "./query";

// Data access for analytics (roadmap Phase 16). One read, run as the
// signed-in member under RLS after getHousehold (404 for non-members). All
// the sums are worked out in Postgres; only the figures reach the page.

export type AnalyticsView =
  { ok: true; data: Analytics } | { ok: false; reason: "not_verified" };

export async function getAnalytics(
  householdId: string,
  query: AnalyticsQuery,
): Promise<AnalyticsView> {
  const household = await getHousehold(householdId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("household_analytics", {
    target_household_id: household.id,
    date_from: query.from,
    date_to: query.to,
    ...(query.category ? { category_filter: query.category } : {}),
    ...(query.payer ? { payer_filter: query.payer } : {}),
    ...(query.compareFrom && query.compareTo
      ? { compare_from: query.compareFrom, compare_to: query.compareTo }
      : {}),
  });
  if (error) {
    if (error.code === "42501") notFound();
    throw new Error("Could not load the analytics.");
  }
  const parsed = parseAnalytics(data);
  const check = parsed
    ? checkAnalytics(parsed, query)
    : ({ ok: false, code: "malformed" } as const);
  if (!parsed || !check.ok) {
    // The reason only: no amounts or ids in logs.
    console.error(
      `Analytics failed verification: ${check.ok ? "malformed" : check.code}`,
    );
    return { ok: false, reason: "not_verified" };
  }
  return { ok: true, data: parsed };
}
