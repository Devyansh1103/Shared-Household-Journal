import Link from "next/link";
import { CalendarClockIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

// One answer for "doesn't exist" and "not in your household".
export default function BillNotFound() {
  return (
    <EmptyState
      icon={<CalendarClockIcon />}
      title="We couldn't find that bill"
      description="It may be in another household, or the link may be wrong."
      action={
        <Button asChild>
          <Link href="/home">Go to your households</Link>
        </Button>
      }
    />
  );
}
