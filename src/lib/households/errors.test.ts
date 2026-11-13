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

  it("explains every settlement code in plain words (roadmap Phase 10)", () => {
    for (const code of ["HJ014", "HJ015", "HJ016", "HJ017"]) {
      const message = householdErrorMessage(code);
      expect(message, code).not.toBe(GENERIC_ERROR);
      expect(message, code).toMatch(/payment|owed/);
      expect(message, code).not.toMatch(/HJ0|settlements|sqlstate/i);
    }
    expect(householdErrorMessage("HJ012")).toMatch(/recorded payments/);
  });

  it("explains every recurring bill code in plain words (roadmap Phase 14)", () => {
    for (let n = 18; n <= 25; n++) {
      const code = `HJ0${n}`;
      const message = householdErrorMessage(code);
      expect(message, code).not.toBe(GENERIC_ERROR);
      expect(message, code).toMatch(/bill|period/);
      expect(message, code).not.toMatch(/HJ0|occurrence|sqlstate/i);
    }
  });

  it("explains every shopping and chore code in plain words (roadmap Phase 15)", () => {
    for (let n = 26; n <= 30; n++) {
      const code = `HJ0${n}`;
      const message = householdErrorMessage(code);
      expect(message, code).not.toBe(GENERIC_ERROR);
      expect(message, code).not.toMatch(/HJ0|shopping_item|sqlstate/i);
    }
    expect(householdErrorMessage("HJ026")).toMatch(/shopping list/);
    expect(householdErrorMessage("HJ027")).toMatch(/chore/);
  });

  it("falls back to a generic message for unknown or missing codes", () => {
    expect(householdErrorMessage("XX999")).toBe(GENERIC_ERROR);
    expect(householdErrorMessage(undefined)).toBe(GENERIC_ERROR);
    expect(householdErrorMessage("toString")).toBe(GENERIC_ERROR);
  });
});
