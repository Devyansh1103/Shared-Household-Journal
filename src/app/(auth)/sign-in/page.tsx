import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormSkeleton } from "@/components/form-skeleton";
import { safeReturnPath } from "@/lib/auth/return-path";
import { getCurrentUser } from "@/lib/auth/session";
import { SignInForm, type SignInNotice } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="type-page-title">Sign in</h1>
        <p className="type-secondary">Welcome back to your household.</p>
      </div>
      <Suspense fallback={<FormSkeleton label="Loading sign-in form" />}>
        <SignInContent searchParams={searchParams} />
      </Suspense>
      <p className="type-secondary">
        New here?{" "}
        <Link
          href="/sign-up"
          className="font-medium text-primary underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}

async function SignInContent({
  searchParams,
}: Pick<PageProps<"/sign-in">, "searchParams">) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);

  // Already signed in: carry on to where they were going.
  if (await getCurrentUser()) redirect(next);

  let notice: SignInNotice | undefined;
  if (params.signed_out === "1") notice = "signed-out";
  else if (params.error === "invalid_link") notice = "invalid-link";

  return <SignInForm next={next} notice={notice} />;
}
