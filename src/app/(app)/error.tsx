"use client";

import { ErrorState } from "@/components/error-state";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";

// Shown when a signed-in page fails to load its data. The error itself is never
// displayed: it may contain provider details.
export default function AppError({ retry }: { retry: () => void }) {
  return (
    <PageContainer>
      <ErrorState
        description="We couldn't load this page. Check your connection and try again."
        action={
          <Button variant="outline" size="sm" onClick={() => retry()}>
            Try again
          </Button>
        }
      />
    </PageContainer>
  );
}
