// Reading and validating the chore form (roadmap Phase 15). Pure: the Server
// Actions pass the household's real active members and "today" in its
// timezone (D11); the database checks everything again.

import { addDays } from "@/lib/bills/schedule";
import { isCalendarDate } from "@/lib/expenses/dates";
import { validAssignee, type Validation } from "@/lib/shopping/form";

export const CHORE_TITLE_MAX = 120;
export const CHORE_DESCRIPTION_MAX = 1000;
/** A new or changed due date: up to a year back, up to ten years ahead. */
export const EARLIEST_DUE_DAYS = 366;
export const LATEST_DUE_DAYS = 3660;

export const CHORE_PRIORITIES = ["low", "medium", "high"] as const;
export type ChorePriority = (typeof CHORE_PRIORITIES)[number];

export const PRIORITY_LABELS: Record<ChorePriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function isPriority(value: string): value is ChorePriority {
  return (CHORE_PRIORITIES as readonly string[]).includes(value);
}

/** The form as typed, kept to show again after an error. */
export type RawChoreForm = {
  title: string;
  description: string;
  /** A member's id, or "" for nobody. */
  assignee: string;
  /** "YYYY-MM-DD", or "" for no due date. */
  dueOn: string;
  priority: string;
};

export type ChoreValues = {
  title: string;
  description: string | null;
  assigneeId: string | null;
  dueOn: string | null;
  priority: ChorePriority;
};

export const EMPTY_CHORE_FORM: RawChoreForm = {
  title: "",
  description: "",
  assignee: "",
  dueOn: "",
  priority: "medium",
};

export function readChoreForm(formData: FormData): RawChoreForm {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    title: text("title"),
    description: text("description"),
    assignee: text("assignee"),
    dueOn: text("dueOn"),
    priority: text("priority"),
  };
}

export function validateChore(
  raw: RawChoreForm,
  context: {
    memberIds: readonly string[];
    today: string;
    /** When editing: what it is now, which may stay as it is. */
    current?: { assigneeId: string | null; dueOn: string | null };
  },
): Validation<ChoreValues> {
  const errors: Record<string, string> = {};
  const title = raw.title.trim();
  const description = raw.description.trim();
  const dueOn = raw.dueOn.trim();

  if (title === "")
    errors.title = "Say what needs doing, like “Take out the bins”.";
  else if (title.length > CHORE_TITLE_MAX) {
    errors.title = `Use ${CHORE_TITLE_MAX} characters or fewer.`;
  }
  if (description.length > CHORE_DESCRIPTION_MAX) {
    errors.description = `Use ${CHORE_DESCRIPTION_MAX} characters or fewer.`;
  }
  if (
    !validAssignee(raw.assignee, {
      memberIds: context.memberIds,
      currentAssigneeId: context.current?.assigneeId,
    })
  ) {
    errors.assignee = "Choose a current member, or nobody.";
  }
  if (dueOn !== "" && dueOn !== context.current?.dueOn) {
    if (!isCalendarDate(dueOn)) errors.dueOn = "Choose a real date.";
    else if (dueOn < addDays(context.today, -EARLIEST_DUE_DAYS)) {
      errors.dueOn = "Choose a date within the past year, or a later one.";
    } else if (dueOn > addDays(context.today, LATEST_DUE_DAYS)) {
      errors.dueOn = "Choose a date within the next ten years.";
    }
  }
  if (!isPriority(raw.priority))
    errors.priority = "Choose low, medium or high.";

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    value: {
      title,
      description: description === "" ? null : description,
      assigneeId: raw.assignee === "" ? null : raw.assignee,
      dueOn: dueOn === "" ? null : dueOn,
      priority: raw.priority as ChorePriority,
    },
  };
}
