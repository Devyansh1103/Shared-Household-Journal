import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  HandCoinsIcon,
  PlusIcon,
} from "lucide-react";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { SettlementNotice } from "@/components/settlement-notice";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { getHousehold, listMembersInJoinOrder } from "@/lib/households/queries";
import {
  listSettlements,
  SETTLEMENT_LIST_LIMIT,
  VOIDED_LIST_LIMIT,
  type SettlementItem,
} from "@/lib/settlements/queries";
import { paymentTitle, personSubject } from "@/lib/settlements/wording";

export const metadata: Metadata = { title: "Settlements" };

export default function SettlementsPage({
  params,
}: PageProps<"/households/[householdId]/settlements">) {
  return (
    <PageContainer className="space-y-8">
      <Suspense fallback={<ListSkeleton />}>
        <Settlements params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function Settlements({
  params,
}: Pick<PageProps<"/households/[householdId]/settlements">, "params">) {
  const { householdId } = await params;
  const household = await getHousehold(householdId);
  const [list, members] = await Promise.all([
    listSettlements(household.id),
    listMembersInJoinOrder(household.id),
  ]);
  const base = `/households/${household.id}`;
  // D9: a payment is between two people, so there must be someone else.
  const canRecord = members.length > 1;

  const recordButton = canRecord ? (
    <Button asChild>
      <Link href={`${base}/settlements/new`}>
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        Record a payment
      </Link>
    </Button>
  ) : undefined;

  const rows = (items: SettlementItem[]) => (
    <SettlementRows
      items={items}
      base={base}
      currency={household.currencyCode}
      viewerId={household.myUserId}
    />
  );

  return (
    <div className="space-y-8">
      <Link
        href={`${base}/balances`}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Balances
      </Link>

      <PageHeader
        title="Settlements"
        description={`Payments people in ${household.name} have recorded making to each other, newest first.`}
        actions={list.recorded.length > 0 ? recordButton : undefined}
      />

      <SettlementNotice>
        A recorded payment counts towards balances straight away. It can&apos;t
        be edited: if one is wrong, open it, void it and record it again.
      </SettlementNotice>

      {list.recorded.length === 0 && list.voided.length === 0 ? (
        <EmptyState
          icon={<HandCoinsIcon />}
          title="No payments recorded yet"
          description={
            canRecord
              ? "When someone pays someone back outside the app, record it here so the balances stay right."
              : "Once someone else joins the household, you can record payments between you here."
          }
          action={recordButton}
        />
      ) : list.recorded.length === 0 ? (
        <div className="space-y-4">
          <p className="type-body">
            No recorded payments count right now. Voided ones are listed below.
          </p>
          {recordButton ? <div>{recordButton}</div> : null}
        </div>
      ) : (
        <div className="space-y-3">
          {rows(list.recorded)}
          {list.recordedTruncated ? (
            <p className="type-help">
              Showing the latest {SETTLEMENT_LIST_LIMIT} payments. Balances
              include all of them.
            </p>
          ) : null}
        </div>
      )}

      {list.voided.length > 0 ? (
        <Section
          title="Voided payments"
          description="These don't count towards balances. They stay listed so the record is complete."
        >
          {rows(list.voided)}
          {list.voidedTruncated ? (
            <p className="type-help">
              Showing the {VOIDED_LIST_LIMIT} most recently voided payments.
            </p>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

function SettlementRows({
  items,
  base,
  currency,
  viewerId,
}: {
  items: SettlementItem[];
  base: string;
  currency: string;
  viewerId: string;
}) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {items.map((settlement) => {
        const voided = settlement.voidedAt !== null;
        const recorder = personSubject(settlement.recordedBy, viewerId);
        return (
          <li key={settlement.id} className="min-w-0">
            <Link
              href={`${base}/settlements/${settlement.id}`}
              className="flex items-center gap-3 p-4 hover:bg-muted"
            >
              <span className="block min-w-0 flex-1 space-y-1">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 truncate type-card-title">
                    {paymentTitle(
                      personSubject(settlement.payer, viewerId),
                      personSubject(settlement.recipient, viewerId),
                    )}
                  </span>
                  {voided ? (
                    <StatusBadge status="neutral">Voided</StatusBadge>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 type-secondary">
                  <span>Paid {formatDate(settlement.settledOn)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="min-w-0 truncate">
                    Recorded by {recorder.you ? "you" : recorder.name}
                  </span>
                </span>
                {settlement.note ? (
                  <span className="block truncate type-secondary">
                    {settlement.note}
                  </span>
                ) : null}
              </span>
              <Amount
                minor={settlement.amountMinor}
                currency={currency}
                tone={voided ? "muted" : "neutral"}
                className={voided ? "line-through" : undefined}
              />
              <ChevronRightIcon
                aria-hidden="true"
                className="size-5 shrink-0 text-muted-foreground"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading settlements"
      className="space-y-6"
    >
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-9 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
