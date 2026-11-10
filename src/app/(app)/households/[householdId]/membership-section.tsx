import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Section } from "@/components/layout/section";
import type { Household } from "@/lib/households/queries";
import { deleteHousehold, leaveHousehold } from "../actions";

/** Leaving (D13) and, for an owner on their own, deleting (D14). */
export function MembershipSection({
  household,
  memberCount,
}: {
  household: Household;
  memberCount: number;
}) {
  const fields = { householdId: household.id };

  if (household.myRole === "member") {
    return (
      <Section
        title="Leave this household"
        description="You can leave once your balance is zero. You'll lose access straight away, your name stays on past records, and invite links you created stop working."
      >
        <div>
          <ConfirmActionDialog
            triggerLabel="Leave household"
            title={`Leave ${household.name}?`}
            description="You'll lose access to this household straight away. To come back, you'll need a new invite link."
            confirmLabel="Leave household"
            pendingLabel="Leaving…"
            destructive
            action={leaveHousehold}
            fields={fields}
          />
        </div>
      </Section>
    );
  }

  if (memberCount > 1) {
    return (
      <Section
        title="Leave this household"
        description="As the owner, you can leave once you've made another member the owner. Use “Make owner” next to their name."
      />
    );
  }

  return (
    <Section
      title="Delete this household"
      description="You're the only member. Deleting the household removes it, its invite links and its history for good."
    >
      <div>
        <ConfirmActionDialog
          triggerLabel="Delete household"
          title={`Delete ${household.name}?`}
          description="This permanently deletes the household, its invite links and its history. It can't be undone."
          confirmLabel="Delete for good"
          pendingLabel="Deleting…"
          destructive
          action={deleteHousehold}
          fields={fields}
        />
      </div>
    </Section>
  );
}
