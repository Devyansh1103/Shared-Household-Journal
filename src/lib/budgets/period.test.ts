import { describe, expect, it } from "vitest";
import {
  periodEnd,
  periodLabel,
  periodStart,
  relativePeriod,
  shiftPeriod,
} from "./period";

describe("periodStart and periodEnd", () => {
  it("runs weeks Monday to Sunday (D25), across months and years", () => {
    expect(periodStart("2026-11-13", "week")).toBe("2026-11-09"); // a Friday
    expect(periodStart("2026-11-09", "week")).toBe("2026-11-09"); // a Monday
    expect(periodStart("2026-11-15", "week")).toBe("2026-11-09"); // a Sunday
    expect(periodStart("2027-01-03", "week")).toBe("2026-12-28");
    expect(periodEnd("2026-12-28", "week")).toBe("2027-01-03");
  });

  it("uses calendar months, whatever their length", () => {
    expect(periodStart("2026-11-30", "month")).toBe("2026-11-01");
    expect(periodEnd("2026-11-01", "month")).toBe("2026-11-30");
    expect(periodEnd("2026-12-01", "month")).toBe("2026-12-31");
    expect(periodEnd("2027-02-01", "month")).toBe("2027-02-28");
    expect(periodEnd("2028-02-01", "month")).toBe("2028-02-29"); // a leap year
    expect(periodStart("2028-02-29", "month")).toBe("2028-02-01");
  });

  it("uses calendar quarters", () => {
    expect(periodStart("2026-11-13", "quarter")).toBe("2026-10-01");
    expect(periodStart("2026-01-01", "quarter")).toBe("2026-01-01");
    expect(periodStart("2026-03-31", "quarter")).toBe("2026-01-01");
    expect(periodStart("2026-04-01", "quarter")).toBe("2026-04-01");
    expect(periodEnd("2026-10-01", "quarter")).toBe("2026-12-31");
    expect(periodEnd("2028-01-01", "quarter")).toBe("2028-03-31");
  });

  it("contains every day of a year exactly once, for every kind of period", () => {
    for (const kind of ["week", "month", "quarter"] as const) {
      let day = "2027-12-27";
      let start = periodStart(day, kind);
      while (day <= "2029-01-05") {
        const s = periodStart(day, kind);
        expect(s <= day && day <= periodEnd(s, kind), `${kind} ${day}`).toBe(
          true,
        );
        if (s !== start) {
          expect(s, `${kind} ${day}`).toBe(shiftPeriod(start, kind, 1));
          start = s;
        }
        const [y, m, d] = day.split("-").map(Number);
        day = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      }
    }
  });
});

describe("periodLabel and relativePeriod", () => {
  it("names a period in words", () => {
    expect(periodLabel("2026-11-01", "month")).toBe("November 2026");
    expect(periodLabel("2026-10-01", "quarter")).toBe(
      "October–December 2026 (Q4)",
    );
    expect(periodLabel("2026-11-09", "week")).toBe("9–15 Nov 2026");
    expect(periodLabel("2026-11-30", "week")).toBe("30 Nov – 6 Dec 2026");
    expect(periodLabel("2026-12-28", "week")).toBe("28 Dec 2026 – 3 Jan 2027");
  });

  it("says this, last or next, and nothing for others", () => {
    expect(relativePeriod("2026-11-01", "month", "2026-11-13")).toBe(
      "this month",
    );
    expect(relativePeriod("2026-10-01", "month", "2026-11-13")).toBe(
      "last month",
    );
    expect(relativePeriod("2026-11-02", "week", "2026-11-13")).toBe(
      "last week",
    );
    expect(relativePeriod("2026-07-01", "quarter", "2026-11-13")).toBe(
      "last quarter",
    );
    expect(relativePeriod("2026-09-01", "month", "2026-11-13")).toBeNull();
  });
});
