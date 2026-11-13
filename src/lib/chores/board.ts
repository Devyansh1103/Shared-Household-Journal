// The chores page's sections and filters (roadmap Phase 15), and who may do
// what (D28, proposed; the database enforces the same rules). Only from the
// household's real chores, in its timezone (D11): "overdue" and "due today"
// are worked out from the household's date, never stored. Pure.

import { dueLabel } from "@/lib/bills/schedule";
import { matchesWho, readWho, type WhoFilter } from "@/lib/shopping/list";
import { isPriority, type ChorePriority } from "./form";

export type Chore = {
  id: string;
  householdId: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  dueOn: string | null;
  priority: ChorePriority;
  createdBy: string;
  completedAt: string | null;
  completedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export const CHORE_VIEWS = ["open", "completed", "all"] as const;
export type ChoreView = (typeof CHORE_VIEWS)[number];

export const CHORE_VIEW_LABELS: Record<ChoreView, string> = {
  open: "To do",
  completed: "Done",
  all: "All",
};

export type ChoreQuery = {
  show: ChoreView;
  who: WhoFilter;
  priority: ChorePriority | "any";
};

export const DEFAULT_CHORE_QUERY: ChoreQuery = {
  show: "open",
  who: "anyone",
  priority: "any",
};

type Param = string | string[] | undefined;

export function readChoreQuery(
  params: { show?: Param; who?: Param; priority?: Param },
  personIds: readonly string[],
): ChoreQuery {
  const show = typeof params.show === "string" ? params.show : "";
  const priority = typeof params.priority === "string" ? params.priority : "";
  return {
    show: (CHORE_VIEWS as readonly string[]).includes(show)
      ? (show as ChoreView)
      : DEFAULT_CHORE_QUERY.show,
    who: readWho(params.who, personIds),
    priority: isPriority(priority) ? priority : "any",
  };
}

export function choresHref(base: string, query: ChoreQuery): string {
  const params = new URLSearchParams();
  if (query.show !== DEFAULT_CHORE_QUERY.show) params.set("show", query.show);
  if (query.who !== "anyone") params.set("who", query.who);
  if (query.priority !== "any") params.set("priority", query.priority);
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

export type ChoreDue = "overdue" | "today" | "upcoming" | "anytime";

/** Where an open chore stands on the household's date. */
export function choreDue(dueOn: string | null, today: string): ChoreDue {
  if (dueOn === null) return "anytime";
  if (dueOn < today) return "overdue";
  return dueOn === today ? "today" : "upcoming";
}

/** "Due today", "2 days overdue", "Due in 5 days"; null without a due date. */
export function choreDueLabel(
  chore: Pick<Chore, "dueOn" | "completedAt">,
  today: string,
): string | null {
  if (chore.dueOn === null || chore.completedAt !== null) return null;
  return dueLabel(chore.dueOn, today);
}

export type ChoreBoard = {
  /** Open chores assigned to the viewer (only when not filtered by person). */
  mine: Chore[];
  overdue: Chore[];
  dueToday: Chore[];
  upcoming: Chore[];
  /** Open, with no due date. */
  anytime: Chore[];
  /** Most recently done first. */
  completed: Chore[];
};

const RANK: Record<ChorePriority, number> = { high: 0, medium: 1, low: 2 };

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Soonest due first (no date last), then the most urgent, then the oldest. */
export function byDue(a: Chore, b: Chore): number {
  if (a.dueOn !== b.dueOn) {
    if (a.dueOn === null) return 1;
    if (b.dueOn === null) return -1;
    return compare(a.dueOn, b.dueOn);
  }
  return (
    RANK[a.priority] - RANK[b.priority] ||
    compare(a.createdAt, b.createdAt) ||
    compare(a.id, b.id)
  );
}

/**
 * The chores page. Each chore shows once: the viewer's own open chores under
 * "My tasks", everyone else's (and nobody's) by when they're due.
 */
export function choreBoard(
  chores: readonly Chore[],
  context: { today: string; viewerId: string; query: ChoreQuery },
): ChoreBoard {
  const { today, viewerId, query } = context;
  const board: ChoreBoard = {
    mine: [],
    overdue: [],
    dueToday: [],
    upcoming: [],
    anytime: [],
    completed: [],
  };
  const separateMine = query.who === "anyone";

  for (const chore of chores) {
    if (!matchesWho(chore.assigneeId, query.who, viewerId)) continue;
    if (query.priority !== "any" && chore.priority !== query.priority) continue;
    if (chore.completedAt !== null) {
      if (query.show !== "open") board.completed.push(chore);
      continue;
    }
    if (query.show === "completed") continue;
    if (separateMine && chore.assigneeId === viewerId) {
      board.mine.push(chore);
      continue;
    }
    switch (choreDue(chore.dueOn, today)) {
      case "overdue":
        board.overdue.push(chore);
        break;
      case "today":
        board.dueToday.push(chore);
        break;
      case "upcoming":
        board.upcoming.push(chore);
        break;
      case "anytime":
        board.anytime.push(chore);
        break;
    }
  }

  for (const list of [
    board.mine,
    board.overdue,
    board.dueToday,
    board.upcoming,
    board.anytime,
  ]) {
    list.sort(byDue);
  }
  board.completed.sort(
    (a, b) =>
      compare(b.completedAt ?? "", a.completedAt ?? "") || compare(a.id, b.id),
  );
  return board;
}

export function boardIsEmpty(board: ChoreBoard): boolean {
  return Object.values(board).every((list) => list.length === 0);
}

export type Viewer = { userId: string; isOwner: boolean };

/** D28 (proposed): who may edit, reassign or remove a chore. */
export function canManageChore(
  chore: Pick<Chore, "createdBy" | "assigneeId">,
  viewer: Viewer,
): boolean {
  return (
    viewer.isOwner ||
    chore.createdBy === viewer.userId ||
    chore.assigneeId === viewer.userId
  );
}

/**
 * D28 (proposed): who may mark it done or not done: the same people, or
 * anyone when it's assigned to nobody or to someone who has left (D13).
 */
export function canFinishChore(
  chore: Pick<Chore, "createdBy" | "assigneeId">,
  viewer: Viewer,
  activeMemberIds: ReadonlySet<string>,
): boolean {
  return (
    canManageChore(chore, viewer) ||
    chore.assigneeId === null ||
    !activeMemberIds.has(chore.assigneeId)
  );
}
