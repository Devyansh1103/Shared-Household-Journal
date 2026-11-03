import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

// Reached from the password-reset email: /auth/confirm signs the person in
// with a recovery session, then sends them here.
export default function ResetPasswordPage() {
  return (
    <PageContainer className="max-w-md space-y-8">
      <PageHeader title="Choose a new password" />
      <Card>
        <CardContent>
          <NewPasswordForm />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
