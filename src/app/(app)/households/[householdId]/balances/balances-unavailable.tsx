import Link from "next/link";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";

/**
 * Shown instead of any figures when the balances don't pass their checks:
 * a wrong balance is never shown as if it were right.
 */
export function BalancesUnavailable({
  householdId,
  reason,
  expenseId,
}: {
  householdId: string;
  reason: "not_reconciled" | "not_verified";
  expenseId: string | null;
}) {
  return (
    <ErrorState
      title="Balances can't be shown right now"
      description={
        reason === "not_reconciled"
          ? "An expense's shares don't add up to its amount, so any balance worked out from it would be wrong. Nothing has been changed."
          : "The figures didn't pass the checks that make sure every balance adds up, so they aren't shown. Nothing has been changed. Reload the page to try again."
      }
      action={
        reason === "not_reconciled" && expenseId ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/households/${householdId}/expenses/${expenseId}`}>
              Open the expense
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
}
