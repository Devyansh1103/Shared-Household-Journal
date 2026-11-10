import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { householdIdSchema } from "./schemas";

// Data access for households. Every read runs as the signed-in user under RLS,
// so a household the user isn't an active member of simply isn't returned.

export type HouseholdRole = Database["public"]["Enums"]["household_role"];

export type HouseholdSummary = {
  id: string;
  name: string;
  currencyCode: string;
  timezone: string;
  role: HouseholdRole;
  memberCount: number;
};

export type Household = {
  id: string;
  name: string;
  currencyCode: string;
  timezone: string;
  createdAt: string;
  myRole: HouseholdRole;
  myUserId: string;
};

export type Member = {
  userId: string;
  displayName: string;
  role: HouseholdRole;
  joinedAt: string;
};

export type Invitation = {
  id: string;
  createdBy: string;
  creatorName: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  revokedAt: string | null;
};

const LOAD_ERROR = "Could not load your households.";

/** The households the signed-in user is an active member of, by name. */
export const listMyHouseholds = cache(async (): Promise<HouseholdSummary[]> => {
  const user = await requireUser();
  const supabase = await createClient();

  const [households, memberships] = await Promise.all([
    supabase
      .from("households")
      .select("id, name, currency_code, timezone")
      .order("name"),
    // RLS returns every membership row of the user's households.
    supabase
      .from("household_members")
      .select("household_id, user_id, role")
      .is("left_at", null),
  ]);
  if (households.error || memberships.error) throw new Error(LOAD_ERROR);

  return households.data.flatMap((household) => {
    const members = memberships.data.filter(
      (m) => m.household_id === household.id,
    );
    const mine = members.find((m) => m.user_id === user.id);
    if (!mine) return [];
    return [
      {
        id: household.id,
        name: household.name,
        currencyCode: household.currency_code,
        timezone: household.timezone,
        role: mine.role,
        memberCount: members.length,
      },
    ];
  });
});

/**
 * One household the user belongs to. Anything else (a malformed id, a household
 * that doesn't exist, or one the user isn't in) is the same 404, so ids can't
 * be probed.
 */
export const getHousehold = cache(
  async (householdId: string): Promise<Household> => {
    if (!householdIdSchema.safeParse(householdId).success) notFound();
    const user = await requireUser();
    const supabase = await createClient();

    const [household, membership] = await Promise.all([
      supabase
        .from("households")
        .select("id, name, currency_code, timezone, created_at")
        .eq("id", householdId)
        .maybeSingle(),
      supabase
        .from("household_members")
        .select("role")
        .eq("household_id", householdId)
        .eq("user_id", user.id)
        .is("left_at", null)
        .maybeSingle(),
    ]);
    if (household.error || membership.error) throw new Error(LOAD_ERROR);
    if (!household.data || !membership.data) notFound();

    return {
      id: household.data.id,
      name: household.data.name,
      currencyCode: household.data.currency_code,
      timezone: household.data.timezone,
      createdAt: household.data.created_at,
      myRole: membership.data.role,
      myUserId: user.id,
    };
  },
);

/**
 * Active members in the order they joined: by joined_at, then user id, as
 * Postgres orders them. This is the order ADR-004 uses for leftover minor
 * units, so it's taken from the database rather than re-sorted here (string
 * comparison of timestamps isn't reliably chronological).
 */
export const listMembersInJoinOrder = cache(
  async (householdId: string): Promise<Member[]> => {
    await getHousehold(householdId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("household_members")
      .select("user_id, role, joined_at, profiles(display_name)")
      .eq("household_id", householdId)
      .is("left_at", null)
      .order("joined_at", { ascending: true })
      .order("user_id", { ascending: true });
    if (error) throw new Error("Could not load the members.");

    return data.map((row) => ({
      userId: row.user_id,
      displayName: row.profiles?.display_name ?? "Former member",
      role: row.role,
      joinedAt: row.joined_at,
    }));
  },
);

/** Active members, the owner first, then in order of joining. */
export async function listMembers(householdId: string): Promise<Member[]> {
  const members = await listMembersInJoinOrder(householdId);
  // Array.prototype.sort is stable, so join order is kept within each group.
  return [...members].sort(
    (a, b) => Number(b.role === "owner") - Number(a.role === "owner"),
  );
}

const INVITATION_LIMIT = 50;

/** The most recent invite links, newest first. Raw tokens are never stored. */
export async function listInvitations(
  householdId: string,
): Promise<Invitation[]> {
  await getHousehold(householdId);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .select(
      "id, created_by, created_at, expires_at, max_uses, use_count, revoked_at, profiles(display_name)",
    )
    .eq("household_id", householdId)
    .order("created_at", { ascending: false })
    .limit(INVITATION_LIMIT);
  if (error) throw new Error("Could not load the invite links.");

  return data.map((row) => ({
    id: row.id,
    createdBy: row.created_by,
    creatorName: row.profiles?.display_name ?? "Former member",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    useCount: row.use_count,
    revokedAt: row.revoked_at,
  }));
}
