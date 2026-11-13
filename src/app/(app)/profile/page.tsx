import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { BellIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormSkeleton } from "@/components/form-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Section } from "@/components/layout/section";
import { SubmitButton } from "@/components/submit-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { getMyProfile, requireUser } from "@/lib/auth/session";
import { initials } from "@/lib/initials";
import { signOut } from "../actions";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Your profile" };

export default function ProfilePage() {
  return (
    <PageContainer className="max-w-prose-narrow space-y-8">
      <PageHeader
        title="Your profile"
        description="Your name is what the people in your households see."
      />
      <Suspense
        fallback={<FormSkeleton fields={1} label="Loading your profile" />}
      >
        <ProfileDetails />
      </Suspense>
      <Section
        title="Notifications"
        description="Choose what you're notified about in each household. Notifications appear in the app only."
      >
        <div>
          <Button variant="outline" asChild>
            <Link href="/profile/notifications">
              <BellIcon aria-hidden="true" data-icon="inline-start" />
              Notification settings
            </Link>
          </Button>
        </div>
      </Section>
      <Section
        title="Sign out"
        description="Signs you out on this device only."
      >
        <form action={signOut}>
          <SubmitButton variant="outline" pendingLabel="Signing out…">
            Sign out
          </SubmitButton>
        </form>
      </Section>
    </PageContainer>
  );
}

async function ProfileDetails() {
  const [user, profile] = await Promise.all([requireUser(), getMyProfile()]);

  return (
    <Card>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar size="lg" aria-hidden="true">
            <AvatarFallback>{initials(profile.displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate type-card-title">{profile.displayName}</p>
            <p className="truncate type-secondary">{user.email}</p>
          </div>
        </div>
        <ProfileForm displayName={profile.displayName} email={user.email} />
      </CardContent>
    </Card>
  );
}
