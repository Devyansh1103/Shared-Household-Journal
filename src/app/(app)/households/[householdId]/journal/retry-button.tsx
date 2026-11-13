"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Loads the journal again from the server (router.refresh), keeping the URL
 * and so the same filter and page. Disabled, with a spinner, while it runs.
 */
export function RetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? (
        <>
          <Spinner aria-hidden="true" data-icon="inline-start" />
          Trying again…
        </>
      ) : (
        "Try again"
      )}
    </Button>
  );
}
