// Input validation for the household Server Actions (requirements-notes §4.6).
// The database checks the same rules again.

import { z } from "zod";
import { INVITE_TOKEN_PATTERN } from "./invite-token";
import { isSupportedCurrency, isSupportedTimeZone } from "./options";

/** Matches the households.name check: 1–80 characters, trimmed. */
export const householdName = z
  .string()
  .trim()
  .min(1, "Give your household a name.")
  .max(80, "Use 80 characters or fewer.");

export const createHouseholdSchema = z.object({
  name: householdName,
  currency: z
    .string()
    .refine(isSupportedCurrency, "Choose a currency from the list."),
  timezone: z
    .string()
    .refine(isSupportedTimeZone, "Choose a timezone from the list."),
  // Identifies one creation attempt so a repeated submission isn't a second household.
  requestKey: z.uuid(),
});

export const householdIdSchema = z.uuid();

/** An action on another member: remove them, or make them the owner. */
export const memberActionSchema = z.object({
  householdId: z.uuid(),
  userId: z.uuid(),
});

export const invitationActionSchema = z.object({
  householdId: z.uuid(),
  invitationId: z.uuid(),
});

export const inviteTokenSchema = z.string().regex(INVITE_TOKEN_PATTERN);
