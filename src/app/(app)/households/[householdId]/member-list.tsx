import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import type { Household, Member } from "@/lib/households/queries";
import { initials } from "@/lib/initials";
import { removeMember, transferOwnership } from "../actions";

export function MemberList({
  household,
  members,
}: {
  household: Household;
  members: Member[];
}) {
  const isOwner = household.myRole === "owner";

  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {members.map((member) => {
        const isMe = member.userId === household.myUserId;
        const fields = { householdId: household.id, userId: member.userId };
        return (
          <li
            key={member.userId}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Avatar aria-hidden="true">
                <AvatarFallback>{initials(member.displayName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="truncate type-card-title">
                    {member.displayName}
                    {isMe ? (
                      <span className="type-secondary"> (you)</span>
                    ) : null}
                  </span>
                  {member.role === "owner" ? (
                    <Badge variant="info">Owner</Badge>
                  ) : null}
                </p>
                <p className="type-timestamp">
                  Joined {formatDateTime(member.joinedAt, household.timezone)}
                </p>
              </div>
            </div>

            {isOwner && !isMe ? (
              <div className="flex flex-wrap gap-2">
                <ConfirmActionDialog
                  triggerLabel="Make owner"
                  triggerAriaLabel={`Make ${member.displayName} the owner`}
                  title={`Make ${member.displayName} the owner?`}
                  description={`${member.displayName} becomes the owner and you become a member. Only the owner can remove people, revoke other members' invite links and delete the household. Only ${member.displayName} could hand ownership back.`}
                  confirmLabel="Make owner"
                  pendingLabel="Handing over…"
                  action={transferOwnership}
                  fields={fields}
                />
                <ConfirmActionDialog
                  triggerLabel="Remove"
                  triggerAriaLabel={`Remove ${member.displayName}`}
                  title={`Remove ${member.displayName}?`}
                  description={`${member.displayName} loses access to this household straight away, and invite links they created stop working. Their name stays on past records. They could still rejoin with an active link someone else created, so revoke any they may have.`}
                  confirmLabel="Remove"
                  pendingLabel="Removing…"
                  destructive
                  action={removeMember}
                  fields={fields}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
