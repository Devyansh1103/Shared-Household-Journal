// Postgres error codes from the household functions mapped to plain messages.
// Codes HJ001–HJ005 are defined in the Phase 6 migration, HJ006–HJ012 in the
// expenses migration, HJ013 in the balances migration, HJ014–HJ017 in the
// settlements migration and HJ018–HJ025 in the recurring bills migration.
// Raw database messages are never shown.

import { GENERIC_ERROR } from "@/lib/auth/errors";

/** D5's wording for an expired, revoked, used-up or unknown link. */
export const INVITE_INVALID_MESSAGE =
  "This invite is no longer valid — ask a household member for a new one.";

const MESSAGES: Record<string, string> = {
  HJ001: INVITE_INVALID_MESSAGE,
  HJ002:
    "You're the owner, so you can't leave yet. Make someone else the owner first, or delete the household if you're the only member.",
  HJ003: "That person isn't a member of this household any more.",
  HJ004:
    "You can delete the household only when you're its only member. Remove the others or make one of them the owner first.",
  HJ005: "You can't do that to yourself.",
  HJ006:
    "That balance isn't zero yet. Someone can leave or be removed only once the shared costs involving them even out.",
  HJ007:
    "Everyone in an expense must be a current member of the household. Someone here has left.",
  HJ008: "The split doesn't add up. Check the shares and try again.",
  HJ009: "We couldn't find that expense.",
  HJ010:
    "Someone changed this expense while you were editing. Reload the page to see their changes, then try again.",
  HJ011: "That can't be done to this expense right now. Reload the page.",
  HJ012:
    "The currency can't be changed once the household has expenses or recorded payments.",
  HJ013:
    "Balances can't be worked out right now because an expense's shares don't add up to its amount. Nothing was changed.",
  HJ014: "We couldn't find that payment.",
  HJ015: "That payment is already voided. Reload the page.",
  HJ016:
    "A payment is recorded between two different current members of the household. Someone here may have left.",
  HJ017:
    "That's more than what's owed right now. Check the figures and try again.",
  HJ018: "We couldn't find that bill.",
  HJ019:
    "Those dates don't work for this bill. A new schedule starts today or later, after every period so far, and the last due date can't be before a period that has already come.",
  HJ020:
    "Someone changed this bill while you were editing. Reload the page to see their changes, then try again.",
  HJ021: "That can't be done to this bill right now. Reload the page.",
  HJ022: "That period is already recorded. Reload the page to see it.",
  HJ023: "That period is skipped, or isn't any more. Reload the page.",
  HJ024:
    "That period can't be recorded or skipped yet. Only periods that have come, and the next one, can.",
  HJ025:
    "That bill period has been recorded again or skipped since this expense was deleted, so it can't be restored.",
  "42501": "You don't have permission to do that.",
  "23514": "Some of those details aren't valid. Check them and try again.",
  "22023": "Choose a timezone from the list.",
};

export function householdErrorMessage(code: string | undefined): string {
  return code && Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : GENERIC_ERROR;
}
