import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  getHousehold,
  listMembersInJoinOrder,
  type Household,
} from "@/lib/households/queries";
import { createClient } from "@/lib/supabase/server";

// Data access for settlements (D9). Reads run as the signed-in user under RLS;
// the household is checked first through getHousehold (404 for non-members).
// Writes go through record_settlement / void_settlement only.

export type SettlementPerson = {
  userId: string;
  displayName: string;
  /** False for someone who has left the household (D13). */
  isActive: boolean;
};

export type SettlementItem = {
  id: string;
  payer: SettlementPerson;
  recipient: SettlementPerson;
  /** Integer minor units in the household's currency (≤ 999,999,999,999). */
  amountMinor: number;
  /** The day the money changed hands (D11). */
  settledOn: string;
  note: string | null;
  recordedBy: SettlementPerson;
  createdAt: string;
  voidedAt: string | null;
  voidedBy: SettlementPerson | null;
};

export type SettlementList = {
  /** Counted: not voided, newest first. */
  recorded: SettlementItem[];
  /** Voided, most recently voided first. They don't count (D9). */
  voided: SettlementItem[];
  /** More exist than are shown (pagination comes with Phase 12). */
  recordedTruncated: boolean;
  voidedTruncated: boolean;
};

export type SettlementDetail = SettlementItem & {
  /** D9: the payer, the recipient or the owner, while it isn't voided. */
  canVoid: boolean;
  /** The viewer paid or received it. */
  viewerIsParty: boolean;
  /** The payer or the recipient has left (D13). */
  involvesFormerMember: boolean;
};

export const SETTLEMENT_LIST_LIMIT = 100;
export const VOIDED_LIST_LIMIT = 20;

const COLUMNS = `id, from_user, to_user, amount_minor, settled_on, note, recorded_by,
  created_at, voided_at, voided_by,
  payer:profiles!settlements_from_user_fkey(display_name),
  recipient:profiles!settlements_to_user_fkey(display_name),
  recorder:profiles!settlements_recorded_by_fkey(display_name),
  voider:profiles!settlements_voided_by_fkey(display_name)`;

type Row = {
  id: string;
  from_user: string;
  to_user: string;
  amount_minor: number;
  settled_on: string;
  note: string | null;
  recorded_by: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  payer: { display_name: string } | null;
  recipient: { display_name: string } | null;
  recorder: { display_name: string } | null;
  voider: { display_name: string } | null;
};

function toItem(row: Row, activeIds: Set<string>): SettlementItem {
  const person = (
    userId: string,
    profile: { display_name: string } | null,
  ): SettlementPerson => ({
    userId,
    displayName: profile?.display_name ?? "Former member",
    isActive: activeIds.has(userId),
  });
  return {
    id: row.id,
    payer: person(row.from_user, row.payer),
    recipient: person(row.to_user, row.recipient),
    amountMinor: row.amount_minor,
    settledOn: row.settled_on,
    note: row.note,
    recordedBy: person(row.recorded_by, row.recorder),
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by ? person(row.voided_by, row.voider) : null,
  };
}

/** The household's settlements: the ones that count, and the voided ones. */
export async function listSettlements(
  householdId: string,
): Promise<SettlementList> {
  const household = await getHousehold(householdId);
  const supabase = await createClient();

  const [members, recorded, voided] = await Promise.all([
    listMembersInJoinOrder(household.id),
    supabase
      .from("settlements")
      .select(COLUMNS)
      .eq("household_id", household.id)
      .is("voided_at", null)
      .order("settled_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(SETTLEMENT_LIST_LIMIT + 1),
    supabase
      .from("settlements")
      .select(COLUMNS)
      .eq("household_id", household.id)
      .not("voided_at", "is", null)
      .order("voided_at", { ascending: false })
      .limit(VOIDED_LIST_LIMIT + 1),
  ]);
  if (recorded.error || voided.error) {
    throw new Error("Could not load the settlements.");
  }

  const activeIds = new Set(members.map((m) => m.userId));
  return {
    recorded: recorded.data
      .slice(0, SETTLEMENT_LIST_LIMIT)
      .map((row) => toItem(row, activeIds)),
    voided: voided.data
      .slice(0, VOIDED_LIST_LIMIT)
      .map((row) => toItem(row, activeIds)),
    recordedTruncated: recorded.data.length > SETTLEMENT_LIST_LIMIT,
    voidedTruncated: voided.data.length > VOIDED_LIST_LIMIT,
  };
}

/** One settlement of the household, or a 404 (also for other households' ids). */
export async function getSettlement(
  householdId: string,
  settlementId: string,
): Promise<{ household: Household; settlement: SettlementDetail }> {
  const household = await getHousehold(householdId);
  if (!z.uuid().safeParse(settlementId).success) notFound();
  const supabase = await createClient();

  const [members, result] = await Promise.all([
    listMembersInJoinOrder(household.id),
    supabase
      .from("settlements")
      .select(COLUMNS)
      .eq("id", settlementId)
      .eq("household_id", household.id)
      .maybeSingle(),
  ]);
  if (result.error) throw new Error("Could not load the settlement.");
  if (!result.data) notFound();

  const activeIds = new Set(members.map((m) => m.userId));
  const item = toItem(result.data, activeIds);
  const me = household.myUserId;
  const viewerIsParty =
    item.payer.userId === me || item.recipient.userId === me;
  return {
    household,
    settlement: {
      ...item,
      canVoid:
        item.voidedAt === null &&
        (viewerIsParty || household.myRole === "owner"),
      viewerIsParty,
      involvesFormerMember: !item.payer.isActive || !item.recipient.isActive,
    },
  };
}
