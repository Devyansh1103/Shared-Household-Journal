// Words for balances. Every sentence is built from figures that have already
// been calculated and verified; nothing here works a balance out itself. The
// direction is always said in words, so colour and signs are never the only
// signal (design-system.md).

import {
  balanceDirection,
  type BalanceDirection,
  type PersonBalance,
} from "@/domain/money/balances";
import { formatMoney } from "@/lib/format";

const ZERO = BigInt(0);

/** Who a sentence is about: the signed-in person, or someone else by name. */
export type Subject = { you: boolean; name: string };

export const DIRECTION_LABELS: Record<BalanceDirection, string> = {
  owed: "Owed",
  owes: "Owes",
  settled: "Settled up",
};

export function absMinor(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

/** "Olive (you)", "Pat (left)" (D13) or just "Quin". */
export function personLabel(
  person: { userId: string; displayName: string; isActive: boolean },
  viewerId: string,
): string {
  if (person.userId === viewerId) return `${person.displayName} (you)`;
  return person.isActive ? person.displayName : `${person.displayName} (left)`;
}

/** Joins a sign to its amount: a line may not break after "+" or "-". */
export const WORD_JOINER = "⁠";

/**
 * A balance with its sign: "+₹600.00", "-₹300.00" or "₹0.00", for use inside
 * sentences. The sign is followed by an invisible WORD JOINER, because browsers
 * may otherwise wrap a line between "+" and "₹".
 */
export function formatBalance(netMinor: bigint, currency: string): string {
  return formatMoney(netMinor, currency, { signDisplay: "exceptZero" }).replace(
    /^[+-]/,
    (sign) => `${sign}${WORD_JOINER}`,
  );
}

/** "1 expense", "3 expenses". */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "you" → "You". Only ever used on our own words, never on a person's name. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "you should get back ₹600.00", "Pat owes ₹300.00", "you're settled up". */
function conclusion(subject: Subject, netMinor: bigint, currency: string) {
  const amount = formatMoney(absMinor(netMinor), currency);
  const who = subject.you ? "you" : subject.name;
  switch (balanceDirection(netMinor)) {
    case "owed":
      return `${who} should get back ${amount}`;
    case "owes":
      return `${who} ${subject.you ? "owe" : "owes"} ${amount}`;
    case "settled":
      return subject.you ? "you're settled up" : `${who} is settled up`;
  }
}

/** "You should get back ₹600.00." / "Pat owes ₹300.00." / "You're settled up." */
export function balanceSentence(
  subject: Subject,
  netMinor: bigint,
  currency: string,
): string {
  const text = conclusion(subject, netMinor, currency);
  return `${subject.you ? capitalise(text) : text}.`;
}

/** "You paid ₹900.00 for 1 expense." */
export function paidSentence(
  subject: Subject,
  person: PersonBalance,
  currency: string,
): string {
  const who = subject.you ? "You" : subject.name;
  if (person.paidCount === 0) {
    return `${who} ${subject.you ? "haven't" : "hasn't"} paid for any shared expenses.`;
  }
  return `${who} paid ${formatMoney(person.paidMinor, currency)} for ${plural(person.paidCount, "expense")}.`;
}

/** "Your share of the costs is ₹300.00, across 1 expense." */
export function shareSentence(
  subject: Subject,
  person: PersonBalance,
  currency: string,
): string {
  if (person.shareCount === 0) {
    return subject.you
      ? "You don't have a share in any shared expenses."
      : `${subject.name} doesn't have a share in any shared expenses.`;
  }
  const whose = subject.you ? "Your" : `${subject.name}'s`;
  return `${whose} share of the costs is ${formatMoney(person.shareMinor, currency)}, across ${plural(person.shareCount, "expense")}.`;
}

/** "₹900.00 paid − ₹300.00 share = +₹600.00" */
export function formula(person: PersonBalance, currency: string): string {
  return `${formatMoney(person.paidMinor, currency)} paid − ${formatMoney(person.shareMinor, currency)} share = ${formatBalance(person.netMinor, currency)}`;
}

/** "₹900.00 paid − ₹300.00 share = +₹600.00, so you should get back ₹600.00." */
export function workingSentence(
  subject: Subject,
  person: PersonBalance,
  currency: string,
): string {
  return `${formula(person, currency)}, so ${conclusion(subject, person.netMinor, currency)}.`;
}

/**
 * Under a complete list of the expenses behind a balance: "Together they come
 * to +₹600.00, your balance." ("It comes to …" for one expense.)
 */
export function entriesTotalSentence(
  subject: Subject,
  count: number,
  netMinor: bigint,
  currency: string,
): string {
  const whose = subject.you ? "your" : `${subject.name}'s`;
  const lead = count === 1 ? "It comes to" : "Together they come to";
  return `${lead} ${formatBalance(netMinor, currency)}, ${whose} balance.`;
}

/** "Pat owes Olive", "You owe Olive" or "Pat owes you". */
export function pairPhrase(debtor: Subject, creditor: Subject): string {
  const to = creditor.you ? "you" : creditor.name;
  return debtor.you ? `You owe ${to}` : `${debtor.name} owes ${to}`;
}

/** "Your share" or "Pat's share". */
export function shareLabel(subject: Subject): string {
  return `${subject.you ? "Your" : `${subject.name}'s`} share`;
}

/**
 * One expense between the focus person and someone else. `lineMinor` is the
 * focus person's side: positive when the other person owes them (the focus
 * person paid), negative when they owe the other person (the other one paid).
 * "You paid ₹900.00; Pat's share is ₹300.00."
 */
export function pairLineSentence(
  focus: Subject,
  other: Subject,
  amountMinor: bigint,
  lineMinor: bigint,
  currency: string,
): string {
  const [payer, sharer] = lineMinor > ZERO ? [focus, other] : [other, focus];
  const who = payer.you ? "You" : payer.name;
  const whose = sharer.you ? "your" : `${sharer.name}'s`;
  return `${who} paid ${formatMoney(amountMinor, currency)}; ${whose} share is ${formatMoney(absMinor(lineMinor), currency)}.`;
}
