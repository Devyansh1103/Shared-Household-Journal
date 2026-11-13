import { describe, expect, it } from "vitest";
import {
  CHORE_DESCRIPTION_MAX,
  CHORE_TITLE_MAX,
  EMPTY_CHORE_FORM,
  readChoreForm,
  validateChore,
} from "./form";

const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const QUIN = "33333333-3333-4333-8333-333333333333";
const context = { memberIds: [OLIVE, PAT], today: "2026-11-13" };
const bins = { ...EMPTY_CHORE_FORM, title: "Take out the bins" };

describe("readChoreForm", () => {
  it("reads the fields as text", () => {
    const data = new FormData();
    data.set("title", "Bins");
    data.set("priority", "high");
    data.set("dueOn", "2026-11-14");
    expect(readChoreForm(data)).toEqual({
      title: "Bins",
      description: "",
      assignee: "",
      dueOn: "2026-11-14",
      priority: "high",
    });
  });
});

describe("validateChore", () => {
  it("defaults to medium priority, nobody and no due date", () => {
    expect(validateChore(bins, context)).toEqual({
      ok: true,
      value: {
        title: "Take out the bins",
        description: null,
        assigneeId: null,
        dueOn: null,
        priority: "medium",
      },
    });
  });

  it("keeps everything that was given, trimmed", () => {
    expect(
      validateChore(
        {
          title: " Bins ",
          description: " Blue bin first\n",
          assignee: PAT,
          dueOn: "2026-11-14",
          priority: "high",
        },
        context,
      ),
    ).toEqual({
      ok: true,
      value: {
        title: "Bins",
        description: "Blue bin first",
        assigneeId: PAT,
        dueOn: "2026-11-14",
        priority: "high",
      },
    });
  });

  it("refuses a missing title, long text, a bad date or an unknown priority", () => {
    const result = validateChore(
      {
        title: " ",
        description: "x".repeat(CHORE_DESCRIPTION_MAX + 1),
        assignee: QUIN,
        dueOn: "2026-02-30",
        priority: "urgent",
      },
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual([
        "assignee",
        "description",
        "dueOn",
        "priority",
        "title",
      ]);
    }
    expect(
      validateChore(
        { ...bins, title: "x".repeat(CHORE_TITLE_MAX + 1) },
        context,
      ).ok,
    ).toBe(false);
  });

  it("allows a due date from a year back to ten years ahead", () => {
    const due = (dueOn: string) =>
      validateChore({ ...bins, dueOn }, context).ok;
    expect(due("2026-11-12")).toBe(true); // overdue already is fine
    expect(due("2025-11-12")).toBe(true);
    expect(due("2025-11-11")).toBe(false);
    expect(due("2036-11-20")).toBe(true);
    expect(due("2036-11-21")).toBe(false);
  });

  it("keeps an old due date or a former member when editing (D13)", () => {
    const current = { assigneeId: QUIN, dueOn: "2024-01-01" };
    expect(
      validateChore(
        { ...bins, assignee: QUIN, dueOn: "2024-01-01" },
        {
          ...context,
          current,
        },
      ),
    ).toMatchObject({
      ok: true,
      value: { assigneeId: QUIN, dueOn: "2024-01-01" },
    });
    expect(
      validateChore(
        { ...bins, assignee: QUIN, dueOn: "2024-01-02" },
        {
          ...context,
          current,
        },
      ).ok,
    ).toBe(false);
  });
});
