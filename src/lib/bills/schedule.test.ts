import { describe, expect, it } from "vitest";
import { isCalendarDate } from "@/lib/expenses/dates";
import {
  addDays,
  addMonths,
  daysBetween,
  dueDate,
  dueKind,
  dueLabel,
  firstDueDates,
  presetFor,
  scheduleLabel,
} from "./schedule";

const dates = (
  anchor: string,
  unit: "week" | "month" | "year",
  every: number,
  n: number,
) => Array.from({ length: n }, (_, k) => dueDate(anchor, unit, every, k));

describe("dueDate", () => {
  it("repeats weekly and every two weeks, across a month and a year end", () => {
    expect(dates("2026-11-13", "week", 1, 4)).toEqual([
      "2026-11-13",
      "2026-11-20",
      "2026-11-27",
      "2026-12-04",
    ]);
    expect(dates("2026-12-28", "week", 2, 4)).toEqual([
      "2026-12-28",
      "2027-01-11",
      "2027-01-25",
      "2027-02-08",
    ]);
  });

  it("puts a monthly bill on the 31st on the last day of shorter months, then back on the 31st (D10)", () => {
    expect(dates("2026-01-31", "month", 1, 6)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
    // In a leap year February has a 29th.
    expect(dueDate("2028-01-31", "month", 1, 1)).toBe("2028-02-29");
    expect(dates("2027-01-29", "month", 1, 3)).toEqual([
      "2027-01-29",
      "2027-02-28",
      "2027-03-29",
    ]);
    expect(dates("2026-08-30", "month", 1, 3)).toEqual([
      "2026-08-30",
      "2026-09-30",
      "2026-10-30",
    ]);
  });

  it("repeats quarterly as every 3 months", () => {
    expect(dates("2026-11-30", "month", 3, 5)).toEqual([
      "2026-11-30",
      "2027-02-28",
      "2027-05-30",
      "2027-08-30",
      "2027-11-30",
    ]);
  });

  it("puts a yearly bill on 29 February on the 28th in other years", () => {
    expect(dates("2028-02-29", "year", 1, 5)).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
    expect(dates("2026-11-13", "year", 2, 3)).toEqual([
      "2026-11-13",
      "2028-11-13",
      "2030-11-13",
    ]);
  });

  it("always gives a real date, worked out from the anchor (never drifting)", () => {
    // Every anchor over three years (a leap year among them), 31 periods each.
    const wrong: string[] = [];
    for (let d = 0; d < 366 * 3; d++) {
      const anchor = addDays("2026-01-01", d);
      const day = Number(anchor.slice(8));
      for (const [unit, every] of [
        ["month", 1],
        ["month", 3],
        ["year", 1],
      ] as const) {
        for (let k = 0; k <= 30; k++) {
          const date = dueDate(anchor, unit, every, k);
          const got = Number(date.slice(8));
          if (!isCalendarDate(date) || (day <= 28 ? got !== day : got > day)) {
            wrong.push(`${anchor} ${unit}×${every} #${k} → ${date}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("date helpers", () => {
  it("add days and months, and count the days between", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
    expect(addMonths("2026-05-31", -3)).toBe("2026-02-28");
    expect(daysBetween("2026-11-13", "2026-11-20")).toBe(7);
    expect(daysBetween("2026-11-13", "2026-11-10")).toBe(-3);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});

describe("firstDueDates", () => {
  it("lists the next due dates, stopping at the last due date", () => {
    expect(firstDueDates("2026-01-31", "month", 1, 3)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
    expect(firstDueDates("2026-11-01", "month", 1, 10, "2027-01-15")).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
  });
});

describe("labels", () => {
  it("names schedules and finds their preset", () => {
    expect(scheduleLabel("week", 1)).toBe("Every week");
    expect(scheduleLabel("week", 2)).toBe("Every 2 weeks");
    expect(scheduleLabel("month", 3)).toBe("Every 3 months");
    expect(scheduleLabel("year", 1)).toBe("Every year");
    expect(presetFor("week", 2)).toBe("fortnightly");
    expect(presetFor("month", 3)).toBe("quarterly");
    expect(presetFor("month", 2)).toBe("custom");
    expect(presetFor("year", 1)).toBe("yearly");
  });

  it("say how far off a due date is, with 'due soon' up to 7 days ahead", () => {
    const today = "2026-11-13";
    expect([dueKind(today, today), dueLabel(today, today)]).toEqual([
      "today",
      "Due today",
    ]);
    expect([
      dueKind("2026-11-14", today),
      dueLabel("2026-11-14", today),
    ]).toEqual(["soon", "Due tomorrow"]);
    expect([
      dueKind("2026-11-20", today),
      dueLabel("2026-11-20", today),
    ]).toEqual(["soon", "Due in 7 days"]);
    expect(dueKind("2026-11-21", today)).toBe("later");
    expect([
      dueKind("2026-11-12", today),
      dueLabel("2026-11-12", today),
    ]).toEqual(["overdue", "1 day overdue"]);
    expect(dueLabel("2026-11-01", today)).toBe("12 days overdue");
  });
});
