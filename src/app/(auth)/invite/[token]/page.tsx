import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormSkeleton } from "@/components/form-skeleton";
import { Button } from "@/components/ui/button";
import { signInPath } from "@/lib/auth/return-path";
import { getCurrentUser } from "@/lib/auth/session";
import { INVITE_INVALID_MESSAGE } from "@/lib/households/errors";
import { invitePath } from "@/lib/households/invite-token";
import { inviteTokenSchema } from "@/lib/households/schemas";
import { createClient } from "@/lib/supabase/server";
import { AcceptInviteForm } from "./accept-invite-form";

export const metadata: Metadata = {
  title: "Join a household",
  // The token is in the URL: don't send it to other sites as a referrer.
  referrer: "no-referrer",
};

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <Suspense
      fallback={<FormSkeleton fields={0} label="Checking your invite" />}
    >
      <InviteContent params={params} />
    </Suspense>
  );
}

async function InviteContent({
  params,
}: Pick<PageProps<"/invite/[token]">, "params">) {
  const { token } = await params;
  const valid = inviteTokenSchema.safeParse(token).success;
  const user = await getCurrentUser();

  // Signed out: say nothing about the household; ask them to sign in first.
  if (!user) {
    return (
      <div className="space-y-6">
        <Heading
          title="You've been invited to a household"
          description="Sign in to see the invite and join. New here? Create an account and confirm your email, then open this link again."
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild>
            <Link href={valid ? signInPath(invitePath(token)) : "/sign-in"}>
              Sign in
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/sign-up">Create an account</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!valid) return <InvalidInvite />;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("get_invite_preview", { token })
    .single();
  if (error || !data) throw new Error("Could not check this invite.");

  if (data.status === "member" && data.household_id) {
    redirect(`/households/${data.household_id}?already=1`);
  }
  if (data.status !== "valid") return <InvalidInvite />;

  return (
    <div className="space-y-6">
      <Heading
        title={`Join ${data.household_name}`}
        description={`${data.inviter_name} invited you to join this household. Members see each other's names and the household's shared records.`}
      />
      <AcceptInviteForm token={token} />
    </div>
  );
}

function Heading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h1 className="type-page-title break-words">{title}</h1>
      <p className="type-secondary">{description}</p>
    </div>
  );
}

function InvalidInvite() {
  return (
    <div className="space-y-6">
      <Heading
        title="This invite can't be used"
        description={INVITE_INVALID_MESSAGE}
      />
      <Button asChild>
        <Link href="/home">Go to your households</Link>
      </Button>
    </div>
  );
}
