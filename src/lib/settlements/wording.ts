// Words for settlements (D9). Every settlement surface says the app only
// keeps the record: "Recorded in the app — no money is moved." Nothing here
// ever claims that money was sent, transferred or checked.
//
// Sentences are built from figures that have already been calculated and
// verified; the direction is always said in words, never by colour or sign
// alone (design-system.md).

import type { Subject } from "@/lib/balances/explain";
import { formatMoney } from "@/lib/format";

/** D9: shown on every settlement surface. */
export const SETTLEMENT_NOTICE = "Recorded in the app — no money is moved.";

const ZERO = BigInt(0);

function abs(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

function name(subject: Subject): string {
  return subject.you ? "you" : subject.name;
}

/** Starts a sentence with a subject: "You …" or "Pat …" (names never re-cased). */
function lead(subject: Subject): string {
  return subject.you ? "You" : subject.name;
}

/** Someone in a settlement, for sentences: "you", or "Pat (left)" (D13). */
export function personSubject(
  person: { userId: string; displayName: string; isActive: boolean },
  viewerId: string,
): Subject {
  return {
    you: person.userId === viewerId,
    name: person.isActive ? person.displayName : `${person.displayName} (left)`,
  };
}

/** "Payment from Pat to Olive", "Payment from you to Olive". */
export function paymentTitle(payer: Subject, recipient: Subject): string {
  return `Payment from ${name(payer)} to ${name(recipient)}`;
}

/**
 * D9's wording: "Pat recorded a payment of ₹300.00 to Olive." When the
 * recipient recorded it: "Olive recorded a payment of ₹300.00 from Pat."
 */
export function recordedSentence(
  recorder: Subject & { isPayer: boolean },
  other: Subject,
  amountMinor: bigint,
  currency: string,
): string {
  const amount = formatMoney(amountMinor, currency);
  const preposition = recorder.isPayer ? "to" : "from";
  return `${lead(recorder)} recorded a payment of ${amount} ${preposition} ${name(other)}.`;
}

/** "You paid Olive ₹300.00." / "Pat paid you ₹300.00." */
export function paymentSentence(
  payer: Subject,
  recipient: Subject,
  amountMinor: bigint,
  currency: string,
): string {
  return `${lead(payer)} paid ${name(recipient)} ${formatMoney(amountMinor, currency)}.`;
}

/**
 * Where the viewer stands with someone right now. `withMinor` is from the
 * viewer's side: positive when the other person owes the viewer, negative
 * when the viewer owes them. "Right now you owe Olive ₹300.00."
 */
export function standingSentence(
  other: Subject,
  withMinor: bigint,
  currency: string,
): string {
  const amount = formatMoney(abs(withMinor), currency);
  if (withMinor < ZERO) return `Right now you owe ${other.name} ${amount}.`;
  if (withMinor > ZERO) return `Right now ${other.name} owes you ${amount}.`;
  return `Right now you and ${other.name} are settled up.`;
}

export type SettlementOutcome =
  /** The payer will still owe the recipient something. */
  | { kind: "partial"; remainingMinor: bigint }
  /** They'll be even. */
  | { kind: "settles" }
  /**
   * More than the payer owes (D9 warns about it): the recipient will owe the
   * payer the difference (D8).
   */
  | { kind: "over"; overMinor: bigint };

/**
 * What recording `amountMinor` from payer to recipient does, when the payer
 * owes the recipient `owedMinor` now (negative if it's the other way round).
 * "over" exactly when the amount is more than what's owed, the same rule
 * record_settlement uses.
 */
export function settlementOutcome(
  owedMinor: bigint,
  amountMinor: bigint,
): SettlementOutcome {
  const after = owedMinor - amountMinor;
  if (after > ZERO) return { kind: "partial", remainingMinor: after };
  if (after === ZERO) return { kind: "settles" };
  return { kind: "over", overMinor: -after };
}

/** "After this, you'll owe Olive ₹200.00." and the like. */
export function outcomeSentence(
  payer: Subject,
  recipient: Subject,
  outcome: SettlementOutcome,
  currency: string,
): string {
  const owes = (debtor: Subject, creditor: Subject, minor: bigint) => {
    const amount = formatMoney(minor, currency);
    return debtor.you
      ? `you'll owe ${name(creditor)} ${amount}`
      : `${debtor.name} will owe ${name(creditor)} ${amount}`;
  };
  switch (outcome.kind) {
    case "partial":
      return `After this, ${owes(payer, recipient, outcome.remainingMinor)}.`;
    case "settles":
      return `After this, ${
        payer.you || recipient.you
          ? `you and ${payer.you ? recipient.name : payer.name}`
          : `${payer.name} and ${recipient.name}`
      } will be settled up.`;
    case "over":
      return `After this, ${owes(recipient, payer, outcome.overMinor)}.`;
  }
}

/**
 * D9's warning, when the amount is more than what's currently owed:
 * "That's more than you owe Olive right now (₹300.00)." or, when nothing is
 * owed that way, "You don't owe Olive anything right now."
 */
export function overpaymentWarning(
  payer: Subject,
  recipient: Subject,
  owedMinor: bigint,
  currency: string,
): string {
  const who = lead(payer);
  const owe = payer.you ? "owe" : "owes";
  if (owedMinor > ZERO) {
    return `That's more than ${name(payer)} ${owe} ${name(recipient)} right now (${formatMoney(owedMinor, currency)}).`;
  }
  if (owedMinor === ZERO) {
    return `${who} ${payer.you ? "don't" : "doesn't"} owe ${name(recipient)} anything right now.`;
  }
  return `${lead(recipient)} ${recipient.you ? "owe" : "owes"} ${name(payer)} ${formatMoney(-owedMinor, currency)} right now, not the other way round.`;
}
