import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import { ArrowLeftIcon, UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MAX_AMOUNT_MINOR } from "@/domain/money/amount";
import { pairsFor } from "@/domain/money/balances";
import { getBalances } from "@/lib/balances/queries";
import { todayIn } from "@/lib/expenses/dates";
import { currencyExponent, minorToDecimalString } from "@/lib/format";
import { listMembersInJoinOrder } from "@/lib/households/queries";
import { DIRECTIONS, type Direction } from "@/lib/settlements/form";
import { BalancesUnavailable } from "../../balances/balances-unavailable";
import { recordSettlement } from "../actions";
import { SettlementForm } from "../settlement-form";

export const metadata: Metadata = { title: "Record a payment" };

const ZERO = BigInt(0);

export default function NewSettlementPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/settlements/new">) {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Suspense fallback={<FormSkeleton fields={5} label="Loading form" />}>
        <NewSettlement params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function NewSettlement({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/settlements/new">) {
  const { householdId } = await params;
  // The verified balances: what each person owes the viewer, for the
  // standing, the default amount and D9's warning.
  const [view, query] = await Promise.all([
    getBalances(householdId),
    searchParams,
  ]);
  const { household } = view;
  const base = `/households/${household.id}`;

  const top = (
    <>
      <Link
        href={`${base}/settlements`}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Settlements
      </Link>
      <PageHeader
        title="Record a payment"
        description={`Record money one person in ${household.name} paid another outside the app, so the balances stay right.`}
      />
    </>
  );

  // Recording needs balances that add up: record_settlement refuses
  // otherwise (HJ013), and the figures shown here would be wrong.
  if (!view.ok) {
    return (
      <>
        {top}
        <BalancesUnavailable
          householdId={household.id}
          reason={view.reason}
          expenseId={view.expenseId}
        />
      </>
    );
  }

  const me = household.myUserId;
  // O9: only active members can be in a new settlement.
  const members = await listMembersInJoinOrder(household.id);
  const standing = new Map(
    pairsFor(view.balances.pairs, me).map((p) => [p.otherId, p.minor]),
  );
  const others = members
    .filter((m) => m.userId !== me)
    .map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      withMinor: (standing.get(m.userId) ?? ZERO).toString(),
    }));

  if (others.length === 0) {
    return (
      <>
        {top}
        <EmptyState
          icon={<UsersIcon />}
          title="There's no one to record a payment with yet"
          description="A payment is between two people in the household. Invite the people you live with first."
          action={
            <Button asChild>
              <Link href={base}>Invite someone</Link>
            </Button>
          }
        />
      </>
    );
  }

  // Defaults from the link (a balance, or a voided payment recorded again).
  // Untrusted: anything that isn't valid is ignored, and the server checks
  // whatever is submitted.
  const exponent = currencyExponent(household.currencyCode);
  const withParam = typeof query.with === "string" ? query.with : "";
  const other =
    others.find((o) => o.userId === withParam) ??
    (others.length === 1 ? others[0] : undefined);
  const withMinor = other ? BigInt(other.withMinor) : ZERO;
  const directionParam =
    typeof query.direction === "string" &&
    (DIRECTIONS as readonly string[]).includes(query.direction)
      ? (query.direction as Direction)
      : undefined;
  // Whoever owes pays: if they owe the viewer, the viewer received it.
  const direction: Direction =
    directionParam ?? (withMinor > ZERO ? "received" : "paid");
  const amountParam =
    typeof query.amount === "string" && /^[1-9][0-9]{0,11}$/.test(query.amount)
      ? BigInt(query.amount)
      : null;
  // Otherwise the whole of what's owed that way, which can be changed.
  const owedThatWay = direction === "paid" ? -withMinor : withMinor;
  const defaultMinor = amountParam ?? (owedThatWay > ZERO ? owedThatWay : null);

  // A fresh key per visit, so resubmitting can't record the payment twice;
  // and "today" in the household's timezone (D11).
  await io();
  const requestKey = randomUUID();
  const today = todayIn(household.timezone);

  return (
    <>
      {top}
      <Card>
        <CardContent>
          <SettlementForm
            action={recordSettlement}
            hidden={{ householdId: household.id, requestKey }}
            viewerId={me}
            others={others}
            householdName={household.name}
            currency={household.currencyCode}
            exponent={exponent}
            defaults={{
              otherUserId: other?.userId ?? "",
              direction,
              amount:
                defaultMinor !== null && defaultMinor <= MAX_AMOUNT_MINOR
                  ? minorToDecimalString(defaultMinor, exponent)
                  : "",
              settledOn: today,
              note: "",
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
