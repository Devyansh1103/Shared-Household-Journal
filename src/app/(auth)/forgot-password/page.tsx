import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="type-page-title">Reset your password</h1>
        <p className="type-secondary">
          Enter the email you signed up with and we&apos;ll send you a link to
          choose a new password.
        </p>
      </div>
      <ForgotPasswordForm />
      <p className="type-secondary">
        Remembered it?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-primary underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
