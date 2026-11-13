import { describe, expect, it } from "vitest";
import { currentHousehold, isActive, navItems } from "./navigation";

const HOUSEHOLD = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";

describe("navItems", () => {
  it("lists only existing routes, without a household outside one", () => {
    expect(navItems().map((i) => i.href)).toEqual(["/home", "/profile"]);
    expect(navItems(null).map((i) => i.key)).toEqual(["home", "profile"]);
  });

  it("adds the current household, its expenses and balances between Home and Profile", () => {
    expect(navItems(HOUSEHOLD).map((i) => i.href)).toEqual([
      "/home",
      `/households/${HOUSEHOLD}`,
      `/households/${HOUSEHOLD}/expenses`,
      `/households/${HOUSEHOLD}/balances`,
      "/profile",
    ]);
  });
});

describe("isActive", () => {
  const [home, household, expenses, balances, profile] = navItems(HOUSEHOLD);

  it("matches exact paths, ignoring a trailing slash", () => {
    expect(isActive(home, "/home")).toBe(true);
    expect(isActive(home, "/home/")).toBe(true);
    expect(isActive(profile, "/profile")).toBe(true);
    expect(isActive(home, "/profile")).toBe(false);
  });

  it("marks exactly one of Household, Expenses and Balances inside a household", () => {
    const at = (path: string) =>
      [household, expenses, balances]
        .filter((item) => isActive(item, path))
        .map((i) => i.key);
    expect(at(`/households/${HOUSEHOLD}`)).toEqual(["household"]);
    expect(at(`/households/${HOUSEHOLD}/expenses`)).toEqual(["expenses"]);
    expect(at(`/households/${HOUSEHOLD}/expenses/new`)).toEqual(["expenses"]);
    expect(at(`/households/${HOUSEHOLD}/expenses/abc/edit`)).toEqual([
      "expenses",
    ]);
    expect(at(`/households/${HOUSEHOLD}/balances`)).toEqual(["balances"]);
    expect(at(`/households/${HOUSEHOLD}/balances/abc`)).toEqual(["balances"]);
    // Settlements are part of Balances (roadmap Phase 10).
    expect(at(`/households/${HOUSEHOLD}/settlements`)).toEqual(["balances"]);
    expect(at(`/households/${HOUSEHOLD}/settlements/new`)).toEqual([
      "balances",
    ]);
    expect(at(`/households/${HOUSEHOLD}/settlements/abc/`)).toEqual([
      "balances",
    ]);
    expect(at(`/households/${HOUSEHOLD}/settlementsx`)).toEqual([]);
    // The journal is part of Household (roadmap Phase 13).
    expect(at(`/households/${HOUSEHOLD}/journal`)).toEqual(["household"]);
    expect(at(`/households/${HOUSEHOLD}/journal/`)).toEqual(["household"]);
    expect(at(`/households/${HOUSEHOLD}/journalx`)).toEqual([]);
    // So are bills (roadmap Phase 14).
    expect(at(`/households/${HOUSEHOLD}/bills`)).toEqual(["household"]);
    expect(at(`/households/${HOUSEHOLD}/bills/new`)).toEqual(["household"]);
    expect(at(`/households/${HOUSEHOLD}/bills/abc/record`)).toEqual([
      "household",
    ]);
    expect(at(`/households/${HOUSEHOLD}/billsx`)).toEqual([]);
    // And the shopping list and chores (roadmap Phase 15).
    expect(at(`/households/${HOUSEHOLD}/shopping`)).toEqual(["household"]);
    expect(at(`/households/${HOUSEHOLD}/shopping/abc/edit`)).toEqual([
      "household",
    ]);
    expect(at(`/households/${HOUSEHOLD}/chores`)).toEqual(["household"]);
    expect(at(`/households/${HOUSEHOLD}/chores/new`)).toEqual(["household"]);
    expect(at(`/households/${HOUSEHOLD}/choresx`)).toEqual([]);
    expect(at(`/households/${HOUSEHOLD}x`)).toEqual([]);
    expect(at("/households/new")).toEqual([]);
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
