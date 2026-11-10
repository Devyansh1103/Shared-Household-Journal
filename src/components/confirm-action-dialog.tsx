"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { initialFormState, type FormState } from "@/lib/auth/form-state";

type ConfirmActionDialogProps = {
  triggerLabel: string;
  /** Accessible name for the trigger when the visible label needs context, e.g. "Remove Nina". */
  triggerAriaLabel?: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  /** Names the safe choice, e.g. "Keep expense". Focused when the dialog opens. */
  cancelLabel?: string;
  pendingLabel: string;
  destructive?: boolean;
  /** A Server Action. It may redirect; otherwise its success message is toasted and the dialog closes. */
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  /** Hidden fields naming what the action is about. The server re-checks all of them. */
  fields: Record<string, string>;
};

/** A button that asks for confirmation, then runs a Server Action. */
export function ConfirmActionDialog({
  triggerLabel,
  triggerAriaLabel,
  triggerVariant = "outline",
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  pendingLabel,
  destructive = false,
  action,
  fields,
}: ConfirmActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    async (previous: FormState, formData: FormData) => {
      // A redirect rejects this promise; Next.js handles it, so don't catch.
      const result = await action(previous, formData);
      if (result.status === "success") {
        setOpen(false);
        if (result.message) toast.success(result.message);
      }
      return result;
    },
    initialFormState,
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size="sm"
          aria-label={triggerAriaLabel}
        >
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action={formAction} className="contents">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {state.status === "error" && state.message ? (
            <FormAlert tone="error">{state.message}</FormAlert>
          ) : null}
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <AlertDialogFooter>
            <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
            <SubmitButton
              variant={destructive ? "destructive" : "default"}
              pendingLabel={pendingLabel}
            >
              {confirmLabel}
            </SubmitButton>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
