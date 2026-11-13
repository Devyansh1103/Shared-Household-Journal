import Link from "next/link";
import { ShoppingBasketIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

// One answer for "doesn't exist" and "not in your household".
export default function ItemNotFound() {
  return (
    <EmptyState
      icon={<ShoppingBasketIcon />}
      title="We couldn't find that item"
      description="It may be in another household, or the link may be wrong."
      action={
        <Button asChild>
          <Link href="/home">Go to your households</Link>
        </Button>
      }
    />
  );
}
