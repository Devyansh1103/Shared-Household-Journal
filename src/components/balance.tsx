import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  CircleCheckIcon,
} from "lucide-react";
import { Amount } from "@/components/amount";
import { Badge } from "@/components/ui/badge";
import {
  balanceDirection,
  type BalanceDirection,
} from "@/domain/money/balances";
import { DIRECTION_LABELS } from "@/lib/balances/explain";

const BADGES = {
  owed: { icon: ArrowDownLeftIcon, variant: "success" },
  owes: { icon: ArrowUpRightIcon, variant: "warning" },
  settled: { icon: CircleCheckIcon, variant: "outline" },
} as const;

const TONES = {
  owed: "positive",
  owes: "negative",
  settled: "neutral",
} as const;

/** "Owed", "Owes" or "Settled up": an icon and a word, never colour alone. */
export function BalanceBadge({
  direction,
  className,
}: {
  direction: BalanceDirection;
  className?: string;
}) {
  const { icon: Icon, variant } = BADGES[direction];
  return (
    <Badge variant={variant} className={className}>
      <Icon aria-hidden="true" data-icon="inline-start" />
      {DIRECTION_LABELS[direction]}
    </Badge>
  );
}

/** A balance with its sign (+₹600.00 / -₹300.00 / ₹0.00), toned by direction. */
export function BalanceAmount({
  netMinor,
  currency,
  size,
  className,
}: {
  netMinor: bigint;
  currency: string;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <Amount
      minor={netMinor}
      currency={currency}
      tone={TONES[balanceDirection(netMinor)]}
      signDisplay="exceptZero"
      size={size}
      className={className}
    />
  );
}
