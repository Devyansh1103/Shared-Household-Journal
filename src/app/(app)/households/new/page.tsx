import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { io } from "next/cache";
import { ArrowLeftIcon } from "lucide-react";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import {
  currencyOptions,
  DEFAULT_CURRENCY,
  timeZoneOptions,
} from "@/lib/households/options";
import { CreateHouseholdForm } from "./create-household-form";

export const metadata: Metadata = { title: "Create a household" };

export default function NewHouseholdPage() {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Link
        href="/home"
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Your households
      </Link>
      <PageHeader
        title="Create a household"
        description="A household is the shared space for the people you live with. You'll be its owner, and you can invite others once it's set up."
      />
      <Suspense fallback={<FormSkeleton fields={3} label="Loading form" />}>
        <NewHousehold />
      </Suspense>
    </PageContainer>
  );
}

async function NewHousehold() {
  await requireUser();
  // A fresh key per visit to this page, so resubmitting the same form can't
  // create a second household.
  await io();
  const requestKey = randomUUID();

  return (
    <Card>
      <CardContent>
        <CreateHouseholdForm
          requestKey={requestKey}
          currencies={currencyOptions()}
          timeZones={timeZoneOptions()}
          defaultCurrency={DEFAULT_CURRENCY}
        />
      </CardContent>
    </Card>
  );
}
