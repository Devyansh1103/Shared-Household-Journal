import { describe, expect, it } from "vitest";
import {
  analyticsHref,
  parseAnalyticsQuery,
  presetRange,
  readAnalyticsQuery,
} from "./query";

const PAT = "22222222-2222-4222-8222-222222222222";
const context = { today: "2026-11-13", personIds: [PAT] };
const raw = (over: Partial<Record<string, string>> = {}) =>
  readAnalyticsQuery({
    range: "",
    from: "",
    to: "",
    category: "",
    payer: "",
    ...over,
  });

describe("presetRange", () => {
  it("compares this month so far with the same days of last month", () => {
    expect(presetRange("this_month", "2026-11-13")).toEqual({
      from: "2026-11-01",
      to: "2026-11-13",
      compareFrom: "2026-10-01",
      compareTo: "2026-10-13",
    });
    // 31 March: February has no 31st, so the whole of February.
    expect(presetRange("this_month", "2027-03-31")).toEqual({
      from: "2027-03-01",
      to: "2027-03-31",
      compareFrom: "2027-02-01",
      compareTo: "2027-02-28",
    });
  });

  it("works out every preset from the household's date", () => {
    expect(presetRange("last_month", "2026-03-10")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
      compareFrom: "2026-01-01",
      compareTo: "2026-01-31",
    });
    expect(presetRange("last_7_days", "2026-11-13")).toMatchObject({
      from: "2026-11-07",
      to: "2026-11-13",
    });
    expect(presetRange("last_30_days", "2026-11-13")).toMatchObject({
      from: "2026-10-15",
      compareFrom: null,
    });
    expect(presetRange("last_3_months", "2026-11-13")).toMatchObject({
      from: "2026-09-01",
    });
    expect(presetRange("last_12_months", "2026-01-15")).toMatchObject({
      from: "2025-02-01",
      to: "2026-01-15",
    });
  });
});

describe("parseAnalyticsQuery", () => {
  it("defaults to this month, everything, anyone", () => {
    expect(parseAnalyticsQuery(raw(), context)).toEqual({
      ok: true,
      query: {
        range: "this_month",
        from: "2026-11-01",
        to: "2026-11-13",
        compareFrom: "2026-10-01",
        compareTo: "2026-10-13",
        category: null,
        payer: null,
      },
    });
  });

  it("reads custom dates, a category and a person", () => {
    expect(
      parseAnalyticsQuery(
        raw({
          range: "custom",
          from: "2028-02-01",
          to: "2028-02-29",
          category: "dining",
          payer: PAT,
        }),
        context,
      ),
    ).toEqual({
      ok: true,
      query: {
        range: "custom",
        from: "2028-02-01",
        to: "2028-02-29",
        compareFrom: null,
        compareTo: null,
        category: "dining",
        payer: PAT,
      },
    });
  });

  it("refuses what it can't use, near the field, instead of guessing", () => {
    const fields = (over: Partial<Record<string, string>>) => {
      const result = parseAnalyticsQuery(raw(over), context);
      return result.ok ? [] : Object.keys(result.fieldErrors).sort();
    };
    expect(fields({ range: "forever" })).toEqual(["range"]);
    expect(fields({ category: "pets" })).toEqual(["category"]);
    expect(fields({ payer: "22222222-2222-4222-8222-000000000000" })).toEqual([
      "payer",
    ]);
    expect(
      fields({ range: "custom", from: "2026-02-30", to: "2026-03-01" }),
    ).toEqual(["from"]);
    expect(
      fields({ range: "custom", from: "2026-03-02", to: "2026-03-01" }),
    ).toEqual(["to"]);
    expect(
      fields({ range: "custom", from: "2024-01-01", to: "2026-01-01" }),
    ).toEqual(["to"]); // over two years
    expect(
      fields({ range: "custom", from: "2024-01-01", to: "2025-12-31" }),
    ).toEqual([]); // 731 days
  });
});

describe("analyticsHref", () => {
  it("leaves out defaults, and dates unless they're custom", () => {
    expect(
      analyticsHref("/a", {
        range: "this_month",
        from: "2026-01-01",
        category: null,
        payer: null,
      }),
    ).toBe("/a");
    expect(
      analyticsHref("/a", {
        range: "custom",
        from: "2026-01-01",
        to: "2026-01-31",
        category: "rent",
        payer: PAT,
      }),
    ).toBe(
      `/a?range=custom&from=2026-01-01&to=2026-01-31&category=rent&payer=${PAT}`,
    );
  });
});
