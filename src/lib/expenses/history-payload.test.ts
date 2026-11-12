import { describe, expect, it } from "vitest";
import { parseHistoryQuery, type HistoryFilters } from "./history";
import {
  averageOf,
  checkHistory,
  compareRows,
  parseHistoryPayload,
  type HistoryPage,
  type HistoryRow,
} from "./history-payload";

const H = "44444444-4444-4444-8444-444444444444";
const OTHER_H = "55555555-5555-4555-8555-555555555555";
const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const b = (value: number | string) => BigInt(value);

function filters(overrides: Record<string, string | string[]> = {}) {
  const result = parseHistoryQuery(
    {
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
    },
    { today: "2026-11-12", exponent: 2, payerIds: [OLIVE, PAT] },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.filters;
}

let sequence = 0;
function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  sequence += 1;
  const hex = sequence.toString(16).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${hex}`,
    householdId: H,
    position: 0,
    description: `Expense ${sequence}`,
    amountMinor: b(1000 + ((sequence * 7919) % 5000)),
    category: "groceries",
    expenseDate: `2026-11-${String(1 + (sequence % 28)).padStart(2, "0")}`,
    paidBy: sequence % 2 ? OLIVE : PAT,
    payerName: "Olive",
    payerIsActive: true,
    createdUs: b(1_700_000_000_000_000 + sequence * 1000),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * What public.expense_history should return for `rows` (all of the
 * household's matching expenses), built independently of the checks.
 */
function pageOf(
  rows: HistoryRow[],
  f: HistoryFilters,
  household = { count: rows.length, total: sum(rows), deleted: 0 },
  pageSize = 25,
): HistoryPage {
  const ordered = [...rows].sort(compareRows(f.sort));
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const page = Math.min(f.page, pageCount);
  const total = sum(ordered);
  const top = [...ordered].sort(compareRows("highest"))[0];
  return {
    totalCount: ordered.length,
    totalMinor: total,
    averageMinor: ordered.length ? averageOf(total, ordered.length) : null,
    largest: top
      ? {
          expenseId: top.id,
          description: top.description,
          amountMinor: top.amountMinor,
          expenseDate: top.expenseDate,
        }
      : null,
    page,
    pageCount,
    pageSize,
    householdCount: household.count,
    householdTotalMinor: household.total,
    householdDeletedCount: household.deleted,
    rows: ordered
      .slice((page - 1) * pageSize, page * pageSize)
      .map((r, i) => ({ ...r, position: (page - 1) * pageSize + i + 1 })),
  };
}

function sum(rows: HistoryRow[]) {
  return rows.reduce((s, r) => s + r.amountMinor, b(0));
}

function code(page: HistoryPage, f: HistoryFilters) {
  const result = checkHistory(page, {
    householdId: H,
    filters: f,
    pageSize: 25,
  });
  return result.ok ? "ok" : result.code;
}

describe("parseHistoryPayload", () => {
  const payload = () => ({
    total_count: 1,
    total_minor: "90000",
    average_minor: "90000",
    largest: {
      expense_id: OLIVE,
      description: "Rent",
      amount_minor: "90000",
      expense_date: "2026-11-01",
    },
    page: 1,
    page_count: 1,
    page_size: 25,
    household_count: 1,
    household_total_minor: "90000",
    household_deleted_count: 0,
    rows: [
      {
        expense_id: OLIVE,
        household_id: H,
        position: 1,
        description: "Rent",
        amount_minor: "90000",
        category: "rent",
        expense_date: "2026-11-01",
        paid_by: PAT,
        payer_name: null,
        payer_is_active: false,
        created_us: "1762000000000000",
        deleted_at: null,
      },
    ],
  });

  it("reads money and times exactly, and names a payer with no name", () => {
    const parsed = parseHistoryPayload(payload());
    expect(parsed).toMatchObject({
      totalMinor: b(90000),
      averageMinor: b(90000),
      largest: { amountMinor: b(90000) },
      householdTotalMinor: b(90000),
    });
    expect(parsed?.rows[0]).toMatchObject({
      amountMinor: b(90000),
      createdUs: b("1762000000000000"),
      payerName: "Former member",
      payerIsActive: false,
    });
  });

  it("refuses money as JSON numbers, unknown categories or a wrong shape", () => {
    const asNumber = payload() as Record<string, unknown>;
    asNumber.total_minor = 90000;
    expect(parseHistoryPayload(asNumber)).toBeNull();
    const category = payload();
    category.rows[0].category = "fun";
    expect(parseHistoryPayload(category)).toBeNull();
    const big = payload();
    big.page_size = 500;
    expect(parseHistoryPayload(big)).toBeNull();
    expect(parseHistoryPayload(null)).toBeNull();
  });
});

describe("averageOf", () => {
  it("rounds to the nearest minor unit, halves away from zero, like Postgres", () => {
    expect(averageOf(b(10), 4)).toBe(b(3)); // 2.5
    expect(averageOf(b(10), 3)).toBe(b(3)); // 3.33…
    expect(averageOf(b(11), 3)).toBe(b(4)); // 3.67
    expect(averageOf(b(7), 2)).toBe(b(4)); // 3.5
    expect(averageOf(b(5), 1)).toBe(b(5));
    // Exact beyond JavaScript's safe-integer range.
    expect(averageOf(b("18000000000000000003"), 2)).toBe(
      b("9000000000000000002"),
    );
  });
});

describe("compareRows: the documented orders", () => {
  const early = row({ expenseDate: "2026-11-01", amountMinor: b(500) });
  const late = row({ expenseDate: "2026-11-20", amountMinor: b(100) });
  const lateTwin = row({ expenseDate: "2026-11-20", amountMinor: b(100) });

  it("orders by date, amount or when added, with stable tie-breakers", () => {
    const sorted = (sort: Parameters<typeof compareRows>[0]) =>
      [early, late, lateTwin].sort(compareRows(sort)).map((r) => r.id);
    // lateTwin was added after late, so it's newer at the same date.
    expect(sorted("newest")).toEqual([lateTwin.id, late.id, early.id]);
    expect(sorted("oldest")).toEqual([early.id, late.id, lateTwin.id]);
    expect(sorted("highest")).toEqual([early.id, lateTwin.id, late.id]);
    expect(sorted("lowest")).toEqual([lateTwin.id, late.id, early.id]);
    expect(sorted("recent")).toEqual([lateTwin.id, late.id, early.id]);
  });

  it("falls back to the id when everything else is equal", () => {
    const a = row({ createdUs: b(1), expenseDate: "2026-11-01" });
    const z = row({ createdUs: b(1), expenseDate: "2026-11-01" });
    expect(compareRows("newest")(a, z)).toBeGreaterThan(0);
    expect(compareRows("oldest")(a, z)).toBeLessThan(0);
  });
});

describe("checkHistory", () => {
  const rows = Array.from({ length: 60 }, () => row());

  it("accepts every page of a real result, in every order", () => {
    for (const sort of ["newest", "oldest", "highest", "lowest", "recent"]) {
      for (const page of ["1", "2", "3"]) {
        const f = filters({ sort, page });
        expect(code(pageOf(rows, f), f), `${sort} ${page}`).toBe("ok");
      }
    }
    // A page past the end is answered with the last page.
    const far = filters({ page: "9" });
    expect(pageOf(rows, far).page).toBe(3);
    expect(code(pageOf(rows, far), far)).toBe("ok");
    // And nothing at all.
    const empty = filters({ q: "nothing" });
    expect(
      code(
        pageOf([], empty, { count: 60, total: sum(rows), deleted: 0 }),
        empty,
      ),
    ).toBe("ok");
  });

  it("covers every row exactly once across the pages", () => {
    const f = filters({ sort: "lowest" });
    const seen = [1, 2, 3].flatMap((p) =>
      pageOf(rows, { ...f, page: p }).rows.map((r) => r.id),
    );
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
  });

  it("refuses page arithmetic that doesn't hold", () => {
    const f = filters({ page: "2" });
    const good = pageOf(rows, f);
    expect(code({ ...good, page: 1 }, f)).toBe("page_mismatch");
    expect(code({ ...good, pageCount: 4 }, f)).toBe("page_mismatch");
    expect(code({ ...good, rows: good.rows.slice(1) }, f)).toBe(
      "page_mismatch",
    );
    expect(
      code(
        {
          ...good,
          rows: good.rows.map((r) => ({ ...r, position: r.position + 1 })),
        },
        f,
      ),
    ).toBe("page_mismatch");
    // Not clamped to the last page.
    const far = filters({ page: "9" });
    expect(code({ ...pageOf(rows, far), page: 9 }, far)).toBe("page_mismatch");
  });

  it("refuses a row twice, another household's row, or rows out of order", () => {
    const f = filters();
    const good = pageOf(rows, f);
    const twice = { ...good, rows: [...good.rows] };
    twice.rows[1] = { ...twice.rows[0], position: 2 };
    expect(code(twice, f)).toBe("duplicate_row");

    const foreign = { ...good, rows: [...good.rows] };
    foreign.rows[3] = { ...foreign.rows[3], householdId: OTHER_H };
    expect(code(foreign, f)).toBe("foreign_row");

    const swapped = { ...good, rows: [...good.rows] };
    [swapped.rows[0], swapped.rows[1]] = [
      { ...swapped.rows[1], position: 1 },
      { ...swapped.rows[0], position: 2 },
    ];
    expect(code(swapped, f)).toBe("order_mismatch");
  });

  it("refuses a row the filters don't allow", () => {
    const cases: [Record<string, string | string[]>, Partial<HistoryRow>][] = [
      [{ range: "custom", from: "2026-11-10" }, { expenseDate: "2026-11-09" }],
      [{ range: "custom", to: "2026-11-10" }, { expenseDate: "2026-11-11" }],
      [{ category: ["rent"] }, { category: "dining" }],
      [{ payer: [OLIVE] }, { paidBy: PAT }],
      [{ min: "20" }, { amountMinor: b(1999) }],
      [{ max: "20" }, { amountMinor: b(2001) }],
      [{ status: "deleted" }, { deletedAt: null }],
      [{}, { deletedAt: "2026-11-12T10:00:00+00:00" }],
    ];
    for (const [query, bad] of cases) {
      const f = filters(query);
      const allowed = row({
        expenseDate: "2026-11-10",
        category: f.categories[0] ?? "groceries",
        paidBy: f.payers[0] ?? OLIVE,
        amountMinor: b(2000),
        deletedAt: f.status === "deleted" ? "2026-11-12T10:00:00+00:00" : null,
      });
      // With nothing but the status, the household's figures are exactly
      // the page's; otherwise the one row fits inside them.
      const lone = Object.keys(query).every((key) => key === "status");
      const household =
        f.status === "deleted"
          ? { count: 5, total: b(99999), deleted: lone ? 1 : 5 }
          : lone
            ? { count: 1, total: b(2000), deleted: 0 }
            : { count: 5, total: b(99999), deleted: 5 };
      const page = pageOf([allowed], f, household);
      expect(code(page, f), JSON.stringify(query)).toBe("ok");
      page.rows[0] = { ...page.rows[0], ...bad };
      expect(code(page, f), JSON.stringify(query)).toBe("filter_mismatch");
    }
  });

  it("refuses a summary that doesn't add up", () => {
    const f = filters();
    const one = pageOf(rows.slice(0, 10), f);
    expect(code(one, f)).toBe("ok");
    expect(code({ ...one, averageMinor: one.averageMinor! + b(1) }, f)).toBe(
      "summary_mismatch",
    );
    expect(code({ ...one, totalMinor: one.totalMinor + b(1) }, f)).toBe(
      "summary_mismatch",
    );
    expect(
      code({ ...one, largest: { ...one.largest!, amountMinor: b(1) } }, f),
    ).toBe("summary_mismatch");
    const notLargest = one.rows.find((r) => r.id !== one.largest!.expenseId)!;
    expect(
      code(
        { ...one, largest: { ...one.largest!, expenseId: notLargest.id } },
        f,
      ),
    ).toBe("summary_mismatch");
    const none = pageOf([], filters({ q: "x" }), {
      count: 3,
      total: b(9),
      deleted: 0,
    });
    expect(code({ ...none, totalMinor: b(1) }, filters({ q: "x" }))).toBe(
      "summary_mismatch",
    );
  });

  it("refuses totals that don't fit inside the household's, or differ unfiltered", () => {
    const f = filters();
    const all = pageOf(rows, f);
    // Unfiltered, the matching expenses are every counted expense.
    expect(code({ ...all, householdCount: 61 }, f)).toBe("totals_mismatch");
    expect(
      code({ ...all, householdTotalMinor: all.householdTotalMinor + b(1) }, f),
    ).toBe("totals_mismatch");
    // Filtered, they must fit inside.
    const g = filters({ q: "x" });
    const some = pageOf(rows.slice(0, 5), g, {
      count: 4,
      total: b(10_000_000),
      deleted: 0,
    });
    expect(code(some, g)).toBe("totals_mismatch");
    // Deleted ones against the household's deleted count (D7).
    const d = filters({ status: "deleted" });
    const deletedRows = rows
      .slice(0, 3)
      .map((r) => ({ ...r, deletedAt: "2026-11-12T10:00:00+00:00" }));
    const deleted = pageOf(deletedRows, d, {
      count: 60,
      total: b(1),
      deleted: 3,
    });
    expect(code(deleted, d)).toBe("ok");
    expect(code({ ...deleted, householdDeletedCount: 2 }, d)).toBe(
      "totals_mismatch",
    );
  });
});
