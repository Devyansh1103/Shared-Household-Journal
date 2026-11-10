import { describe, expect, it } from "vitest";
import { currentHousehold, isActive, navItems } from "./navigation";

const HOUSEHOLD = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";

describe("navItems", () => {
  it("lists only existing routes, without a household outside one", () => {
    expect(navItems().map((i) => i.href)).toEqual(["/home", "/profile"]);
    expect(navItems(null).map((i) => i.key)).toEqual(["home", "profile"]);
  });

  it("adds the current household between Home and Profile", () => {
    expect(navItems(HOUSEHOLD).map((i) => i.href)).toEqual([
      "/home",
      `/households/${HOUSEHOLD}`,
      "/profile",
    ]);
  });
});

describe("isActive", () => {
  const [home, household, profile] = navItems(HOUSEHOLD);

  it("matches exact paths, ignoring a trailing slash", () => {
    expect(isActive(home, "/home")).toBe(true);
    expect(isActive(home, "/home/")).toBe(true);
    expect(isActive(profile, "/profile")).toBe(true);
    expect(isActive(home, "/profile")).toBe(false);
  });

  it("keeps the household active on its sub-pages only", () => {
    expect(isActive(household, `/households/${HOUSEHOLD}`)).toBe(true);
    expect(isActive(household, `/households/${HOUSEHOLD}/expenses`)).toBe(true);
    expect(isActive(household, `/households/${HOUSEHOLD}x`)).toBe(false);
    expect(isActive(household, "/households/new")).toBe(false);
  });

  it("doesn't treat Home as a prefix of other pages", () => {
    expect(isActive(home, "/homes")).toBe(false);
    expect(isActive(home, "/home/anything")).toBe(false);
  });
});

describe("currentHousehold", () => {
  const households = [{ id: HOUSEHOLD, name: "Flat 4B" }];

  it("finds the household named in the URL", () => {
    expect(currentHousehold(households, HOUSEHOLD)?.name).toBe("Flat 4B");
  });

  it("ignores ids that aren't the user's, and missing or repeated params", () => {
    expect(currentHousehold(households, "someone-elses")).toBeUndefined();
    expect(currentHousehold(households, undefined)).toBeUndefined();
    expect(currentHousehold(households, [HOUSEHOLD])).toBeUndefined();
  });
});
