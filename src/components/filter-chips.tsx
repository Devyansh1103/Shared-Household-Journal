import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { cn } from "cn";

export type FilterChip = {
  key: string;
  href: string;
  label: string;
  active: boolean;
};

/**
 * Links, not a form: each view has its own URL. The current one is marked
 * with aria-current, a check and a heavier weight, not colour alone.
 */
export function FilterChips({
  label,
  chips,
}: {
  /** Names the group for assistive technology, like "Show on the list". */
  label: string;
  chips: FilterChip[];
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              href={chip.href}
              aria-current={chip.active ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 type-label hover:bg-muted",
                chip.active &&
                  "border-info bg-info-subtle font-semibold text-info hover:bg-info-subtle",
              )}
            >
              {chip.active ? (
                <CheckIcon aria-hidden="true" className="size-4" />
              ) : null}
              {chip.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
