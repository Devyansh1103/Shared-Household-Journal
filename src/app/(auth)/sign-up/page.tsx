import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormSkeleton } from "@/components/form-skeleton";
import { SIGNED_IN_HOME } from "@/lib/auth/return-path";
import { getCurrentUser } from "@/lib/auth/session";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="type-page-title">Create an account</h1>
        <p className="type-secondary">
          Keep shared costs and home life clear for everyone you live with.
        </p>
      </div>
      <Suspense
        fallback={<FormSkeleton fields={3} label="Loading sign-up form" />}
      >
        <SignUpContent />
      </Suspense>
      <p className="type-secondary">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-primary underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

async function SignUpContent() {
  if (await getCurrentUser()) redirect(SIGNED_IN_HOME);
  return <SignUpForm />;
}
