import Link from "next/link";
import { HouseIcon } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 items-center">
      <PageContainer className="max-w-prose-narrow">
        <div className="space-y-4">
          <span
            className="flex size-12 items-center justify-center rounded-xl bg-info-subtle text-info"
            aria-hidden="true"
          >
            <HouseIcon className="size-6" />
          </span>
          <h1 className="type-page-title">Shared Household Journal</h1>
          <p className="type-body text-muted-foreground">
            A calm place for the people you live with to keep track of shared
            costs, bills, chores and the shopping list — so everyone can see how
            things stand.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild size="lg">
              <Link href="/sign-up">Create an account</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
          {process.env.NODE_ENV !== "production" ? (
            <p className="type-secondary">
              <Link
                href="/dev/design-system"
                className="font-medium text-primary underline underline-offset-4"
              >
                View the design system
              </Link>{" "}
              (development only)
            </p>
          ) : null}
        </div>
      </PageContainer>
    </main>
  );
}
