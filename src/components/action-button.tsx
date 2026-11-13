"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { SubmitButton } from "@/components/submit-button";
import type { Button } from "@/components/ui/button";
import { initialFormState, type FormState } from "@/lib/auth/form-state";

/**
 * A one-tap Server Action, like marking something done. No confirmation:
 * what it does can be undone with the opposite button. The success message
 * is toasted; an error shows under the button.
 */
export function ActionButton({
  action,
  fields,
  children,
  pendingLabel,
  ariaLabel,
  variant = "outline",
  icon,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  /** Hidden fields naming what it's about. The server re-checks all of them. */
  fields: Record<string, string>;
  children: React.ReactNode;
  pendingLabel: string;
  /** Must contain the visible words (WCAG 2.5.3), like "Mark bought: Milk". */
  ariaLabel?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  icon?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(
    async (previous: FormState, formData: FormData) => {
      const result = await action(previous, formData);
      if (result.status === "success" && result.message) {
        toast.success(result.message);
      }
      return result;
    },
    initialFormState,
  );

  return (
    <form action={formAction} className="contents">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton
        variant={variant}
        size="sm"
        pendingLabel={pendingLabel}
        aria-label={ariaLabel}
      >
        {icon}
        {children}
      </SubmitButton>
      {state.status === "error" && state.message ? (
        <p role="alert" className="basis-full type-help text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
