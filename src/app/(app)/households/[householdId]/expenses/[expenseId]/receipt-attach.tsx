"use client";

import { useState, useTransition } from "react";
import { FormAlert } from "@/components/form-alert";
import {
  ReceiptPicker,
  type UploadedReceipt,
} from "@/components/receipts/receipt-picker";
import { Button } from "@/components/ui/button";
import { attachReceipt } from "../actions";

/**
 * Attach a receipt to an existing expense, or replace its receipt (D31: the
 * expense's creator, payer or the owner). Nothing is read from it: the
 * expense's details stay exactly as they are.
 */
export function ReceiptAttach({
  householdId,
  expenseId,
  replacing,
}: {
  householdId: string;
  expenseId: string;
  replacing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function attach(receipt: UploadedReceipt) {
    const form = new FormData();
    form.set("householdId", householdId);
    form.set("expenseId", expenseId);
    form.set("receiptId", receipt.receiptId);
    startTransition(async () => {
      const result = await attachReceipt({ status: "idle" }, form);
      setMessage({
        tone: result.status === "success" ? "success" : "error",
        text: result.message ?? "Something went wrong. Try again.",
      });
      if (result.status === "success") setOpen(false);
    });
  }

  return (
    <div className="space-y-3">
      {message ? (
        <FormAlert tone={message.tone}>{message.text}</FormAlert>
      ) : null}
      {open ? (
        <>
          <ReceiptPicker
            householdId={householdId}
            actionLabel={replacing ? "Replace receipt" : "Attach receipt"}
            onUploaded={attach}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setMessage(null);
            setOpen(true);
          }}
          disabled={pending}
        >
          {pending
            ? "Attaching…"
            : replacing
              ? "Replace receipt"
              : "Add a receipt"}
        </Button>
      )}
    </div>
  );
}
