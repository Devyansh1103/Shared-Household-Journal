import { io } from "next/cache";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";
import {
  INVITE_STATUS_LABELS,
  inviteStatus,
  type InviteStatus,
} from "@/lib/households/invite-status";
import type { Household, Invitation } from "@/lib/households/queries";
import { revokeInvite } from "../actions";

const BADGE: Record<InviteStatus, "success" | "neutral" | "warning"> = {
  active: "success",
  revoked: "neutral",
  used_up: "neutral",
  expired: "warning",
};

export async function InvitationList({
  household,
  invitations,
}: {
  household: Household;
  invitations: Invitation[];
}) {
  if (invitations.length === 0) {
    return <p className="type-secondary">No invite links yet.</p>;
  }

  // Status depends on the current time, so read it per request.
  await io();
  const now = new Date();
  const isOwner = household.myRole === "owner";

  return (
    <div className="space-y-3">
      <h3 className="type-card-title">Invite links</h3>
      <p className="type-help">
        Links are shown only when they&apos;re created. To share one again,
        create a new link.
      </p>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {invitations.map((invite) => {
          const status = inviteStatus(invite, now);
          const canRevoke =
            status === "active" &&
            (isOwner || invite.createdBy === household.myUserId);
          const creator =
            invite.createdBy === household.myUserId
              ? "you"
              : invite.creatorName;
          return (
            <li
              key={invite.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={BADGE[status]}>
                    {INVITE_STATUS_LABELS[status]}
                  </StatusBadge>
                  <span className="type-body">
                    {invite.useCount} of {invite.maxUses} uses
                  </span>
                </div>
                <p className="type-timestamp">
                  Created by {creator} on{" "}
                  {formatDateTime(invite.createdAt, household.timezone)} ·{" "}
                  {status === "expired" ? "Expired" : "Expires"}{" "}
                  {formatDateTime(invite.expiresAt, household.timezone)}
                </p>
              </div>
              {canRevoke ? (
                <ConfirmActionDialog
                  triggerLabel="Revoke"
                  triggerAriaLabel={`Revoke the link created by ${creator} on ${formatDateTime(invite.createdAt, household.timezone)}`}
                  title="Revoke this invite link?"
                  description="Nobody will be able to join with it any more. People who already joined stay members."
                  confirmLabel="Revoke link"
                  pendingLabel="Revoking…"
                  destructive
                  action={revokeInvite}
                  fields={{
                    householdId: household.id,
                    invitationId: invite.id,
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
