import { describe, expect, it } from "vitest";
import { GENERIC_ERROR } from "@/lib/auth/errors";
import { householdErrorMessage, INVITE_INVALID_MESSAGE } from "./errors";

describe("householdErrorMessage", () => {
  it("uses D5's wording for invalid invites", () => {
    expect(householdErrorMessage("HJ001")).toBe(INVITE_INVALID_MESSAGE);
    expect(INVITE_INVALID_MESSAGE).toBe(
      "This invite is no longer valid — ask a household member for a new one.",
    );
  });

  it("explains the owner-leaving rule", () => {
    expect(householdErrorMessage("HJ002")).toMatch(/owner/i);
  });

  it("falls back to a generic message for unknown or missing codes", () => {
    expect(householdErrorMessage("XX999")).toBe(GENERIC_ERROR);
    expect(householdErrorMessage(undefined)).toBe(GENERIC_ERROR);
    expect(householdErrorMessage("toString")).toBe(GENERIC_ERROR);
  });
});
