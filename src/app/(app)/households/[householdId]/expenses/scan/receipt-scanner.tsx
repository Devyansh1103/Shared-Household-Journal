"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { FormAlert } from "@/components/form-alert";
import {
  ReceiptPicker,
  type UploadedReceipt,
} from "@/components/receipts/receipt-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { RawExpenseForm } from "@/lib/expenses/form";
import { extractReceipt, type ReceiptExtraction } from "@/lib/receipts/extract";
import { OcrError, ocrErrorMessage, runOcr } from "@/lib/receipts/ocr";
import { prefillFrom } from "@/lib/receipts/review";
import { tesseractEngine } from "@/lib/receipts/tesseract";
import { createExpenseFromReceipt, discardReceipt } from "../actions";
import { ExpenseForm, type FormMember } from "../expense-form";
import { ReceiptDetails } from "./receipt-details";

// Scan a receipt (roadmap Phase 19, D31): choose or photograph it, upload it
// (checked on the server, kept privately), read it on this device, then check
// everything in the usual expense form. The expense is created only when the
// person confirms the form; reading never creates anything, and if reading
// fails or is skipped the form is still there to fill in by hand.

type Stage =
  | { kind: "choose" }
  | { kind: "loading" }
  | { kind: "reading"; progress: number }
  | { kind: "review"; extraction: ReceiptExtraction }
  | { kind: "manual"; message: string | null };

export function ReceiptScanner({
  householdId,
  currency,
  exponent,
  today,
  members,
  blank,
  requestKey,
  resumeReceiptId,
}: {
  householdId: string;
  currency: string;
  exponent: number;
  today: string;
  members: FormMember[];
  blank: RawExpenseForm;
  requestKey: string;
  resumeReceiptId: string | null;
}) {
  const [stage, setStage] = useState<Stage>(
    resumeReceiptId ? { kind: "loading" } : { kind: "choose" },
  );
  const [receiptId, setReceiptId] = useState<string | null>(resumeReceiptId);
  const [image, setImage] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const reading = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Leaving the page stops any reading in progress.
  useEffect(() => () => reading.current?.abort(), []);
  // A replaced image's local URL is released.
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  async function read(blob: Blob) {
    reading.current?.abort();
    const controller = new AbortController();
    reading.current = controller;
    setStage({ kind: "reading", progress: 0 });
    try {
      const result = await runOcr(tesseractEngine, blob, {
        signal: controller.signal,
        onProgress: (fraction) =>
          setStage({ kind: "reading", progress: fraction }),
      });
      if (controller.signal.aborted) return;
      setStage({
        kind: "review",
        extraction: extractReceipt(result.lines, { currency, exponent, today }),
      });
    } catch (problem) {
      if (reading.current !== controller) return;
      const kind = problem instanceof OcrError ? problem.kind : "failed";
      setStage({ kind: "manual", message: ocrErrorMessage(kind) });
    }
  }

  function show(blob: Blob) {
    setImage(blob);
    setImageUrl(URL.createObjectURL(blob));
  }

  // Coming back to a receipt waiting for review: fetch its image and read it.
  useEffect(() => {
    if (!resumeReceiptId) return;
    let stopped = false;
    fetch(`/api/receipts/${resumeReceiptId}`)
      .then((response) =>
        response.ok ? response.blob() : Promise.reject(new Error()),
      )
      .then((blob) => {
        if (stopped) return;
        show(blob);
        void read(blob);
      })
      .catch(() => {
        if (!stopped) {
          setStage({
            kind: "manual",
            message:
              "The receipt's image couldn't be loaded. Fill in the details yourself.",
          });
        }
      });
    return () => {
      stopped = true;
    };
    // Once, for the receipt in the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeReceiptId]);

  function uploaded(receipt: UploadedReceipt) {
    setNotice(null);
    setReceiptId(receipt.receiptId);
    show(receipt.image);
    // What OCR reads: the lossless copy (also for reading again).
    setImage(receipt.ocrImage);
    // Reload-safe: the address names the receipt now.
    window.history.replaceState(null, "", `?receipt=${receipt.receiptId}`);
    void read(receipt.ocrImage);
  }

  if (stage.kind === "choose" || !receiptId) {
    return (
      <div className="max-w-prose-narrow space-y-4">
        {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}
        <ReceiptPicker
          householdId={householdId}
          actionLabel="Read receipt"
          onUploaded={uploaded}
        />
        <p className="type-help">
          The receipt is read on this device; it isn&apos;t sent to any reading
          or AI service. It&apos;s stored privately with your household, and
          only you can see it until it&apos;s on an expense.
        </p>
      </div>
    );
  }

  const prefill = prefillFrom(
    stage.kind === "review" ? stage.extraction : null,
    blank,
    exponent,
  );
  const formReady = stage.kind === "review" || stage.kind === "manual";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="min-w-0 space-y-6">
        {imageUrl ? (
          <figure className="space-y-2">
            {/* A local copy of the uploaded image (blob: URL). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="The receipt you uploaded"
              className="max-h-[32rem] w-full rounded-xl border border-border bg-muted object-contain"
            />
            <figcaption className="type-help">
              The receipt you uploaded.
            </figcaption>
          </figure>
        ) : null}
        {stage.kind === "review" ? (
          <ReceiptDetails
            extraction={stage.extraction}
            currency={currency}
            exponent={exponent}
          />
        ) : null}
      </div>

      <div className="min-w-0 space-y-4">
        {stage.kind === "loading" ? (
          <p role="status" className="type-secondary">
            Loading the receipt…
          </p>
        ) : null}
        {stage.kind === "reading" ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <p className="type-label" id="reading-label">
              Reading the receipt on this device…
            </p>
            <progress
              className="h-2 w-full"
              max={100}
              value={Math.round(stage.progress * 100)}
              aria-labelledby="reading-label"
            />
            <p className="type-help">
              The first time can take a little longer.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  reading.current?.abort();
                  reading.current = null;
                  setStage({ kind: "manual", message: null });
                }}
              >
                Stop and fill in myself
              </Button>
            </div>
          </div>
        ) : null}

        {stage.kind === "manual" && stage.message ? (
          <FormAlert tone="warning">{stage.message}</FormAlert>
        ) : null}
        {stage.kind === "manual" && image ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void read(image)}
          >
            Read the receipt again
          </Button>
        ) : null}

        {formReady ? (
          <Card>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <h2 className="type-section-title">
                  Check and save the expense
                </h2>
                <p className="type-help">
                  {stage.kind === "review" &&
                  (prefill.fromReceipt.description ||
                    prefill.fromReceipt.amount ||
                    prefill.fromReceipt.date)
                    ? `Filled in from the receipt: ${[
                        prefill.fromReceipt.description && "the description",
                        prefill.fromReceipt.amount && "the amount",
                        prefill.fromReceipt.date && "the date",
                      ]
                        .filter(Boolean)
                        .join(
                          ", ",
                        )}. Check them, then choose the category, who paid and how it's split. Nothing is saved until you create the expense.`
                    : "Fill in the expense. The receipt is attached when you create it."}
                </p>
                {stage.kind === "review" ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() => setStage({ kind: "manual", message: null })}
                  >
                    Ignore what was read and fill in myself
                  </Button>
                ) : null}
              </div>
              <ExpenseForm
                key={stage.kind}
                action={createExpenseFromReceipt}
                hidden={{ householdId, receiptId, requestKey }}
                members={members}
                currency={currency}
                exponent={exponent}
                defaults={prefill.defaults}
                submitLabel="Create expense"
                pendingLabel="Creating…"
              />
            </CardContent>
          </Card>
        ) : null}

        <div>
          <ConfirmActionDialog
            triggerLabel="Discard receipt"
            triggerVariant="ghost"
            title="Discard this receipt?"
            description="The receipt is deleted and no expense is created."
            confirmLabel="Discard receipt"
            cancelLabel="Keep it"
            pendingLabel="Discarding…"
            destructive
            action={async (previous, formData) => {
              const result = await discardReceipt(previous, formData);
              if (result.status === "success") {
                setNotice(result.message ?? "The receipt is discarded.");
                // Back to choosing a receipt; the address no longer names it.
                reading.current?.abort();
                reading.current = null;
                setReceiptId(null);
                setImage(null);
                setImageUrl(null);
                setStage({ kind: "choose" });
                window.history.replaceState(null, "", window.location.pathname);
                // Said on the page, not in a toast that disappears.
                return { status: "success" };
              }
              return result;
            }}
            fields={{ householdId, receiptId }}
          />
        </div>
      </div>
    </div>
  );
}
