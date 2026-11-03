// Input validation for the auth and profile Server Actions (requirements-notes §4.6).
// The database and Supabase Auth enforce the same limits again.

import { z } from "zod";

/** Matches `minimum_password_length` in supabase/config.toml. */
export const PASSWORD_MIN_LENGTH = 8;
/** Supabase Auth rejects longer passwords (bcrypt limit). */
const PASSWORD_MAX_LENGTH = 72;

const email = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .pipe(z.email("Enter an email address like name@example.com."));

const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`);

/** Matches the profiles.display_name check: 1–80 characters, trimmed. */
export const displayName = z
  .string()
  .trim()
  .min(1, "Enter the name other members will see.")
  .max(80, "Use 80 characters or fewer.");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z.object({
  displayName,
  email,
  password: newPassword,
});

export const forgotPasswordSchema = z.object({ email });

export const newPasswordSchema = z
  .object({
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords don't match.",
  });

export const profileSchema = z.object({ displayName });

/** First error message per field, for showing under each input. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !(field in errors)) errors[field] = issue.message;
  }
  return errors;
}
