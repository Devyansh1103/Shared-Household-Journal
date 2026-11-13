import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BellOffIcon } from "lucide-react";
import { listMyHouseholds } from "@/lib/households/queries";
import { getMutedCategories } from "@/lib/notifications/queries";
import { PreferencesForm } from "./preferences-form";

export const metadata: Metadata = { title: "Notification settings" };

export default function NotificationSettingsPage() {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <Link
        href="/profile"
        className="inline-flex items-center gap-1.5 rounded-md type-label text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Your profile
      </Link>
      <PageHeader
        title="Notification settings"
        description="Notifications appear in the app only (the bell at the top). Nothing is emailed or pushed to your phone. You get them for what concerns you: an expense you share, a payment with you, a chore or item assigned to you, members and budgets. Never for what you did yourself."
      />
      <Suspense
        fallback={<FormSkeleton fields={7} label="Loading your settings" />}
      >
        <Settings />
      </Suspense>
    </PageContainer>
  );
}

async function Settings() {
  const [households, muted] = await Promise.all([
    listMyHouseholds(),
    getMutedCategories(),
  ]);
  if (households.length === 0) {
    return (
      <EmptyState
        icon={<BellOffIcon />}
        title="No households yet"
        description="Notifications are set per household. Create or join one first."
        action={
          <Button asChild>
            <Link href="/households/new">Create a household</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="space-y-6">
      {households.map((household) => (
        <Card key={household.id}>
          <CardContent>
            <PreferencesForm
              householdId={household.id}
              householdName={household.name}
              muted={[...(muted.get(household.id) ?? [])]}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
