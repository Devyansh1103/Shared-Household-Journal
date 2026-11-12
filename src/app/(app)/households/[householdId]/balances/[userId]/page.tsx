import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Amount } from "@/components/amount";
import { BalanceAmount, BalanceBadge } from "@/components/balance";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { SettlementNotice } from "@/components/settlement-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  balanceDirection,
  pairsFor,
  settlementOther,
} from "@/domain/money/balances";
import {
  absMinor,
  balanceSentence,
  combinedTotalSentence,
  entriesTotalSentence,
  formatBalance,
  pairLineSentence,
  pairPhrase,
  paidBackSentence,
  paidSentence,
  partTotalSentence,
  personLabel,
  plural,
  receivedBackSentence,
  shareLabel,
  shareSentence,
  workingSentence,
  type Subject,
} from "@/lib/balances/explain";
import { getBalances } from "@/lib/balances/queries";
import { formatDate } from "@/lib/format";
import { paymentSentence, paymentTitle } from "@/lib/settlements/wording";
import { BalancesUnavailable } from "../balances-unavailable";

export const metadata: Metadata = { title: "Balance" };

const ZERO = BigInt(0);

export default function PersonBalancePage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/balances/[userId]">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<PersonSkeleton />}>
        <PersonBalance params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function PersonBalance({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/balances/[userId]">) {
  const { householdId, userId } = await params;
  const [view, query] = await Promise.all([
    getBalances(householdId, userId),
    searchParams,
  ]);
  const { household } = view;
  const base = `/households/${household.id}`;

  const back = (
    <Link
      href={`${base}/balances`}
      className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      Balances
    </Link>
  );

  if (!view.ok) {
    return (
      <>
        {back}
        <PageHeader title="Balance" />
        <BalancesUnavailable
          householdId={household.id}
          reason={view.reason}
          expenseId={view.expenseId}
        />
      </>
    );
  }

  const { balances, focus, complete } = view;
  if (!focus) notFound(); // getBalances already 404s for anyone else

  const currency = household.currencyCode;
  const me = household.myUserId;
  const people = new Map(balances.people.map((p) => [p.userId, p]));
  const subject = (id: string): Subject => ({
    you: id === me,
    name: people.get(id)?.displayName ?? "Former member",
  });
  const who = subject(focus.userId);
  const whose = who.you ? "your" : `${focus.displayName}'s`;
  const openWith = typeof query.with === "string" ? query.with : null;
  const pairs = pairsFor(balances.pairs, focus.userId);
  const { entries, settlementEntries } = balances;
  const hasPayments = balances.settlementEntryCount > 0;
  const paidBack = paidBackSentence(who, focus, currency);
  const receivedBack = receivedBackSentence(who, focus, currency);
  const expensesNet = focus.paidMinor - focus.shareMinor;
  const paymentsNet =
    focus.settlementsPaidMinor - focus.settlementsReceivedMinor;
  // D9 and O9: you record payments you made or received, with someone who's
  // still a member.
  const canRecordWith = (otherId: string) =>
    who.you &&
    focus.isActive &&
    people.get(otherId)?.isActive === true &&
    otherId !== me;

  return (
    <>
      {back}

      <header className="space-y-3">
        <BalanceBadge direction={balanceDirection(focus.netMinor)} />
        <h1 className="type-page-title">
          {who.you ? "Your balance" : `${focus.displayName}'s balance`}
        </h1>
        <BalanceAmount
          netMinor={focus.netMinor}
          currency={currency}
          size="lg"
        />
        <p className="type-body">
          {balanceSentence(who, focus.netMinor, currency)}
        </p>
      </header>

      {focus.isActive ? null : (
        <FormAlert tone="info">
          {focus.displayName} has left the household. Their past expenses still
          count. Deleting an expense they were part of changes their balance,
          and settling up with someone who has left isn&apos;t possible in the
          app yet.
        </FormAlert>
      )}

      <Section
        title="How it's worked out"
        description={
          hasPayments
            ? "Balance = what was paid − the share of the costs + what was paid back − what was received back. Positive means money back; negative means money owed."
            : "Balance = what was paid − the share of the costs. Positive means money back; negative means money owed."
        }
      >
        <Card>
          <CardContent>
            <ul className="space-y-2 type-body">
              <li>{paidSentence(who, focus, currency)}</li>
              <li>{shareSentence(who, focus, currency)}</li>
              {paidBack ? <li>{paidBack}</li> : null}
              {receivedBack ? <li>{receivedBack}</li> : null}
              <li>{workingSentence(who, focus, currency)}</li>
            </ul>
          </CardContent>
        </Card>
      </Section>

      <Section
        title={`Between ${who.you ? "you" : focus.displayName} and others`}
        description={
          hasPayments
            ? "What each person owes the other cancels out, and recorded payments reduce it. Open one to see what's behind it."
            : "What each person owes the other cancels out. Open one to see the expenses behind it."
        }
      >
        {pairs.length === 0 ? (
          <p className="type-body">
            {who.you
              ? "You don't owe anyone, and nobody owes you."
              : `${focus.displayName} doesn't owe anyone, and nobody owes ${focus.displayName}.`}
          </p>
        ) : (
          <div className="space-y-2">
            {pairs.map(({ otherId, minor }) => {
              const other = subject(otherId);
              const lines = entries.flatMap((entry) =>
                entry.counterparts
                  .filter((c) => c.userId === otherId)
                  .map((c) => ({ entry, minor: c.minor })),
              );
              const payments = settlementEntries.filter(
                (s) => settlementOther(s, focus.userId) === otherId,
              );
              return (
                <details
                  key={otherId}
                  id={`with-${otherId}`}
                  open={openWith === otherId}
                  className="group rounded-xl border border-border bg-card"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-4 group-open:rounded-b-none hover:bg-muted [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1 type-label">
                      {minor > ZERO
                        ? pairPhrase(other, who)
                        : pairPhrase(who, other)}
                    </span>
                    <Amount minor={absMinor(minor)} currency={currency} />
                    <ChevronDownIcon
                      aria-hidden="true"
                      className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {lines.map(({ entry, minor: lineMinor }) => (
                      <li key={entry.expenseId} className="space-y-1 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <Link
                            href={`${base}/expenses/${entry.expenseId}`}
                            className="min-w-0 truncate rounded-sm type-label text-primary underline-offset-4 hover:underline"
                          >
                            {entry.description}
                          </Link>
                          <span className="shrink-0">
                            <span className="sr-only">Effect: </span>
                            <BalanceAmount
                              netMinor={lineMinor}
                              currency={currency}
                            />
                          </span>
                        </div>
                        <p className="type-secondary">
                          {formatDate(entry.expenseDate)} ·{" "}
                          {pairLineSentence(
                            who,
                            other,
                            entry.amountMinor,
                            lineMinor,
                            currency,
                          )}
                        </p>
                      </li>
                    ))}
                    {payments.map((payment) => (
                      <PaymentLine
                        key={payment.settlementId}
                        href={`${base}/settlements/${payment.settlementId}`}
                        payer={subject(payment.fromUserId)}
                        recipient={subject(payment.toUserId)}
                        amountMinor={payment.amountMinor}
                        netMinor={payment.netMinor}
                        settledOn={payment.settledOn}
                        currency={currency}
                        compact
                      />
                    ))}
                  </ul>
                  <div className="space-y-3 border-t border-border p-4">
                    <p className="type-help">
                      {!complete
                        ? hasPayments
                          ? "Only the newest expenses and payments are listed here. The amount above includes all of them."
                          : "Only the newest expenses are listed here. The amount above includes all of them."
                        : payments.length === 0
                          ? `${plural(lines.length, "expense")} between them, adding up to ${formatBalance(minor, currency)} from ${whose} side.`
                          : `${plural(lines.length, "expense")} and ${plural(payments.length, "recorded payment")} between them, adding up to ${formatBalance(minor, currency)} from ${whose} side.`}
                    </p>
                    {canRecordWith(otherId) ? (
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          href={`${base}/settlements/new?with=${otherId}`}
                          aria-label={`Record a payment ${minor < ZERO ? "to" : "from"} ${other.name}`}
                        >
                          Record a payment
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title={`Expenses behind ${whose} balance`}
        description={`Every counted expense ${who.you ? "you paid for or have" : `${focus.displayName} paid for or has`} a share in, newest first. Deleted expenses don't count.`}
      >
        {entries.length === 0 ? (
          <p className="type-body">
            {who.you
              ? "You haven't paid for or shared any expenses yet."
              : `${focus.displayName} hasn't paid for or shared any expenses yet.`}
          </p>
        ) : (
          <div className="space-y-3">
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {entries.map((entry) => {
                const payer = people.get(entry.paidBy);
                const payerName =
                  entry.paidBy === me
                    ? "you"
                    : payer
                      ? personLabel(payer, me)
                      : "Former member";
                return (
                  <li key={entry.expenseId} className="space-y-1 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`${base}/expenses/${entry.expenseId}`}
                        className="min-w-0 truncate rounded-sm type-card-title text-primary underline-offset-4 hover:underline"
                      >
                        {entry.description}
                      </Link>
                      <span className="shrink-0">
                        <span className="sr-only">Effect on the balance: </span>
                        <BalanceAmount
                          netMinor={entry.netMinor}
                          currency={currency}
                        />
                      </span>
                    </div>
                    <p className="flex flex-wrap gap-x-2 type-secondary">
                      <span>{formatDate(entry.expenseDate)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Paid by {payerName}:{" "}
                        <Amount
                          minor={entry.amountMinor}
                          currency={currency}
                          tone="muted"
                        />
                      </span>
                    </p>
                    <p className="type-secondary">
                      {shareLabel(who)}:{" "}
                      <Amount
                        minor={entry.shareMinor}
                        currency={currency}
                        tone="muted"
                      />
                    </p>
                  </li>
                );
              })}
            </ul>
            <p className="type-help">
              {!complete
                ? `Showing the newest ${entries.length} of ${balances.entryCount} expenses. The figures above include all of them.`
                : hasPayments
                  ? partTotalSentence(entries.length, expensesNet, currency)
                  : entriesTotalSentence(
                      who,
                      entries.length,
                      focus.netMinor,
                      currency,
                    )}
            </p>
          </div>
        )}
      </Section>

      {hasPayments ? (
        <Section
          title={`Payments behind ${whose} balance`}
          description={`Every recorded payment ${who.you ? "you" : focus.displayName} made or received, newest first. Voided payments don't count.`}
        >
          <div className="space-y-3">
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {settlementEntries.map((payment) => (
                <PaymentLine
                  key={payment.settlementId}
                  href={`${base}/settlements/${payment.settlementId}`}
                  payer={subject(payment.fromUserId)}
                  recipient={subject(payment.toUserId)}
                  amountMinor={payment.amountMinor}
                  netMinor={payment.netMinor}
                  settledOn={payment.settledOn}
                  currency={currency}
                />
              ))}
            </ul>
            <p className="type-help">
              {complete
                ? `${partTotalSentence(settlementEntries.length, paymentsNet, currency)} ${combinedTotalSentence(who, focus.netMinor, currency)}`
                : `Showing the newest ${settlementEntries.length} of ${balances.settlementEntryCount} payments. The figures above include all of them.`}
            </p>
            <SettlementNotice />
          </div>
        </Section>
      ) : null}
    </>
  );
}

/** One recorded payment and what it does to the focus person's balance. */
function PaymentLine({
  href,
  payer,
  recipient,
  amountMinor,
  netMinor,
  settledOn,
  currency,
  compact = false,
}: {
  href: string;
  payer: Subject;
  recipient: Subject;
  amountMinor: bigint;
  netMinor: bigint;
  settledOn: string;
  currency: string;
  /** Inside a pair: a smaller title. */
  compact?: boolean;
}) {
  return (
    <li className="space-y-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={href}
          className={cn(
            "min-w-0 truncate rounded-sm text-primary underline-offset-4 hover:underline",
            compact ? "type-label" : "type-card-title",
          )}
        >
          {paymentTitle(payer, recipient)}
        </Link>
        <span className="shrink-0">
          <span className="sr-only">Effect on the balance: </span>
          <BalanceAmount netMinor={netMinor} currency={currency} />
        </span>
      </div>
      <p className="type-secondary">
        {formatDate(settledOn)} ·{" "}
        {paymentSentence(payer, recipient, amountMinor, currency)}
      </p>
    </li>
  );
}

function PersonSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading balance"
      className="space-y-6"
    >
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-56 max-w-full" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
