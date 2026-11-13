// Words for the journal's entries (roadmap Phase 13). Each entry says who did
// what, in the app's own words: "You added an expense", "Pat recorded a
// payment of ₹500.00 to Olive" (D9: recorded, never sent or completed), "Olive
// made Quin the owner". People are named from the page's own list, with
// "(left)" for anyone who has left (D13). Nothing here shows an id, a note, or
// anything else the journal's read model leaves out; ids appear only in link
// targets.

import type { Subject } from "@/lib/balances/explain";
import { categoryLabel } from "@/lib/expenses/categories";
import { formatDate, formatMoney } from "@/lib/format";
import { paymentTitle, recordedSentence } from "@/lib/settlements/wording";
import {
  entryCategory,
  type ExpenseChangeFields,
  type JournalEntity,
  type JournalEntry,
  type JournalPerson,
} from "./payload";
import type { JournalCategory } from "./query";

export type EntryChange =
  /** "Amount: ₹1,200.00 → ₹1,250.00" */
  | { kind: "value"; label: string; from: string; to: string }
  /** "Who shares it: added Quin" */
  | { kind: "text"; label: string; text: string };

export type EntryLink = {
  href: string;
  /** What the link says: "View expense". */
  label: string;
  /**
   * Its accessible name: the visible words first (WCAG 2.5.3), then the
   * record when links on the page would otherwise sound alike: "View
   * expense: Groceries".
   */
  accessibleLabel: string;
};

export type EntryDescription = {
  category: JournalCategory;
  /** The category in words ("Expense"), so the icon is never the only signal. */
  categoryLabel: string;
  /** Who did what: "You added an expense". */
  title: string;
  /** What it was: "Groceries — ₹1,250.00". */
  summary: string | null;
  /** More about it, each shown on its own: "Paid by Pat". */
  context: string[];
  /** What an edit changed (D6). */
  changes: EntryChange[];
  /** The record it's about, or the household's list it belongs to. */
  link: EntryLink | null;
  /** The expense or payment it's about isn't in the household any more. */
  unavailable: boolean;
};

export type DescribeContext = {
  householdId: string;
  /** The signed-in member, who reads "You". */
  viewerId: string;
  /** The household's currency (D1): every amount in the journal is in it. */
  currency: string;
  /** Everyone the page's entries mention. */
  people: readonly JournalPerson[];
};

const CATEGORY_LABELS: Record<JournalCategory, string> = {
  expenses: "Expense",
  settlements: "Payment",
  household: "Household",
};

const METHOD_LABELS: Record<ExpenseChangeFields["splitMethod"], string> = {
  equal: "Equally",
  percentage: "By percentage",
  custom: "By custom amounts",
};

const LOCALE = "en-IN";

/** "Quin", "Quin and Raj", "Quin, Raj and Sam". */
function listOf(names: string[]): string {
  return new Intl.ListFormat(LOCALE, {
    style: "long",
    type: "conjunction",
  }).format(names);
}

/** Starts a sentence: "You" or the name (names are never re-cased). */
function lead(subject: Subject): string {
  return subject.you ? "You" : subject.name;
}

/** Anywhere else in a sentence: "you" or the name. */
function mention(subject: Subject): string {
  return subject.you ? "you" : subject.name;
}

/**
 * A function that describes entries for one page: the people are looked up
 * once, and every entry is described the same way.
 */
export function entryDescriber(
  context: DescribeContext,
): (entry: JournalEntry) => EntryDescription {
  const people = new Map(context.people.map((p) => [p.userId, p]));
  const base = `/households/${context.householdId}`;
  const money = (minor: bigint) => formatMoney(minor, context.currency);

  /**
   * Someone in an entry: "you", their name, or their name with "(left)"
   * (D13), unless the sentence itself says they left. An id the page doesn't
   * know is never shown.
   */
  function subject(
    userId: string | null,
    { leftLabel = true }: { leftLabel?: boolean } = {},
  ): Subject {
    // Only a change made outside a user session has no actor.
    if (userId === null) return { you: false, name: "Someone" };
    const person = people.get(userId);
    if (!person) return { you: false, name: "Former member" };
    if (userId === context.viewerId) {
      return { you: true, name: person.displayName };
    }
    return {
      you: false,
      name:
        person.isActive || !leftLabel
          ? person.displayName
          : `${person.displayName} (left)`,
    };
  }

  // Every one of these goes to the same place, so the visible words are the
  // whole name (an accessible name must contain what's shown: WCAG 2.5.3).
  const membersLink: EntryLink = {
    href: `${base}#members`,
    label: "See members",
    accessibleLabel: "See members",
  };
  const invitesLink: EntryLink = {
    href: `${base}#invite-links`,
    label: "See invite links",
    accessibleLabel: "See invite links",
  };

  function expenseLink(
    entity: JournalEntity | null,
    description: string,
  ): EntryLink | null {
    if (!entity?.available) return null;
    const label =
      entity.state === "deleted" ? "View deleted expense" : "View expense";
    return {
      href: `${base}/expenses/${entity.id}`,
      label,
      accessibleLabel: `${label}: ${description}`,
    };
  }

  function paymentLink(
    entity: JournalEntity | null,
    about: string,
  ): EntryLink | null {
    if (!entity?.available) return null;
    const label =
      entity.state === "voided" ? "View voided payment" : "View payment";
    return {
      href: `${base}/settlements/${entity.id}`,
      label,
      accessibleLabel: `${label}: ${about}`,
    };
  }

  /** D6: what an edit changed, field by field, in the order the form asks. */
  function expenseChanges(
    before: ExpenseChangeFields,
    after: ExpenseChangeFields,
    sharesChanged: boolean,
  ): EntryChange[] {
    const changes: EntryChange[] = [];
    const value = (label: string, from: string, to: string) =>
      changes.push({ kind: "value", label, from, to });

    if (before.description !== after.description) {
      value("Description", `“${before.description}”`, `“${after.description}”`);
    }
    if (before.amountMinor !== after.amountMinor) {
      value("Amount", money(before.amountMinor), money(after.amountMinor));
    }
    if (before.category !== after.category) {
      value(
        "Category",
        categoryLabel(before.category),
        categoryLabel(after.category),
      );
    }
    if (before.expenseDate !== after.expenseDate) {
      value(
        "Date",
        formatDate(before.expenseDate),
        formatDate(after.expenseDate),
      );
    }
    if (before.paidBy !== after.paidBy) {
      value(
        "Paid by",
        mention(subject(before.paidBy)),
        mention(subject(after.paidBy)),
      );
    }
    if (before.splitMethod !== after.splitMethod) {
      value(
        "Split",
        METHOD_LABELS[before.splitMethod],
        METHOD_LABELS[after.splitMethod],
      );
    }

    const names = (ids: string[]) =>
      ids
        .map((id) => mention(subject(id)))
        .sort((a, b) => a.localeCompare(b, LOCALE));
    const added = after.participants.filter(
      (id) => !before.participants.includes(id),
    );
    const removed = before.participants.filter(
      (id) => !after.participants.includes(id),
    );
    if (added.length > 0 || removed.length > 0) {
      const parts = [
        ...(added.length > 0 ? [`added ${listOf(names(added))}`] : []),
        ...(removed.length > 0 ? [`removed ${listOf(names(removed))}`] : []),
      ];
      changes.push({
        kind: "text",
        label: "Who shares it",
        text: parts.join("; "),
      });
    }
    // A new amount, method or set of people changes shares anyway; say so
    // only when nothing above already explains it.
    if (
      sharesChanged &&
      before.amountMinor === after.amountMinor &&
      before.splitMethod === after.splitMethod &&
      added.length === 0 &&
      removed.length === 0
    ) {
      changes.push({ kind: "text", label: "Shares", text: "changed" });
    }
    return changes;
  }

  return function describe(entry: JournalEntry): EntryDescription {
    const category = entryCategory(entry);
    const actor = subject(entry.actorId);
    const result: EntryDescription = {
      category,
      categoryLabel: CATEGORY_LABELS[category],
      title: "",
      summary: null,
      context: [],
      changes: [],
      link: null,
      unavailable: entry.entity !== null && !entry.entity.available,
    };
    const { detail } = entry;

    switch (detail.type) {
      case "household_created":
        result.title = `${lead(actor)} created the household “${detail.name}”`;
        break;
      case "member_joined": {
        const member = subject(detail.userId);
        result.title = `${lead(member)} joined the household`;
        if (detail.inviterId && detail.inviterId !== detail.userId) {
          result.context.push(
            `Invited by ${mention(subject(detail.inviterId))}`,
          );
        }
        result.link = membersLink;
        break;
      }
      case "member_left":
        result.title = `${lead(subject(detail.userId, { leftLabel: false }))} left the household`;
        result.link = membersLink;
        break;
      case "member_removed":
        result.title = `${lead(actor)} removed ${mention(subject(detail.userId, { leftLabel: false }))} from the household`;
        result.link = membersLink;
        break;
      case "ownership_transferred":
        result.title = `${lead(actor)} made ${mention(subject(detail.toUserId))} the owner`;
        result.link = membersLink;
        break;
      case "invitation_created":
        result.title = `${lead(actor)} created an invite link`;
        result.link = invitesLink;
        break;
      case "invitation_revoked":
        result.title = `${lead(actor)} revoked an invite link`;
        if (detail.createdBy !== entry.actorId) {
          result.context.push(
            `Created by ${mention(subject(detail.createdBy))}`,
          );
        }
        result.link = invitesLink;
        break;
      case "expense_created":
      case "expense_deleted":
      case "expense_restored": {
        const { expense } = detail;
        const verb = {
          expense_created: "added",
          expense_deleted: "deleted",
          expense_restored: "restored",
        }[detail.type];
        result.title = `${lead(actor)} ${verb} an expense`;
        result.summary = `${expense.description} — ${money(expense.amountMinor)}`;
        result.context.push(`Paid by ${mention(subject(expense.paidBy))}`);
        result.link = expenseLink(entry.entity, expense.description);
        break;
      }
      case "expense_updated": {
        const { after } = detail;
        result.title = `${lead(actor)} edited an expense`;
        result.summary = `${after.description} — ${money(after.amountMinor)}`;
        result.changes = expenseChanges(
          detail.before,
          after,
          detail.sharesChanged,
        );
        result.link = expenseLink(entry.entity, after.description);
        break;
      }
      case "settlement_recorded":
      case "settlement_voided": {
        const { settlement } = detail;
        const payer = subject(settlement.fromUser);
        const recipient = subject(settlement.toUser);
        const about = `${paymentTitle(payer, recipient)}, ${money(settlement.amountMinor)}`;
        if (detail.type === "settlement_recorded") {
          // D9: "Pat recorded a payment of ₹500.00 to Olive", or "… from
          // Pat" when the recipient recorded it.
          const recorderPaid = settlement.recordedBy === settlement.fromUser;
          result.title = recordedSentence(
            { ...(recorderPaid ? payer : recipient), isPayer: recorderPaid },
            recorderPaid ? recipient : payer,
            settlement.amountMinor,
            context.currency,
          ).replace(/\.$/, "");
        } else {
          result.title = `${lead(actor)} voided a payment`;
          result.summary = `${paymentTitle(payer, recipient)} — ${money(settlement.amountMinor)}`;
        }
        result.context.push(`Paid on ${formatDate(settlement.settledOn)}`);
        if (detail.type === "settlement_voided") {
          result.context.push("It no longer counts towards balances");
        }
        result.link = paymentLink(entry.entity, about);
        break;
      }
    }
    return result;
  };
}
