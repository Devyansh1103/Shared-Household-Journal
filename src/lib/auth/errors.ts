// Supabase Auth error codes mapped to messages people can act on. Raw provider
// messages are never shown.

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Email or password is incorrect.",
  email_not_confirmed:
    "Confirm your email address first. Can't find the email? Sign up again with the same address to get a new link.",
  weak_password: "Choose a stronger password with at least 8 characters.",
  same_password: "Choose a password that's different from your current one.",
  reauthentication_needed:
    "For your security, request a new password reset link and try again.",
  over_request_rate_limit:
    "Too many attempts. Wait a few minutes and try again.",
  over_email_send_rate_limit:
    "Too many emails sent. Wait a few minutes and try again.",
  signup_disabled: "New accounts can't be created right now.",
  email_address_invalid: "Enter a valid email address.",
};

export const GENERIC_ERROR = "Something went wrong. Please try again.";

export function authErrorMessage(code: string | undefined): string {
  return code && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : GENERIC_ERROR;
}

/** Codes that must not change what a sign-up shows, so account existence isn't revealed. */
export function isExistingAccountError(code: string | undefined): boolean {
  return code === "user_already_exists" || code === "email_exists";
}
