// Display status of an invite link. The database makes the real decision in
// accept_invite; this only labels the list members see.

export type InviteStatus = "active" | "revoked" | "used_up" | "expired";

export type InviteState = {
  expiresAt: string;
  maxUses: number;
  useCount: number;
  revokedAt: string | null;
};

export function inviteStatus(
  invite: InviteState,
  now: Date = new Date(),
): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.useCount >= invite.maxUses) return "used_up";
  if (Date.parse(invite.expiresAt) <= now.getTime()) return "expired";
  return "active";
}

export const INVITE_STATUS_LABELS: Record<InviteStatus, string> = {
  active: "Active",
  revoked: "Revoked",
  used_up: "Used up",
  expired: "Expired",
};
