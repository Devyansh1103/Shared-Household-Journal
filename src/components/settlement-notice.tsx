import { InfoIcon } from "lucide-react";
import { cn } from "cn";
import { SETTLEMENT_NOTICE } from "@/lib/settlements/wording";

/**
 * D9: every settlement surface says "Recorded in the app — no money is
 * moved." An icon and the words, so it never relies on colour.
 */
export function SettlementNotice({
  className,
  children,
}: {
  className?: string;
  /** More context after the notice, in the same paragraph. */
  children?: React.ReactNode;
}) {
  return (
    <p className={cn("flex items-start gap-2 type-secondary", className)}>
      <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="font-medium text-foreground">{SETTLEMENT_NOTICE}</span>
        {children ? <> {children}</> : null}
      </span>
    </p>
  );
}
