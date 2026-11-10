import Link from "next/link";
import { ReceiptIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

// One answer for "doesn't exist", "another household's" and "not a member".
export default function ExpenseNotFound() {
  return (
    <EmptyState
      icon={<ReceiptIcon />}
      title="We couldn't find that expense"
      description="It may be in a household you're not a member of, or the link may be wrong."
      action={
        <Button asChild>
          <Link href="/home">Go to your households</Link>
        </Button>
      }
    />
  );
}
