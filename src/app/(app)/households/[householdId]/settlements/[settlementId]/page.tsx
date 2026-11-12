import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "cn";
import { Amount } from "@/components/amount";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { Section } from "@/components/layout/section";
import { SettlementNotice } from "@/components/settlement-notice";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { getSettlement } from "@/lib/settlements/queries";
import {
  paymentTitle,
  personSubject,
  recordedSentence,
} from "@/lib/settlements/wording";
import { voidSettlement } from "../actions";

export const metadata: Metadata = { title: "Payment" };

export default function SettlementPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/settlements/[settlementId]">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<DetailSkeleton />}>
        <SettlementDetail params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function SettlementDetail({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/settlements/[settlementId]">) {
  const { householdId, settlementId } = await params;
  const [{ household, settlement }, query] = await Promise.all([
    getSettlement(householdId, settlementId),
    searchParams,
  ]);
  const me = household.myUserId;
  const tz = household.timezone;
  const currency = household.currencyCode;
  const base = `/households/${household.id}`;
  const voided = settlement.voidedAt !== null;

  const payer = personSubject(settlement.payer, me);
  const recipient = personSubject(settlement.recipient, me);
  const recorder = personSubject(settlement.recordedBy, me);
  const recorderPaid = settlement.recordedBy.userId === settlement.payer.userId;
  const who = (subject: { you: boolean; name: string }) =>
    subject.you ? "You" : subject.name;
  const money = formatMoney(settlement.amountMinor, currency);
  const formerName = !settlement.payer.isActive
    ? settlement.payer.displayName
    : !settlement.recipient.isActive
      ? settlement.recipient.displayName
      : null;
  // D9: a voided payment is put right by recording it again, which only the
  // payer or the recipient can do, and only while both are members (O9).
  const viewerPaid = settlement.payer.userId === me;
  const otherId = viewerPaid
    ? settlement.recipient.userId
    : settlement.payer.userId;
  const recordAgain =
    voided && settlement.viewerIsParty && !settlement.involvesFormerMember
      ? `${base}/settlements/new?with=${otherId}&direction=${viewerPaid ? "paid" : "received"}&amount=${settlement.amountMinor}`
      : null;

  return (
    <>
      <Link
        href={`${base}/settlements`}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Settlements
      </Link>

      {query.recorded === "1" && !voided ? (
        <FormAlert tone="success">
          The payment is recorded, and everyone&apos;s balances now include it.{" "}
          <Link
            href={`${base}/balances`}
            className="rounded-sm text-primary underline underline-offset-4"
          >
            See balances
          </Link>
        </FormAlert>
      ) : null}
      {voided && settlement.voidedBy ? (
        <FormAlert tone="info">
          Voided by{" "}
          {personSubject(settlement.voidedBy, me).you
            ? "you"
            : personSubject(settlement.voidedBy, me).name}{" "}
          on {formatDateTime(settlement.voidedAt!, tz)}. It no longer counts
          towards anyone&apos;s balance.
        </FormAlert>
      ) : null}

      <header className="space-y-3">
        {voided ? (
          <StatusBadge status="neutral">Voided</StatusBadge>
        ) : (
          <StatusBadge status="success">Recorded</StatusBadge>
        )}
        <h1 className="type-page-title">{paymentTitle(payer, recipient)}</h1>
        <Amount
          minor={settlement.amountMinor}
          currency={currency}
          size="lg"
          tone={voided ? "muted" : "neutral"}
          className={voided ? "line-through" : undefined}
        />
        <p className="type-body">
          {recordedSentence(
            { ...recorder, isPayer: recorderPaid },
            recorderPaid ? recipient : payer,
            BigInt(settlement.amountMinor),
            currency,
          )}
        </p>
      </header>

      <SettlementNotice>
        The app doesn&apos;t check that the money was actually paid.
      </SettlementNotice>

      <Card>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Item term="Paid by">{who(payer)}</Item>
            <Item term="Paid to">{who(recipient)}</Item>
            <Item term="Date paid">{formatDate(settlement.settledOn)}</Item>
            <Item term="Amount">
              <span className="type-amount">{money}</span>{" "}
              <span className="type-secondary">({currency})</span>
            </Item>
            <Item term="Recorded by">{who(recorder)}</Item>
            <Item term="Recorded on">
              {formatDateTime(settlement.createdAt, tz)}
            </Item>
            {voided && settlement.voidedBy ? (
              <>
                <Item term="Voided by">
                  {who(personSubject(settlement.voidedBy, me))}
                </Item>
                <Item term="Voided on">
                  {formatDateTime(settlement.voidedAt!, tz)}
                </Item>
              </>
            ) : null}
            <Item term="Note" className="sm:col-span-2">
              {settlement.note ? (
                <span className="wrap-break-word">{settlement.note}</span>
              ) : (
                <span className="type-secondary">No note</span>
              )}
            </Item>
          </dl>
        </CardContent>
      </Card>

      {voided ? null : (
        <p className="type-help">
          It counts towards both people&apos;s balances: it reduces what{" "}
          {payer.you ? "you owe" : `${payer.name} owes`}{" "}
          {recipient.you ? "you" : recipient.name} by {money}.{" "}
          <Link
            href={`${base}/balances`}
            className="rounded-sm text-primary underline underline-offset-4"
          >
            See balances
          </Link>
        </p>
      )}

      {settlement.canVoid ? (
        <Section
          title="Void this payment"
          description="A payment can't be edited. If it's wrong, void it and record it again."
        >
          <div>
            <ConfirmActionDialog
              triggerLabel="Void payment"
              title={`Void this ${money} payment?`}
              description={
                <>
                  It stops counting straight away, so the balances go back to
                  how they were without it. It stays listed as voided, and
                  voiding can&apos;t be undone.
                  {formerName
                    ? ` ${formerName} has left the household, so their balance will change, and settling up with someone who has left isn't possible in the app yet.`
                    : ""}
                </>
              }
              confirmLabel="Void payment"
              cancelLabel="Keep payment"
              pendingLabel="Voiding…"
              destructive
              action={voidSettlement}
              fields={{
                householdId: household.id,
                settlementId: settlement.id,
              }}
            />
          </div>
        </Section>
      ) : null}

      {recordAgain ? (
        <Section
          title="Put it right"
          description="If this payment was wrong, record the correct one. The voided one stays listed."
        >
          <div>
            <Button variant="outline" asChild>
              <Link href={recordAgain}>Record it again</Link>
            </Button>
          </div>
        </Section>
      ) : null}
    </>
  );
}

function Item({
  term,
  children,
  className,
}: {
  term: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <dt className="type-label">{term}</dt>
      <dd className="type-body">{children}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading payment"
      className="space-y-6"
    >
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
