import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import { ArrowLeftIcon } from "lucide-react";
import { z } from "zod";
import { FormAlert } from "@/components/form-alert";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { todayIn } from "@/lib/expenses/dates";
import { currencyExponent } from "@/lib/format";
import { getHousehold, listMembersInJoinOrder } from "@/lib/households/queries";
import { getMyWaitingReceipt } from "@/lib/receipts/queries";
import { ReceiptScanner } from "./receipt-scanner";

export const metadata: Metadata = { title: "Scan a receipt" };

export default function ScanReceiptPage({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/expenses/scan">) {
  return (
    <PageContainer className="space-y-8">
      <Suspense fallback={<FormSkeleton fields={2} label="Loading" />}>
        <ScanReceipt params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function ScanReceipt({
  params,
  searchParams,
}: PageProps<"/households/[householdId]/expenses/scan">) {
  const [{ householdId }, query] = await Promise.all([params, searchParams]);
  const household = await getHousehold(householdId);
  const members = await listMembersInJoinOrder(household.id);
  // A fresh key per visit, so confirming twice records one expense; "today"
  // in the household's timezone (D11).
  await io();
  const requestKey = randomUUID();
  const today = todayIn(household.timezone);

  // Coming back to an upload of yours that's still waiting for review.
  const asked = z.uuid().safeParse(query.receipt);
  const waiting = asked.success
    ? await getMyWaitingReceipt(household.id, asked.data)
    : null;
  const base = `/households/${household.id}/expenses`;

  return (
    <>
      <Link
        href={base}
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Expenses
      </Link>
      <PageHeader
        title="Scan a receipt"
        description={`Add an expense to ${household.name} from a receipt. You check every detail before it's saved, and the receipt stays attached to the expense. Nothing moves any money.`}
      />
      {asked.success && !waiting ? (
        <FormAlert tone="info">
          That receipt isn&apos;t waiting for review any more. It may be on an
          expense already, discarded, or cleared after a day unused. Scan it
          again, or{" "}
          <Link
            href={`${base}/new`}
            className="rounded-sm text-primary underline underline-offset-4"
          >
            add the expense by hand
          </Link>
          .
        </FormAlert>
      ) : null}
      <ReceiptScanner
        key={waiting?.id ?? "new"}
        householdId={household.id}
        currency={household.currencyCode}
        exponent={currencyExponent(household.currencyCode)}
        today={today}
        members={members.map(({ userId, displayName }) => ({
          userId,
          displayName,
        }))}
        blank={{
          description: "",
          amount: "",
          category: "",
          expenseDate: today,
          paidBy: household.myUserId,
          splitMethod: "equal",
          participants: members.map((m) => m.userId),
          shares: {},
          percents: {},
        }}
        requestKey={requestKey}
        resumeReceiptId={waiting?.id ?? null}
      />
    </>
  );
}
