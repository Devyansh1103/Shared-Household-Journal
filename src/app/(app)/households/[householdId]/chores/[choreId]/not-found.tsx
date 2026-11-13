import Link from "next/link";
import { ListChecksIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

// One answer for "doesn't exist" and "not in your household".
export default function ChoreNotFound() {
  return (
    <EmptyState
      icon={<ListChecksIcon />}
      title="We couldn't find that chore"
      description="It may be in another household, or the link may be wrong."
      action={
        <Button asChild>
          <Link href="/home">Go to your households</Link>
        </Button>
      }
    />
  );
}
