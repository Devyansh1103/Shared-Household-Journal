import Link from "next/link";
import { HouseIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

// One answer for "doesn't exist" and "you're not a member", so household ids
// can't be probed.
export default function HouseholdNotFound() {
  return (
    <EmptyState
      icon={<HouseIcon />}
      title="We couldn't find that household"
      description="It may have been deleted, or you may not be a member of it."
      action={
        <Button asChild>
          <Link href="/home">Go to your households</Link>
        </Button>
      }
    />
  );
}
