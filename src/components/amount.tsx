import { cn } from "cn";
import { formatMoney } from "@/lib/format";

const toneClasses = {
  neutral: "text-foreground",
  positive: "text-success",
  negative: "text-destructive",
  muted: "text-muted-foreground",
} as const;

type AmountProps = {
  /** Integer minor units (ADR-003). */
  minor: bigint | number;
  /** ISO 4217 code, e.g. "INR". */
  currency: string;
  /**
   * Colour hint only. Always pair a tone with words that state the direction,
   * e.g. "You are owed" / "You owe" — colour must never carry meaning alone.
   */
  tone?: keyof typeof toneClasses;
  size?: "md" | "lg";
  signDisplay?: "auto" | "never" | "always" | "exceptZero";
  className?: string;
};

export function Amount({
  minor,
  currency,
  tone = "neutral",
  size = "md",
  signDisplay,
  className,
}: AmountProps) {
  return (
    <span
      className={cn(
        size === "lg" ? "type-amount-lg" : "type-amount",
        toneClasses[tone],
        className,
      )}
    >
      {formatMoney(minor, currency, { signDisplay })}
    </span>
  );
}
