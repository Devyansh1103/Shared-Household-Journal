import { Suspense } from "react";
import type { Metadata } from "next";
import { HouseIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-alert";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getMyProfile } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Home" };

export default function HomePage({ searchParams }: PageProps<"/home">) {
  return (
    <PageContainer className="space-y-8">
      <Suspense fallback={<Skeleton className="h-9 w-72 max-w-full" />}>
        <Welcome searchParams={searchParams} />
      </Suspense>
      {/* Households arrive in Phase 6. Nothing here pretends one exists. */}
      <EmptyState
        icon={<HouseIcon />}
        title="You're not in a household yet"
        description="Creating a household and inviting the people you live with is coming soon."
      />
    </PageContainer>
  );
}

async function Welcome({
  searchParams,
}: Pick<PageProps<"/home">, "searchParams">) {
  const [profile, params] = await Promise.all([getMyProfile(), searchParams]);
  return (
    <div className="space-y-4">
      {params.confirmed === "1" ? (
        <FormAlert tone="success">
          Your email is confirmed. Welcome aboard!
        </FormAlert>
      ) : null}
      <PageHeader
        title={`Welcome, ${profile.displayName}`}
        description="This is your home base for shared costs, bills and chores."
      />
    </div>
  );
}
