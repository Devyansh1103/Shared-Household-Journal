"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { cn } from "cn";
import { FormAlert } from "@/components/form-alert";
import { SettlementNotice } from "@/components/settlement-notice";
import { SubmitButton } from "@/components/submit-button";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { parseAmount } from "@/domain/money/amount";
import type { Subject } from "@/lib/balances/explain";
import { formatDate, formatMoney } from "@/lib/format";
import {
  NOTE_MAX_LENGTH,
  validateSettlementForm,
  type RawSettlementForm,
} from "@/lib/settlements/form";
import {
  outcomeSentence,
  overpaymentWarning,
  paymentSentence,
  settlementOutcome,
  standingSentence,
} from "@/lib/settlements/wording";
import type { SettlementFormState } from "./actions";

export type SettlementCounterpart = {
  userId: string;
  displayName: string;
  /**
   * Where the viewer stands with this person, from the viewer's side, as
   * signed minor units in text: positive when they owe the viewer, negative
   * when the viewer owes them. From the verified balances.
   */
  withMinor: string;
};

type SettlementFormProps = {
  action: (
    previous: SettlementFormState,
    formData: FormData,
  ) => Promise<SettlementFormState>;
  /** Hidden fields naming the household and this attempt; the server re-checks them. */
  hidden: { householdId: string; requestKey: string };
  viewerId: string;
  /** The other active members, in the order they joined. */
  others: SettlementCounterpart[];
  householdName: string;
  currency: string;
  exponent: number;
  defaults: RawSettlementForm;
};

type Errors = Partial<Record<keyof RawSettlementForm, string>>;

/**
 * "Record a payment": fill it in, check it, then record it (D9). The review
 * step shows who paid whom, how much and when, says what the record does to
 * the balances, and warns when the amount is more than what's owed. Nothing
 * here moves money.
 */
export function SettlementForm({
  action,
  hidden,
  viewerId,
  others,
  householdName,
  currency,
  exponent,
  defaults,
}: SettlementFormProps) {
  // Next.js keeps the previous page mounted (hidden) after navigating, so ids
  // must be unique per form.
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  const [stage, setStage] = useState<"edit" | "review">("edit");
  const [values, setValues] = useState<RawSettlementForm>(defaults);
  const [errors, setErrors] = useState<Errors>({});
  // Newer figures from the server (HJ017), by payer and recipient: they win
  // over the ones the page loaded with.
  const [latestOwed, setLatestOwed] = useState<Record<string, string>>({});
  const [owedChanged, setOwedChanged] = useState(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const firstField = useRef<HTMLSelectElement>(null);
  const focusOnStage = useRef(false);

  const [state, formAction] = useActionState(
    async (previous: SettlementFormState, formData: FormData) => {
      // A redirect rejects this promise; Next.js handles it, so don't catch.
      const result = await action(previous, formData);
      if (result.fieldErrors) {
        setErrors(result.fieldErrors);
        focusOnStage.current = true;
        setStage("edit");
      } else if (result.owedMinor !== undefined && result.raw) {
        const key = owedKey(result.raw, viewerId);
        if (key) {
          setLatestOwed((current) => ({
            ...current,
            [key]: result.owedMinor!,
          }));
        }
        setOwedChanged(true);
        focusOnStage.current = true;
        setStage("review");
      }
      return result;
    },
    { status: "idle" },
  );

  useEffect(() => {
    if (!focusOnStage.current) return;
    focusOnStage.current = false;
    if (stage === "review") reviewHeading.current?.focus();
    else firstField.current?.focus();
  }, [stage, state]);

  const other = others.find((o) => o.userId === values.otherUserId);
  const otherSubject: Subject | null = other
    ? { you: false, name: other.displayName }
    : null;
  const me: Subject = { you: true, name: "you" };
  const viewerPaid = values.direction !== "received";
  const [payer, recipient] = otherSubject
    ? viewerPaid
      ? [me, otherSubject]
      : [otherSubject, me]
    : [null, null];

  /** What the payer owes the recipient now, from the latest figures. */
  function owedNow(): bigint | null {
    if (!other) return null;
    const key = owedKey(values, viewerId);
    if (key && latestOwed[key] !== undefined) return BigInt(latestOwed[key]);
    const withMinor = BigInt(other.withMinor);
    return viewerPaid ? -withMinor : withMinor;
  }
  const owed = owedNow();
  const amount = parseAmount(values.amount, exponent);
  const outcome =
    owed !== null && amount.ok ? settlementOutcome(owed, amount.minor) : null;
  const over = outcome?.kind === "over";

  function set<K extends keyof RawSettlementForm>(key: K, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setOwedChanged(false);
  }

  function review(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateSettlementForm(values, {
      viewerId,
      memberIds: [viewerId, ...others.map((o) => o.userId)],
      exponent,
    });
    if (!result.ok) {
      setErrors(result.fieldErrors);
      return;
    }
    setErrors({});
    focusOnStage.current = true;
    setStage("review");
  }

  if (stage === "review" && payer && recipient && amount.ok && outcome) {
    const money = formatMoney(amount.minor, currency);
    const note = values.note.trim();
    return (
      <section aria-labelledby={fid("review")} className="space-y-5">
        <h2
          id={fid("review")}
          ref={reviewHeading}
          tabIndex={-1}
          className="type-section-title outline-none"
        >
          Check the payment
        </h2>

        {state.status === "error" && state.message ? (
          <FormAlert tone="error">{state.message}</FormAlert>
        ) : null}
        {owedChanged ? (
          <FormAlert tone="info">
            What&apos;s owed has changed since this page loaded. Someone may
            have just recorded a payment, so check the figures below again.
          </FormAlert>
        ) : null}

        <p className="type-body">
          {paymentSentence(payer, recipient, amount.minor, currency)}
        </p>

        <dl className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
          <ReviewItem term="Paid by">
            {payer.you ? "You" : payer.name}
          </ReviewItem>
          <ReviewItem term="Paid to">
            {recipient.you ? "You" : recipient.name}
          </ReviewItem>
          <ReviewItem term="Amount">
            <span className="type-amount">{money}</span>{" "}
            <span className="type-secondary">({currency})</span>
          </ReviewItem>
          <ReviewItem term="Date paid">
            {formatDate(values.settledOn)}
          </ReviewItem>
          <ReviewItem term="Note" className="sm:col-span-2">
            {note ? (
              <span className="wrap-break-word">{note}</span>
            ) : (
              <span className="type-secondary">No note</span>
            )}
          </ReviewItem>
        </dl>

        {over && owed !== null ? (
          <FormAlert tone="warning">
            {overpaymentWarning(payer, recipient, owed, currency)} You can still
            record it:{" "}
            {lowerFirst(outcomeSentence(payer, recipient, outcome, currency))}
          </FormAlert>
        ) : (
          <p className="type-body">
            {outcomeSentence(payer, recipient, outcome, currency)}
          </p>
        )}

        <SettlementNotice>
          Recording it updates the balances everyone in {householdName} sees.
          The app can&apos;t check that the money was actually paid.
        </SettlementNotice>

        <form action={formAction} className="flex flex-wrap gap-2">
          <input type="hidden" name="householdId" value={hidden.householdId} />
          <input type="hidden" name="requestKey" value={hidden.requestKey} />
          <input type="hidden" name="otherUserId" value={values.otherUserId} />
          <input type="hidden" name="direction" value={values.direction} />
          <input type="hidden" name="amount" value={values.amount} />
          <input type="hidden" name="settledOn" value={values.settledOn} />
          <input type="hidden" name="note" value={values.note} />
          {over && owed !== null ? (
            // D9: the warning shown was for this figure. If it has changed
            // by the time this is recorded, the server warns again.
            <input
              type="hidden"
              name="acknowledgedOwed"
              value={owed.toString()}
            />
          ) : null}
          <SubmitButton pendingLabel="Recording…">
            {over ? "Record anyway" : "Record payment"}
          </SubmitButton>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              focusOnStage.current = true;
              setStage("edit");
            }}
          >
            Change details
          </Button>
        </form>
      </section>
    );
  }

  const name = other?.displayName ?? "them";
  return (
    <form onSubmit={review} noValidate className="space-y-6">
      {state.status === "error" && state.message ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}

      <FieldGroup>
        <Field data-invalid={errors.otherUserId ? true : undefined}>
          <FieldLabel htmlFor={fid("other")}>
            Who was the payment with?
          </FieldLabel>
          <NativeSelect
            ref={firstField}
            id={fid("other")}
            className="w-full"
            value={values.otherUserId}
            onChange={(event) => set("otherUserId", event.target.value)}
            aria-invalid={errors.otherUserId ? true : undefined}
            aria-describedby={
              [
                other ? fid("standing") : null,
                errors.otherUserId ? fid("other-error") : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
          >
            <NativeSelectOption value="" disabled>
              Choose a person
            </NativeSelectOption>
            {others.map((o) => (
              <NativeSelectOption key={o.userId} value={o.userId}>
                {o.displayName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {other ? (
            <FieldDescription id={fid("standing")}>
              {standingSentence(
                { you: false, name: other.displayName },
                BigInt(other.withMinor),
                currency,
              )}
            </FieldDescription>
          ) : null}
          <FieldError id={fid("other-error")}>{errors.otherUserId}</FieldError>
        </Field>

        <FieldSet data-invalid={errors.direction ? true : undefined}>
          <FieldLegend variant="label">Who paid whom?</FieldLegend>
          <RadioGroup
            value={values.direction}
            onValueChange={(value) => set("direction", value)}
            aria-describedby={
              errors.direction ? fid("direction-error") : undefined
            }
          >
            <Field orientation="horizontal">
              <RadioGroupItem value="paid" id={fid("direction-paid")} />
              <FieldLabel
                htmlFor={fid("direction-paid")}
                className="font-normal"
              >
                You paid {name}
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <RadioGroupItem value="received" id={fid("direction-received")} />
              <FieldLabel
                htmlFor={fid("direction-received")}
                className="font-normal"
              >
                {other ? `${name} paid you` : "They paid you"}
              </FieldLabel>
            </Field>
          </RadioGroup>
          <FieldError id={fid("direction-error")}>
            {errors.direction}
          </FieldError>
        </FieldSet>

        <div className="space-y-2">
          <TextField
            id={fid("amount")}
            label={`Amount (${currency})`}
            description={
              exponent > 0
                ? `Up to ${exponent} decimal place${exponent === 1 ? "" : "s"}. Part of what's owed is fine.`
                : "A whole amount. Part of what's owed is fine."
            }
            inputMode={exponent > 0 ? "decimal" : "numeric"}
            autoComplete="off"
            className="type-amount"
            required
            value={values.amount}
            onChange={(event) => set("amount", event.target.value)}
            error={errors.amount}
          />
          {payer && recipient && outcome ? (
            <p
              aria-live="polite"
              className={over ? "type-label text-warning" : "type-secondary"}
            >
              {over && owed !== null
                ? `${overpaymentWarning(payer, recipient, owed, currency)} ${outcomeSentence(payer, recipient, outcome, currency)}`
                : outcomeSentence(payer, recipient, outcome, currency)}
            </p>
          ) : null}
        </div>

        <TextField
          id={fid("date")}
          type="date"
          label="Date paid"
          required
          value={values.settledOn}
          onChange={(event) => set("settledOn", event.target.value)}
          error={errors.settledOn}
        />

        <Field data-invalid={errors.note ? true : undefined}>
          <FieldLabel htmlFor={fid("note")}>Note (optional)</FieldLabel>
          <Textarea
            id={fid("note")}
            maxLength={NOTE_MAX_LENGTH}
            rows={2}
            value={values.note}
            onChange={(event) => set("note", event.target.value)}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={
              errors.note
                ? `${fid("note-help")} ${fid("note-error")}`
                : fid("note-help")
            }
          />
          <FieldDescription id={fid("note-help")}>
            Like &ldquo;Cash&rdquo; or &ldquo;Rent for November&rdquo;. Everyone
            in the household can see it. Up to {NOTE_MAX_LENGTH} characters.
          </FieldDescription>
          <FieldError id={fid("note-error")}>{errors.note}</FieldError>
        </Field>
      </FieldGroup>

      <SettlementNotice />

      <Button type="submit">Review payment</Button>
    </form>
  );
}

function ReviewItem({
  term,
  children,
  className,
}: {
  term: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <dt className="type-label">{term}</dt>
      <dd className="type-body">{children}</dd>
    </div>
  );
}

/** Payer and recipient as "<from>><to>", for the server's newer figures. */
function owedKey(
  values: Pick<RawSettlementForm, "otherUserId" | "direction">,
  viewerId: string,
): string | null {
  if (!values.otherUserId) return null;
  return values.direction === "received"
    ? `${values.otherUserId}>${viewerId}`
    : `${viewerId}>${values.otherUserId}`;
}

/** "After this, …" → "after this, …": only ever used on our own sentences. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
