import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ChevronDownIcon } from "lucide-react";
import { Amount } from "@/components/amount";
import { BalanceAmount, BalanceBadge } from "@/components/balance";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { balanceDirection, pairsFor } from "@/domain/money/balances";
import {
  absMinor,
  balanceSentence,
  entriesTotalSentence,
  formatBalance,
  pairLineSentence,
  pairPhrase,
  paidSentence,
  personLabel,
  plural,
  shareLabel,
  shareSentence,
  workingSentence,
  type Subject,
} from "@/lib/balances/explain";
import { getBalances } from "@/lib/balances/queries";
import { formatDate } from "@/lib/format";
import { BalancesUnavailable } from "../balances-unavailable";

export const metadata: Metadata = { title: "Balance" };

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
  const { entries } = balances;

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
        description="Balance = what was paid − the share of the costs. Positive means money back; negative means money owed."
      >
        <Card>
          <CardContent>
            <ul className="space-y-2 type-body">
              <li>{paidSentence(who, focus, currency)}</li>
              <li>{shareSentence(who, focus, currency)}</li>
              <li>{workingSentence(who, focus, currency)}</li>
            </ul>
          </CardContent>
        </Card>
      </Section>

      <Section
        title={`Between ${who.you ? "you" : focus.displayName} and others`}
        description="What each person owes the other cancels out. Open one to see the expenses behind it."
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
              return (
                <details
                  key={otherId}
                  id={`with-${otherId}`}
                  open={openWith === otherId}
                  className="group rounded-xl border border-border bg-card"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-4 group-open:rounded-b-none hover:bg-muted [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1 type-label">
                      {minor > BigInt(0)
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
                  </ul>
                  <p className="border-t border-border p-4 type-help">
                    {complete
                      ? `${plural(lines.length, "expense")} between them, adding up to ${formatBalance(minor, currency)} from ${whose} side.`
                      : "Only the newest expenses are listed here. The amount above includes all of them."}
                  </p>
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
              {complete
                ? entriesTotalSentence(
                    who,
                    entries.length,
                    focus.netMinor,
                    currency,
                  )
                : `Showing the newest ${entries.length} of ${balances.entryCount} expenses. The figures above include all of them.`}
            </p>
          </div>
        )}
      </Section>
    </>
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
