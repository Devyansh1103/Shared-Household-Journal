import Link from "next/link";
import { HandCoinsIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

// One answer for "doesn't exist", "another household's" and "not a member".
export default function SettlementNotFound() {
  return (
    <EmptyState
      icon={<HandCoinsIcon />}
      title="We couldn't find that payment"
      description="It may be in a household you're not a member of, or the link may be wrong."
      action={
        <Button asChild>
          <Link href="/home">Go to your households</Link>
        </Button>
      }
    />
  );
}
