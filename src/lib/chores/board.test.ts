import { describe, expect, it } from "vitest";
import {
  boardIsEmpty,
  byDue,
  canFinishChore,
  canManageChore,
  choreBoard,
  choreDue,
  choreDueLabel,
  choresHref,
  readChoreQuery,
  type Chore,
  type ChoreQuery,
} from "./board";

const HOUSEHOLD = "6f1c2f4e-8a7b-4c3d-9e2f-1a2b3c4d5e6f";
const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const QUIN = "33333333-3333-4333-8333-333333333333";
const TODAY = "2026-11-13";

function chore(n: number, overrides: Partial<Chore> = {}): Chore {
  return {
    id: `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    householdId: HOUSEHOLD,
    title: `Chore ${n}`,
    description: null,
    assigneeId: null,
    dueOn: null,
    priority: "medium",
    createdBy: OLIVE,
    completedAt: null,
    completedBy: null,
    createdAt: `2026-11-01T10:00:${String(n).padStart(2, "0")}+00:00`,
    updatedAt: `2026-11-01T10:00:${String(n).padStart(2, "0")}+00:00`,
    ...overrides,
  };
}

const anyone: ChoreQuery = { show: "open", who: "anyone", priority: "any" };
const titles = (list: Chore[]) => list.map((c) => c.title);

describe("choreDue", () => {
  it("works out overdue and due today from the household's date (D11)", () => {
    expect(choreDue("2026-11-12", TODAY)).toBe("overdue");
    expect(choreDue(TODAY, TODAY)).toBe("today");
    expect(choreDue("2026-11-14", TODAY)).toBe("upcoming");
    expect(choreDue(null, TODAY)).toBe("anytime");
  });

  it("labels it in words, and not once it's done", () => {
    expect(
      choreDueLabel({ dueOn: "2026-11-11", completedAt: null }, TODAY),
    ).toBe("2 days overdue");
    expect(choreDueLabel({ dueOn: TODAY, completedAt: null }, TODAY)).toBe(
      "Due today",
    );
    expect(
      choreDueLabel(
        { dueOn: "2026-11-11", completedAt: "2026-11-12T10:00:00Z" },
        TODAY,
      ),
    ).toBeNull();
    expect(choreDueLabel({ dueOn: null, completedAt: null }, TODAY)).toBeNull();
  });
});

describe("choreBoard", () => {
  const chores = [
    chore(1, { dueOn: "2026-11-10" }),
    chore(2, { dueOn: TODAY, assigneeId: PAT }),
    chore(3, { dueOn: "2026-11-20", priority: "low" }),
    chore(4),
    chore(5, { dueOn: "2026-11-12", assigneeId: OLIVE }),
    chore(6, {
      completedAt: "2026-11-12T10:00:00+00:00",
      completedBy: PAT,
      assigneeId: PAT,
    }),
    chore(7, { dueOn: "2026-11-20", priority: "high" }),
    chore(8, {
      completedAt: "2026-11-13T08:00:00+00:00",
      completedBy: OLIVE,
      priority: "high",
    }),
  ];

  it("puts each open chore in one section, the viewer's own under My tasks", () => {
    const board = choreBoard(chores, {
      today: TODAY,
      viewerId: OLIVE,
      query: anyone,
    });
    expect(titles(board.mine)).toEqual(["Chore 5"]);
    expect(titles(board.overdue)).toEqual(["Chore 1"]);
    expect(titles(board.dueToday)).toEqual(["Chore 2"]);
    // Same date: the more urgent first.
    expect(titles(board.upcoming)).toEqual(["Chore 7", "Chore 3"]);
    expect(titles(board.anytime)).toEqual(["Chore 4"]);
    expect(board.completed).toEqual([]);
  });

  it("shows what's done, most recent first", () => {
    const done = choreBoard(chores, {
      today: TODAY,
      viewerId: OLIVE,
      query: { ...anyone, show: "completed" },
    });
    expect(titles(done.completed)).toEqual(["Chore 8", "Chore 6"]);
    expect(done.overdue).toEqual([]);
    const all = choreBoard(chores, {
      today: TODAY,
      viewerId: OLIVE,
      query: { ...anyone, show: "all" },
    });
    expect(all.completed).toHaveLength(2);
    expect(all.overdue).toHaveLength(1);
  });

  it("filters by person and priority", () => {
    const pats = choreBoard(chores, {
      today: TODAY,
      viewerId: OLIVE,
      query: { show: "all", who: PAT, priority: "any" },
    });
    expect([...titles(pats.dueToday), ...titles(pats.completed)]).toEqual([
      "Chore 2",
      "Chore 6",
    ]);
    // Filtered to "me": by when they're due, no separate My tasks.
    const mine = choreBoard(chores, {
      today: TODAY,
      viewerId: OLIVE,
      query: { ...anyone, who: "me" },
    });
    expect(mine.mine).toEqual([]);
    expect(titles(mine.overdue)).toEqual(["Chore 5"]);
    const nobody = choreBoard(chores, {
      today: TODAY,
      viewerId: OLIVE,
      query: { ...anyone, who: "nobody" },
    });
    expect(
      titles([...nobody.overdue, ...nobody.upcoming, ...nobody.anytime]),
    ).toEqual(["Chore 1", "Chore 7", "Chore 3", "Chore 4"]);
    const high = choreBoard(chores, {
      today: TODAY,
      viewerId: OLIVE,
      query: { show: "all", who: "anyone", priority: "high" },
    });
    expect([...titles(high.upcoming), ...titles(high.completed)]).toEqual([
      "Chore 7",
      "Chore 8",
    ]);
    expect(
      boardIsEmpty(
        choreBoard(chores, {
          today: TODAY,
          viewerId: OLIVE,
          query: { show: "completed", who: QUIN, priority: "any" },
        }),
      ),
    ).toBe(true);
  });

  it("sorts soonest first with no date last", () => {
    const sorted = [
      chore(1),
      chore(2, { dueOn: "2026-12-01" }),
      chore(3, { dueOn: TODAY }),
    ]
      .sort(byDue)
      .map((c) => c.title);
    expect(sorted).toEqual(["Chore 3", "Chore 2", "Chore 1"]);
  });
});

describe("readChoreQuery and choresHref", () => {
  it("reads known values only and leaves defaults out of the URL", () => {
    const people = [OLIVE, PAT];
    expect(readChoreQuery({}, people)).toEqual(anyone);
    expect(
      readChoreQuery({ show: "completed", who: PAT, priority: "high" }, people),
    ).toEqual({ show: "completed", who: PAT, priority: "high" });
    expect(
      readChoreQuery({ show: "done", who: QUIN, priority: "urgent" }, people),
    ).toEqual(anyone);
    expect(choresHref("/c", anyone)).toBe("/c");
    expect(choresHref("/c", { show: "all", who: "me", priority: "low" })).toBe(
      "/c?show=all&who=me&priority=low",
    );
  });
});

describe("who may do what (D28, proposed)", () => {
  const active = new Set([OLIVE, PAT]);
  const member = (userId: string) => ({ userId, isOwner: false });
  const owner = { userId: QUIN, isOwner: true };
  const patsChore = { createdBy: OLIVE, assigneeId: PAT };

  it("lets the person who added it, its assignee or the owner change it", () => {
    expect(canManageChore(patsChore, member(OLIVE))).toBe(true);
    expect(canManageChore(patsChore, member(PAT))).toBe(true);
    expect(canManageChore(patsChore, owner)).toBe(true);
    expect(
      canManageChore({ createdBy: OLIVE, assigneeId: OLIVE }, member(PAT)),
    ).toBe(false);
  });

  it("lets anyone finish a chore for nobody, or for someone who has left (D13)", () => {
    const raj = member("44444444-4444-4444-8444-444444444444");
    expect(canFinishChore(patsChore, raj, active)).toBe(false);
    expect(
      canFinishChore({ createdBy: OLIVE, assigneeId: null }, raj, active),
    ).toBe(true);
    expect(
      canFinishChore({ createdBy: OLIVE, assigneeId: QUIN }, raj, active),
    ).toBe(true);
    expect(canFinishChore(patsChore, member(PAT), active)).toBe(true);
  });
});
