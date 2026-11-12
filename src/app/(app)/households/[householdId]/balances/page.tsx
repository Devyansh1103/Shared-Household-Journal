import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon, PlusIcon, ScaleIcon } from "lucide-react";
import { Amount } from "@/components/amount";
import { BalanceAmount, BalanceBadge } from "@/components/balance";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { SettlementNotice } from "@/components/settlement-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { balanceDirection } from "@/domain/money/balances";
import {
  balanceSentence,
  formula,
  pairPhrase,
  paidBackSentence,
  paidSentence,
  personLabel,
  receivedBackSentence,
  shareSentence,
  type Subject,
} from "@/lib/balances/explain";
import type { BalancePerson } from "@/lib/balances/parse";
import { getBalances } from "@/lib/balances/queries";
import { BalancesUnavailable } from "./balances-unavailable";

export const metadata: Metadata = { title: "Balances" };

const ZERO = BigInt(0);

export default function BalancesPage({
  params,
}: PageProps<"/households/[householdId]/balances">) {
  return (
    <PageContainer className="space-y-8">
      <Suspense fallback={<BalancesSkeleton />}>
        <Balances params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function Balances({
  params,
}: Pick<PageProps<"/households/[householdId]/balances">, "params">) {
  const { householdId } = await params;
  const view = await getBalances(householdId);
  const { household } = view;
  const base = `/households/${household.id}`;

  const header = (
    <PageHeader
      title="Balances"
      description={`Who has paid what for ${household.name}, and who owes whom, worked out from the expenses and recorded payments each time you look. The app keeps the record; it doesn't move money.`}
    />
  );

  if (!view.ok) {
    return (
      <div className="space-y-8">
        {header}
        <BalancesUnavailable
          householdId={household.id}
          reason={view.reason}
          expenseId={view.expenseId}
        />
      </div>
    );
  }

  const { balances } = view;
  // With no expenses but a recorded payment (say, after the expenses were
  // deleted, D8), there's still a balance to show.
  if (balances.expenseCount === 0 && balances.settlementCount === 0) {
    return (
      <div className="space-y-8">
        {header}
        <EmptyState
          icon={<ScaleIcon />}
          title="No balances yet"
          description="Everyone is settled up. Once someone adds a shared expense, you'll see who paid what and who owes whom here."
          action={
            <Button asChild>
              <Link href={`${base}/expenses/new`}>
                <PlusIcon aria-hidden="true" data-icon="inline-start" />
                Add expense
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const currency = household.currencyCode;
  const me = household.myUserId;
  const people = new Map(balances.people.map((p) => [p.userId, p]));
  const mine = people.get(me);
  if (!mine) notFound();

  const subject = (userId: string): Subject => ({
    you: userId === me,
    name: people.get(userId)?.displayName ?? "Former member",
  });
  const sum = (pick: (p: BalancePerson) => bigint) =>
    balances.people.reduce((total, p) => total + pick(p), ZERO);
  // D9 and O9: you can record a payment you made or received, with someone
  // who's still a member.
  const active = new Set(
    balances.people.filter((p) => p.isActive).map((p) => p.userId),
  );
  const paidBack = paidBackSentence(subject(me), mine, currency);
  const receivedBack = receivedBackSentence(subject(me), mine, currency);

  return (
    <div className="space-y-8">
      {header}

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="type-section-title">Your balance</h2>
            <BalanceBadge direction={balanceDirection(mine.netMinor)} />
          </div>
          <div className="space-y-1">
            <BalanceAmount
              netMinor={mine.netMinor}
              currency={currency}
              size="lg"
            />
            <p className="type-body">
              {balanceSentence(subject(me), mine.netMinor, currency)}
            </p>
          </div>
          <ul className="space-y-1 type-secondary">
            <li>{paidSentence(subject(me), mine, currency)}</li>
            <li>{shareSentence(subject(me), mine, currency)}</li>
            {paidBack ? <li>{paidBack}</li> : null}
            {receivedBack ? <li>{receivedBack}</li> : null}
            <li>{formula(mine, currency)}.</li>
          </ul>
          <Link
            href={`${base}/balances/${me}`}
            className="inline-flex items-center gap-1 rounded-md type-label text-primary underline-offset-4 hover:underline"
          >
            See the expenses behind it
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          </Link>
        </CardContent>
      </Card>

      <Section
        title="Who owes whom"
        description="Everyone owes the person who paid their share, and a recorded payment reduces what the payer owes. Between two people, what they owe each other cancels out."
      >
        {balances.pairs.length === 0 ? (
          <p className="type-body">Nobody owes anyone right now.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {balances.pairs.map((pair) => {
              // Open the pair from the viewer's side when they're in it.
              const mineToRecord =
                (pair.debtorId === me || pair.creditorId === me) &&
                active.has(pair.debtorId) &&
                active.has(pair.creditorId);
              const [owner, other] =
                pair.debtorId === me
                  ? [me, pair.creditorId]
                  : pair.creditorId === me
                    ? [me, pair.debtorId]
                    : [pair.debtorId, pair.creditorId];
              return (
                <li
                  key={`${pair.debtorId}-${pair.creditorId}`}
                  className="flex min-w-0 flex-wrap items-center"
                >
                  <Link
                    href={`${base}/balances/${owner}?with=${other}#with-${other}`}
                    className="flex min-w-0 flex-1 basis-64 items-center gap-3 p-4 hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1 type-label">
                      {pairPhrase(
                        subject(pair.debtorId),
                        subject(pair.creditorId),
                      )}
                    </span>
                    <Amount minor={pair.amountMinor} currency={currency} />
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="size-5 shrink-0 text-muted-foreground"
                    />
                  </Link>
                  {mineToRecord ? (
                    <div className="w-full px-4 pb-4 sm:w-auto sm:py-4 sm:pl-0">
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          href={`${base}/settlements/new?with=${other}`}
                          aria-label={`Record a payment ${pair.debtorId === me ? "to" : "from"} ${subject(other).name}`}
                        >
                          Record a payment
                        </Link>
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <SettlementNotice>
          When someone pays someone back outside the app, record it so the
          balances stay right.{" "}
          <Link
            href={`${base}/settlements`}
            className="rounded-sm text-primary underline underline-offset-4"
          >
            Settlements
          </Link>
        </SettlementNotice>
      </Section>

      <Section
        title="Everyone's balance"
        description={
          balances.settlementCount > 0
            ? "Balance = what someone paid − their share of the costs + what they paid back − what they were paid back. Positive means they should get money back; negative means they owe."
            : "Balance = what someone paid − their share of the costs. Positive means they should get money back; negative means they owe."
        }
      >
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {balances.people.map((person) => (
            <li key={person.userId} className="min-w-0">
              <Link
                href={`${base}/balances/${person.userId}`}
                className="flex items-center gap-3 p-4 hover:bg-muted"
              >
                {/* Two lines that each wrap rather than overlap when a long
                    name meets a large amount on a small screen. */}
                <span className="block min-w-0 flex-1 space-y-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="max-w-full min-w-0 truncate type-card-title">
                      {personLabel(person, me)}
                    </span>
                    <BalanceAmount
                      netMinor={person.netMinor}
                      currency={currency}
                    />
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="flex flex-wrap gap-x-3 type-secondary">
                      <span>
                        Paid{" "}
                        <Amount
                          minor={person.paidMinor}
                          currency={currency}
                          tone="muted"
                        />
                      </span>
                      <span>
                        Share{" "}
                        <Amount
                          minor={person.shareMinor}
                          currency={currency}
                          tone="muted"
                        />
                      </span>
                      {person.settlementsPaidCount > 0 ? (
                        <span>
                          Paid back{" "}
                          <Amount
                            minor={person.settlementsPaidMinor}
                            currency={currency}
                            tone="muted"
                          />
                        </span>
                      ) : null}
                      {person.settlementsReceivedCount > 0 ? (
                        <span>
                          Received back{" "}
                          <Amount
                            minor={person.settlementsReceivedMinor}
                            currency={currency}
                            tone="muted"
                          />
                        </span>
                      ) : null}
                    </span>
                    <BalanceBadge
                      direction={balanceDirection(person.netMinor)}
                    />
                  </span>
                </span>
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-5 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="How the numbers add up"
        description={
          balances.settlementCount > 0
            ? "Every figure here comes from the expenses and recorded payments. Deleted expenses and voided payments don't count."
            : "Every figure here comes from the expenses. Deleted expenses don't count."
        }
      >
        <Card>
          <CardContent className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Figure term="Expenses counted">
                <span className="type-amount">{balances.expenseCount}</span>
              </Figure>
              <Figure term="Total spent">
                <Amount minor={balances.totalMinor} currency={currency} />
              </Figure>
              <Figure term="Everyone's payments">
                <Amount minor={sum((p) => p.paidMinor)} currency={currency} />
              </Figure>
              <Figure term="Everyone's shares">
                <Amount minor={sum((p) => p.shareMinor)} currency={currency} />
              </Figure>
              {balances.settlementCount > 0 ? (
                <>
                  <Figure term="Payments recorded">
                    <span className="type-amount">
                      {balances.settlementCount}
                    </span>
                  </Figure>
                  <Figure term="Paid back in total">
                    <Amount
                      minor={balances.settlementTotalMinor}
                      currency={currency}
                    />
                  </Figure>
                </>
              ) : null}
              <Figure term="All balances together">
                <Amount minor={sum((p) => p.netMinor)} currency={currency} />
              </Figure>
            </dl>
            <p className="type-help">
              Payments and shares both add up to the total spent, and whatever
              someone is owed, someone else here owes, so the balances always
              add up to zero.
              {balances.settlementCount > 0
                ? " Recorded payments only move what's owed between two people, so they don't change the total spent."
                : ""}
            </p>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}

function Figure({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <dt className="type-label">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function BalancesSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading balances"
      className="space-y-6"
    >
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-40 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
