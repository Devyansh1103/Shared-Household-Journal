import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInviteToken } from "./invite-token";
import {
  createHouseholdSchema,
  inviteTokenSchema,
  memberActionSchema,
} from "./schemas";

const valid = {
  name: "Flat 4B",
  currency: "INR",
  timezone: "Asia/Kolkata",
  requestKey: randomUUID(),
};

describe("createHouseholdSchema", () => {
  it("accepts a valid household and trims the name", () => {
    const parsed = createHouseholdSchema.parse({
      ...valid,
      name: "  Flat 4B ",
    });
    expect(parsed.name).toBe("Flat 4B");
  });

  it("rejects empty, blank and over-long names", () => {
    for (const name of ["", "   ", "x".repeat(81)]) {
      expect(createHouseholdSchema.safeParse({ ...valid, name }).success).toBe(
        false,
      );
    }
    expect(
      createHouseholdSchema.safeParse({ ...valid, name: "x".repeat(80) })
        .success,
    ).toBe(true);
  });

  it("accepts only listed currencies and timezones", () => {
    for (const change of [
      { currency: "inr" },
      { currency: "XYZ1" },
      { currency: "" },
      { timezone: "Mars/Olympus" },
      { timezone: "" },
    ]) {
      expect(
        createHouseholdSchema.safeParse({ ...valid, ...change }).success,
      ).toBe(false);
    }
  });

  it("requires a request key", () => {
    expect(
      createHouseholdSchema.safeParse({ ...valid, requestKey: "" }).success,
    ).toBe(false);
  });
});

describe("memberActionSchema", () => {
  it("requires uuids", () => {
    expect(
      memberActionSchema.safeParse({
        householdId: randomUUID(),
        userId: randomUUID(),
      }).success,
    ).toBe(true);
    expect(
      memberActionSchema.safeParse({ householdId: "1", userId: "1 or 1=1" })
        .success,
    ).toBe(false);
  });
});

describe("inviteTokenSchema", () => {
  it("accepts generated tokens only", () => {
    expect(inviteTokenSchema.safeParse(createInviteToken().token).success).toBe(
      true,
    );
    expect(inviteTokenSchema.safeParse("../../etc").success).toBe(false);
  });
});
