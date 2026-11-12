import { describe, expect, it } from "vitest";
import {
  activeFilterChips,
  activeFilterCount,
  categoriesMatching,
  dateRangeBounds,
  expenseHistoryArgs,
  HISTORY_PAGE_SIZE,
  historyHref,
  historySearchParams,
  isFiltered,
  normaliseSearch,
  parseHistoryQuery,
  readHistoryQuery,
  type HistoryContext,
  type HistoryFilters,
  type RawHistoryQuery,
} from "./history";

const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const LEFT = "33333333-3333-4333-8333-333333333333";
/** Someone in another household: never one of this household's people. */
const OUTSIDER = "99999999-9999-4999-8999-999999999999";
const HOUSEHOLD = "44444444-4444-4444-8444-444444444444";
const BASE = `/households/${HOUSEHOLD}/expenses`;

// Thursday 12 November 2026, in the household's timezone.
const context: HistoryContext = {
  today: "2026-11-12",
  exponent: 2,
  payerIds: [OLIVE, PAT, LEFT],
};

function raw(overrides: Partial<RawHistoryQuery> = {}): RawHistoryQuery {
  return {
    q: "",
    range: "",
    from: "",
    to: "",
    category: [],
    payer: [],
    min: "",
    max: "",
    status: "",
    sort: "",
    page: "",
    ...overrides,
  };
}

function filters(overrides: Partial<RawHistoryQuery> = {}, ctx = context) {
  const result = parseHistoryQuery(raw(overrides), ctx);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.filters;
}

function errors(overrides: Partial<RawHistoryQuery>, ctx = context) {
  const result = parseHistoryQuery(raw(overrides), ctx);
  return result.ok ? {} : result.errors;
}

describe("readHistoryQuery", () => {
  it("reads single and repeated values, ignoring empty repeats", () => {
    expect(
      readHistoryQuery({
        q: "rent",
        category: ["rent", "", "utilities"],
        payer: OLIVE,
        sort: ["oldest", "newest"],
      }),
    ).toEqual(
      raw({
        q: "rent",
        category: ["rent", "utilities"],
        payer: [OLIVE],
        sort: "oldest",
      }),
    );
    expect(readHistoryQuery({})).toEqual(raw());
  });
});

describe("search", () => {
  it("ignores spaces at the ends and runs of spaces", () => {
    expect(normaliseSearch("  Electricity   bill \t")).toBe("Electricity bill");
    expect(filters({ q: "   " }).search).toBe("");
    expect(filters({ q: "  Rent  " }).search).toBe("Rent");
  });

  it("matches category names from the start of a word, ignoring case", () => {
    expect(categoriesMatching("groc")).toEqual(["groceries"]);
    expect(categoriesMatching("SUPPLIES")).toEqual(["household_supplies"]);
    expect(categoriesMatching("household s")).toEqual(["household_supplies"]);
    expect(categoriesMatching("t")).toEqual(["transport"]);
    // Not the middle of a word: "ent" isn't "Rent".
    expect(categoriesMatching("ent")).toEqual([]);
    expect(categoriesMatching("milk")).toEqual([]);
    expect(categoriesMatching("  ")).toEqual([]);
  });

  it("refuses more than 120 characters", () => {
    expect(errors({ q: "x".repeat(121) }).q).toBe(
      "Search for 120 characters or fewer.",
    );
    expect(filters({ q: "x".repeat(120) }).search).toHaveLength(120);
  });
});

describe("date ranges, in the household's own days (D11)", () => {
  it("today is just today", () => {
    expect(dateRangeBounds("today", "2026-11-12")).toEqual({
      from: "2026-11-12",
      to: "2026-11-12",
    });
  });

  it("this week runs Monday to Sunday (D25, proposed)", () => {
    const week = { from: "2026-11-09", to: "2026-11-15" };
    // Monday, Thursday and Sunday of the same week.
    for (const today of ["2026-11-09", "2026-11-12", "2026-11-15"]) {
      expect(dateRangeBounds("week", today), today).toEqual(week);
    }
    // Across a month and a year.
    expect(dateRangeBounds("week", "2026-12-02")).toEqual({
      from: "2026-11-30",
      to: "2026-12-06",
    });
    expect(dateRangeBounds("week", "2027-01-01")).toEqual({
      from: "2026-12-28",
      to: "2027-01-03",
    });
  });

  it("this month and the previous month are whole calendar months", () => {
    expect(dateRangeBounds("month", "2026-11-12")).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(dateRangeBounds("month", "2028-02-10")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(dateRangeBounds("month", "2027-02-10").to).toBe("2027-02-28");
    expect(dateRangeBounds("last-month", "2026-11-12")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    // January's previous month is last year's December.
    expect(dateRangeBounds("last-month", "2027-01-15")).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
    expect(dateRangeBounds("last-month", "2028-03-01").to).toBe("2028-02-29");
  });

  it("presets resolve from today, and ignore any dates in the link", () => {
    expect(
      filters({ range: "month", from: "2020-01-01", to: "2020-01-02" }),
    ).toMatchObject({ range: "month", from: "2026-11-01", to: "2026-11-30" });
    expect(filters({ range: "today" })).toMatchObject({
      from: "2026-11-12",
      to: "2026-11-12",
    });
    expect(filters()).toMatchObject({ range: "any", from: null, to: null });
  });

  it("custom dates may be open at either end, and a link with only dates means them", () => {
    expect(
      filters({ range: "custom", from: "2026-10-05", to: "2026-10-20" }),
    ).toMatchObject({ range: "custom", from: "2026-10-05", to: "2026-10-20" });
    expect(filters({ from: "2026-10-05" })).toMatchObject({
      range: "custom",
      from: "2026-10-05",
      to: null,
    });
    expect(filters({ to: "2026-10-20" })).toMatchObject({
      from: null,
      to: "2026-10-20",
    });
    // The same day at both ends is one day.
    expect(
      filters({ range: "custom", from: "2026-10-05", to: "2026-10-05" }).to,
    ).toBe("2026-10-05");
  });

  it("refuses an end before the start, impossible dates and unknown ranges", () => {
    expect(
      errors({ range: "custom", from: "2026-10-20", to: "2026-10-05" }).to,
    ).toBe("The end date can't be before the start date.");
    expect(errors({ range: "custom", from: "2026-02-30" }).from).toBe(
      "Choose a real start date.",
    );
    expect(errors({ range: "custom", to: "20/10/2026" }).to).toBe(
      "Choose a real end date.",
    );
    expect(errors({ range: "fortnight" }).range).toBe(
      "Choose a date range from the list.",
    );
  });
});

describe("categories and payers", () => {
  it("keeps each category once, in D17's order", () => {
    expect(
      filters({ category: ["other", "rent", "rent", "groceries"] }).categories,
    ).toEqual(["rent", "groceries", "other"]);
  });

  it("refuses categories that aren't in the list", () => {
    expect(errors({ category: ["rent", "fun"] }).category).toBe(
      "Choose categories from the list.",
    );
  });

  it("allows anyone who is or was a member, in the household's order", () => {
    expect(filters({ payer: [LEFT, OLIVE, OLIVE] }).payers).toEqual([
      OLIVE,
      LEFT,
    ]);
  });

  it("refuses forged payer ids, like someone from another household", () => {
    for (const payer of [OUTSIDER, "not-a-uuid"]) {
      expect(errors({ payer: [OLIVE, payer] }).payer, payer).toBe(
        "Choose people from this household.",
      );
    }
  });
});

describe("amounts, exactly, in the household's currency", () => {
  it("reads amounts as minor units with the currency's decimals", () => {
    expect(filters({ min: "100", max: "1,250.50" })).toMatchObject({
      min: BigInt(10000),
      max: BigInt(125050),
    });
    expect(filters({ min: "99.5" }).min).toBe(BigInt(9950));
    // KWD has three decimals, JPY none (D2).
    expect(filters({ min: "1.005" }, { ...context, exponent: 3 }).min).toBe(
      BigInt(1005),
    );
    expect(filters({ max: "1500" }, { ...context, exponent: 0 }).max).toBe(
      BigInt(1500),
    );
  });

  it("refuses amounts that aren't exact, positive and in range", () => {
    expect(errors({ min: "0" }).min).toBe("Enter an amount greater than zero.");
    expect(errors({ min: "-5" }).min).toMatch(/Enter an amount like/);
    expect(errors({ max: "12.345" }).max).toBe("Use at most 2 decimal places.");
    expect(errors({ max: "1e3" }).max).toMatch(/Enter an amount like/);
    expect(errors({ min: "100.5" }, { ...context, exponent: 0 }).min).toBe(
      "This currency has no decimal places. Enter a whole amount.",
    );
    expect(errors({ max: "99999999999999" }).max).toBe(
      "That amount is too large.",
    );
  });

  it("refuses a minimum above the maximum, and allows them equal", () => {
    expect(errors({ min: "500", max: "100" }).max).toBe(
      "The maximum can't be less than the minimum.",
    );
    expect(filters({ min: "100.00", max: "100" })).toMatchObject({
      min: BigInt(10000),
      max: BigInt(10000),
    });
  });
});

describe("status, sort and page", () => {
  it("defaults to counted expenses, newest first, page 1", () => {
    expect(filters()).toEqual({
      search: "",
      range: "any",
      from: null,
      to: null,
      categories: [],
      payers: [],
      min: null,
      max: null,
      status: "counted",
      sort: "newest",
      page: 1,
    });
  });

  it("reads deleted expenses (D7), every sort, and refuses others", () => {
    expect(filters({ status: "deleted" }).status).toBe("deleted");
    for (const sort of ["newest", "oldest", "highest", "lowest", "recent"]) {
      expect(filters({ sort }).sort).toBe(sort);
    }
    expect(errors({ status: "archived" }).status).toBe(
      "Choose which expenses to show.",
    );
    expect(errors({ sort: "random" }).sort).toBe(
      "Choose a sort order from the list.",
    );
  });

  it("reads page numbers, falling back to the first, capping huge ones", () => {
    expect(filters({ page: "3" }).page).toBe(3);
    for (const page of ["0", "-1", "abc", "2.5", "", "03"]) {
      expect(filters({ page }).page, page).toBe(1);
    }
    expect(filters({ page: "99999999999999999999" }).page).toBe(999_999);
  });

  it("reports every problem at once", () => {
    expect(
      Object.keys(
        errors({ q: "x".repeat(200), min: "0", sort: "x", status: "y" }),
      ).sort(),
    ).toEqual(["min", "q", "sort", "status"]);
  });
});

describe("isFiltered and activeFilterCount", () => {
  it("counts what narrows the list, not the search box or the order", () => {
    expect(isFiltered(filters())).toBe(false);
    expect(isFiltered(filters({ sort: "oldest", page: "4" }))).toBe(false);
    expect(isFiltered(filters({ q: "rent" }))).toBe(true);
    expect(isFiltered(filters({ status: "deleted" }))).toBe(true);
    expect(activeFilterCount(filters({ q: "rent" }))).toBe(0);
    expect(
      activeFilterCount(
        filters({
          range: "month",
          category: ["rent", "dining"],
          payer: [PAT],
          min: "1",
          max: "2",
          status: "deleted",
        }),
      ),
    ).toBe(5);
  });
});

describe("URLs", () => {
  const all = filters({
    q: "  milk  ",
    range: "custom",
    from: "2026-10-01",
    to: "2026-10-31",
    category: ["groceries", "rent"],
    payer: [PAT, OLIVE],
    min: "10",
    max: "250.5",
    status: "deleted",
    sort: "highest",
    page: "2",
  });

  it("are canonical: a fixed order, no defaults, amounts in the currency's decimals", () => {
    expect(historySearchParams(all, 2).toString()).toBe(
      "q=milk&range=custom&from=2026-10-01&to=2026-10-31&category=rent&category=groceries" +
        `&payer=${OLIVE}&payer=${PAT}&min=10.00&max=250.50&status=deleted&sort=highest&page=2`,
    );
    expect(historySearchParams(filters(), 2).toString()).toBe("");
    // A preset stays a preset, so a shared link means the reader's month.
    expect(historySearchParams(filters({ range: "month" }), 2).toString()).toBe(
      "range=month",
    );
  });

  it("read back to exactly the same filters", () => {
    const params = Object.fromEntries(
      [...new Set(historySearchParams(all, 2).keys())].map((key) => {
        const values = historySearchParams(all, 2).getAll(key);
        return [key, values.length > 1 ? values : values[0]];
      }),
    );
    expect(filters(readHistoryQuery(params))).toEqual(all);
  });

  it("go back to page 1 on any change but the page", () => {
    expect(historyHref(BASE, all, 2, { page: 3 })).toContain("page=3");
    expect(historyHref(BASE, all, 2, { sort: "oldest" })).not.toContain(
      "page=",
    );
    expect(historyHref(BASE, all, 2, { search: "" })).not.toMatch(/[?&]q=/);
    expect(historyHref(BASE, filters(), 2)).toBe(BASE);
    expect(historyHref(BASE, filters({ page: "5" }), 2, { page: 1 })).toBe(
      BASE,
    );
  });
});

describe("expenseHistoryArgs", () => {
  it("sends only what's set, with the category names the search matches", () => {
    expect(expenseHistoryArgs(HOUSEHOLD, filters())).toEqual({
      target_household_id: HOUSEHOLD,
      deleted_only: false,
      sort_order: "newest",
      page_size: HISTORY_PAGE_SIZE,
      page_number: 1,
    });
    expect(
      expenseHistoryArgs(
        HOUSEHOLD,
        filters({
          q: "groc",
          range: "last-month",
          category: ["groceries"],
          payer: [OLIVE],
          min: "1.50",
          max: "2",
          status: "deleted",
          sort: "lowest",
          page: "4",
        }),
      ),
    ).toEqual({
      target_household_id: HOUSEHOLD,
      search_text: "groc",
      search_categories: ["groceries"],
      date_from: "2026-10-01",
      date_to: "2026-10-31",
      categories: ["groceries"],
      payers: [OLIVE],
      amount_min: 150,
      amount_max: 200,
      deleted_only: true,
      sort_order: "lowest",
      page_size: HISTORY_PAGE_SIZE,
      page_number: 4,
    });
  });
});

describe("activeFilterChips", () => {
  const people = [
    { userId: OLIVE, label: "Olive (you)" },
    { userId: PAT, label: "Pat" },
    { userId: LEFT, label: "Quin (left)" },
  ];
  const chips = (f: HistoryFilters) =>
    activeFilterChips(f, { base: BASE, exponent: 2, currency: "INR", people });

  it("names each filter in words", () => {
    expect(
      chips(
        filters({
          q: "milk",
          range: "month",
          category: ["groceries"],
          payer: [LEFT],
          min: "10",
          max: "250.5",
          status: "deleted",
        }),
      ).map((c) => c.label),
    ).toEqual([
      "Search: “milk”",
      "This month (1 Nov 2026 – 30 Nov 2026)",
      "Groceries",
      "Paid by Quin (left)",
      "At least ₹10.00",
      "At most ₹250.50",
      "Deleted expenses",
    ]);
    expect(chips(filters({ range: "today" }))[0].label).toBe(
      "Today (12 Nov 2026)",
    );
    expect(chips(filters({ from: "2026-10-05" }))[0].label).toBe(
      "From 5 Oct 2026",
    );
    expect(chips(filters({ to: "2026-10-05" }))[0].label).toBe(
      "Until 5 Oct 2026",
    );
    expect(chips(filters())).toEqual([]);
  });

  it("each removes just its own filter and goes back to page 1", () => {
    const f = filters({
      category: ["rent", "groceries"],
      payer: [PAT],
      sort: "oldest",
      page: "3",
    });
    const [rent, , pat] = chips(f);
    expect(rent.href).toBe(
      `${BASE}?category=groceries&payer=${PAT}&sort=oldest`,
    );
    expect(pat.href).toBe(
      `${BASE}?category=rent&category=groceries&sort=oldest`,
    );
  });
});
