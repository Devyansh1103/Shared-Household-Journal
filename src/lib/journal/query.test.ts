import { describe, expect, it } from "vitest";
import {
  formatCursor,
  JOURNAL_PAGE_SIZE,
  journalArgs,
  journalHref,
  parseCursor,
  parseJournalQuery,
  readJournalQuery,
} from "./query";

const HOUSEHOLD = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";
const EVENT = "0b5e7c1a-3f2d-4e6b-9a8c-7d6e5f4a3b2c";
const US = BigInt("1763029800123456");
const BASE = `/households/${HOUSEHOLD}/journal`;

describe("readJournalQuery", () => {
  it("reads show and before, the first of repeated values, and nothing else", () => {
    expect(readJournalQuery({})).toEqual({ show: "", before: "" });
    expect(
      readJournalQuery({
        show: ["expenses", "household"],
        before: `${US}.${EVENT}`,
        page: "3",
      }),
    ).toEqual({ show: "expenses", before: `${US}.${EVENT}` });
  });
});

describe("parseCursor and formatCursor", () => {
  it("round-trip a time in microseconds and an id", () => {
    const text = formatCursor({ us: US, id: EVENT });
    expect(text).toBe(`1763029800123456.${EVENT}`);
    expect(parseCursor(text)).toEqual({ us: US, id: EVENT });
    expect(parseCursor(`0.${EVENT}`)).toEqual({ us: BigInt(0), id: EVENT });
  });

  it("accepts the largest time that stays exact as a JSON number, and no more", () => {
    const max = `${Number.MAX_SAFE_INTEGER}`;
    expect(parseCursor(`${max}.${EVENT}`)?.us).toBe(BigInt(max));
    expect(parseCursor(`9007199254740992.${EVENT}`)).toBeNull();
  });

  it("rejects anything that isn't exactly a cursor", () => {
    for (const text of [
      "",
      EVENT,
      `${US}`,
      `${US}.`,
      `.${EVENT}`,
      `-1.${EVENT}`,
      `01.${EVENT}`,
      `1.5.${EVENT}`,
      `12345678901234567.${EVENT}`,
      `${US}.${EVENT.toUpperCase()}`,
      `${US}.${EVENT.replaceAll("-", "")}`,
      `${US}.${EVENT}x`,
      ` ${US}.${EVENT}`,
      `${US}_${EVENT}`,
      `1e3.${EVENT}`,
    ]) {
      expect(parseCursor(text), text).toBeNull();
    }
  });
});

describe("parseJournalQuery", () => {
  it("defaults to every entry, newest first", () => {
    expect(parseJournalQuery({ show: "", before: "" })).toEqual({
      ok: true,
      query: { filter: "all", before: null },
    });
    expect(parseJournalQuery({ show: "all", before: "" })).toEqual({
      ok: true,
      query: { filter: "all", before: null },
    });
  });

  it("reads each filter and a cursor", () => {
    for (const show of [
      "expenses",
      "settlements",
      "bills",
      "shopping",
      "chores",
      "budgets",
      "household",
    ] as const) {
      expect(parseJournalQuery({ show, before: `${US}.${EVENT}` })).toEqual({
        ok: true,
        query: { filter: show, before: { us: US, id: EVENT } },
      });
    }
  });

  it("reports an unknown filter or a bad cursor instead of guessing", () => {
    for (const show of ["Expenses", "analytics", "Chores", "expenses ", "0"]) {
      expect(parseJournalQuery({ show, before: "" })).toEqual({
        ok: false,
        problem: "filter",
      });
    }
    expect(parseJournalQuery({ show: "", before: "yesterday" })).toEqual({
      ok: false,
      problem: "cursor",
    });
    // The filter is checked first.
    expect(parseJournalQuery({ show: "nope", before: "nope" })).toEqual({
      ok: false,
      problem: "filter",
    });
  });
});

describe("journalHref", () => {
  it("leaves out the defaults and keeps a fixed order", () => {
    expect(journalHref(BASE, { filter: "all", before: null })).toBe(BASE);
    expect(journalHref(BASE, { filter: "settlements", before: null })).toBe(
      `${BASE}?show=settlements`,
    );
    expect(
      journalHref(BASE, { filter: "all", before: { us: US, id: EVENT } }),
    ).toBe(`${BASE}?before=${US}.${EVENT}`);
    expect(
      journalHref(BASE, { filter: "household", before: { us: US, id: EVENT } }),
    ).toBe(`${BASE}?show=household&before=${US}.${EVENT}`);
  });

  it("writes links the parser reads back to the same query", () => {
    const query = {
      filter: "expenses" as const,
      before: { us: US, id: EVENT },
    };
    const params = new URL(journalHref(BASE, query), "http://x").searchParams;
    expect(
      parseJournalQuery(readJournalQuery(Object.fromEntries(params))),
    ).toEqual({ ok: true, query });
  });
});

describe("journalArgs", () => {
  it("asks for one page of everything by default", () => {
    expect(journalArgs(HOUSEHOLD, { filter: "all", before: null })).toEqual({
      target_household_id: HOUSEHOLD,
      page_size: JOURNAL_PAGE_SIZE,
    });
  });

  it("passes the filter and the cursor exactly", () => {
    expect(
      journalArgs(HOUSEHOLD, {
        filter: "settlements",
        before: { us: US, id: EVENT },
      }),
    ).toEqual({
      target_household_id: HOUSEHOLD,
      category_filter: "settlements",
      before_us: 1763029800123456,
      before_id: EVENT,
      page_size: JOURNAL_PAGE_SIZE,
    });
    expect(JSON.stringify({ n: 1763029800123456 })).toBe(
      '{"n":1763029800123456}',
    );
  });
});
