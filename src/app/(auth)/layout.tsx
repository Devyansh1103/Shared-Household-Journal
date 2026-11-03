import Link from "next/link";
import { HouseIcon } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent } from "@/components/ui/card";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 items-start sm:items-center">
      <PageContainer className="max-w-md">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 rounded-md type-card-title"
        >
          <span
            className="flex size-8 items-center justify-center rounded-lg bg-info-subtle text-info"
            aria-hidden="true"
          >
            <HouseIcon className="size-4" />
          </span>
          Shared Household Journal
        </Link>
        <Card>
          <CardContent>{children}</CardContent>
        </Card>
      </PageContainer>
    </main>
  );
}
