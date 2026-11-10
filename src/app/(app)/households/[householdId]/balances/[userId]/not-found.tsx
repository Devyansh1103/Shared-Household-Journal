import Link from "next/link";
import { ScaleIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

// One answer for a wrong link, someone who isn't part of this household's
// balances, and a household the viewer isn't in.
export default function BalanceNotFound() {
  return (
    <EmptyState
      icon={<ScaleIcon />}
      title="We couldn't find that balance"
      description="It may be in a household you're not a member of, or the link may be wrong."
      action={
        <Button asChild>
          <Link href="/home">Go to your households</Link>
        </Button>
      }
    />
  );
}
