import { describe, expect, it } from "vitest";
import {
  dayIn,
  dayKind,
  entryTimeLabel,
  groupByDay,
  instantFromMicroseconds,
} from "./days";

const KOLKATA = "Asia/Kolkata";
/** Friday 13 November 2026, 10:00 in India (UTC+05:30). */
const NOW = new Date("2026-11-13T04:30:00Z");

type Item = { name: string; at: string };

function group(
  items: Item[],
  now = NOW,
  timeZone = KOLKATA,
  weekStartsOn?: number,
) {
  return groupByDay(items, (item) => new Date(item.at), {
    now,
    timeZone,
    weekStartsOn,
  }).map((g) => ({
    key: g.key,
    kind: g.kind,
    label: g.label,
    names: g.entries.map((e) => e.name),
  }));
}

describe("groupByDay", () => {
  it("groups by the household's own days: today, yesterday, this week, then each day", () => {
    const items: Item[] = [
      { name: "A", at: "2026-11-13T03:00:00Z" }, // Fri 08:30
      { name: "B", at: "2026-11-12T19:00:00Z" }, // Fri 00:30 (Thu in UTC)
      { name: "C", at: "2026-11-12T18:00:00Z" }, // Thu 23:30
      { name: "D", at: "2026-11-12T10:00:00Z" }, // Thu 15:30
      { name: "E", at: "2026-11-11T06:00:00Z" }, // Wed 11:30
      { name: "F", at: "2026-11-08T19:00:00Z" }, // Mon 00:30 (Sun in UTC)
      { name: "G", at: "2026-11-08T12:00:00Z" }, // Sun 17:30
      { name: "H", at: "2026-11-08T05:00:00Z" }, // Sun 10:30
      { name: "I", at: "2026-10-30T12:00:00Z" }, // Fri 30 Oct
    ];
    expect(group(items)).toEqual([
      { key: "today", kind: "today", label: "Today", names: ["A", "B"] },
      {
        key: "yesterday",
        kind: "yesterday",
        label: "Yesterday",
        names: ["C", "D"],
      },
      {
        key: "week",
        kind: "week",
        label: "Earlier this week",
        names: ["E", "F"],
      },
      {
        key: "2026-11-08",
        kind: "date",
        label: "Sunday, 8 November 2026",
        names: ["G", "H"],
      },
      {
        key: "2026-10-30",
        kind: "date",
        label: "Friday, 30 October 2026",
        names: ["I"],
      },
    ]);
  });

  it("uses the household's timezone, not the server's", () => {
    // 19:00 UTC on Thursday is already Friday in India, but not in London.
    const items: Item[] = [{ name: "B", at: "2026-11-12T19:00:00Z" }];
    expect(group(items, NOW, KOLKATA)[0].key).toBe("today");
    expect(group(items, NOW, "Europe/London")[0].key).toBe("yesterday");
  });

  it("on a Monday, yesterday is last week's Sunday and Saturday is a date", () => {
    const monday = new Date("2026-11-09T04:30:00Z");
    expect(
      group(
        [
          { name: "Sun", at: "2026-11-08T06:00:00Z" },
          { name: "Sat", at: "2026-11-07T06:00:00Z" },
        ],
        monday,
      ),
    ).toEqual([
      {
        key: "yesterday",
        kind: "yesterday",
        label: "Yesterday",
        names: ["Sun"],
      },
      {
        key: "2026-11-07",
        kind: "date",
        label: "Saturday, 7 November 2026",
        names: ["Sat"],
      },
    ]);
  });

  it("follows the week's first day (D25: Monday, by default)", () => {
    const sunday: Item[] = [{ name: "Sun", at: "2026-11-08T06:00:00Z" }];
    expect(group(sunday)[0].kind).toBe("date");
    expect(group(sunday, NOW, KOLKATA, 0)[0]).toMatchObject({
      key: "week",
      label: "Earlier this week",
    });
  });

  it("puts anything after now (a clock running ahead) under Today", () => {
    expect(group([{ name: "Later", at: "2026-11-13T20:00:00Z" }])[0].key).toBe(
      "today",
    );
  });

  it("returns no groups for no entries", () => {
    expect(group([])).toEqual([]);
  });
});

describe("dayKind", () => {
  it("compares calendar days", () => {
    expect(dayKind("2026-11-13", "2026-11-13")).toBe("today");
    expect(dayKind("2026-11-12", "2026-11-13")).toBe("yesterday");
    expect(dayKind("2026-11-09", "2026-11-13")).toBe("week");
    expect(dayKind("2026-11-08", "2026-11-13")).toBe("date");
    // Across a month and a year.
    expect(dayKind("2026-12-31", "2027-01-01")).toBe("yesterday");
    expect(dayKind("2026-02-28", "2026-03-01")).toBe("yesterday");
  });
});

describe("entryTimeLabel", () => {
  it("shows the time, with the weekday under Earlier this week", () => {
    const at = new Date("2026-11-11T06:00:00Z");
    expect(entryTimeLabel(at, "today", KOLKATA)).toBe("11:30 am");
    expect(entryTimeLabel(at, "date", KOLKATA)).toBe("11:30 am");
    expect(entryTimeLabel(at, "week", KOLKATA)).toBe("Wed, 11:30 am");
  });
});

describe("instantFromMicroseconds and dayIn", () => {
  it("turn the journal's microseconds into an instant and a household day", () => {
    const instant = instantFromMicroseconds(BigInt("1763029800123456"));
    expect(instant.toISOString()).toBe("2025-11-13T10:30:00.123Z");
    expect(dayIn(instant, KOLKATA)).toBe("2025-11-13");
    expect(dayIn(new Date("2026-11-12T19:00:00Z"), KOLKATA)).toBe("2026-11-13");
  });
});
