"use client";

import "./globals.css";

/**
 * Shown only when the root layout itself fails, in place of the whole page.
 * Like every error page here, it never shows the error: only the reference
 * (`digest`) that matches the server log line (src/instrumentation.ts).
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en-IN">
      <body className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
        <title>Something went wrong · Shared Household Journal</title>
        <main className="max-w-md space-y-4 rounded-xl border border-border bg-card p-6">
          <h1 className="type-page-title">Something went wrong</h1>
          <p className="type-body">
            We couldn&apos;t show this page. Nothing has been changed. Try
            again, or come back in a moment.
          </p>
          {error.digest ? (
            <p className="type-help">Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
