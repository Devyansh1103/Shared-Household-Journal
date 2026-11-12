"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/auth/errors";
import { formValue, type FormState } from "@/lib/auth/form-state";
import { requireUser } from "@/lib/auth/session";
import { currencyExponent } from "@/lib/format";
import { householdErrorMessage } from "@/lib/households/errors";
import { getHousehold, listMembersInJoinOrder } from "@/lib/households/queries";
import {
  readSettlementForm,
  validateSettlementForm,
  type RawSettlementForm,
} from "@/lib/settlements/form";
import { createClient } from "@/lib/supabase/server";

// Every action re-checks the session. The person recording or voiding is
// auth.uid() inside the database functions, and the viewer's side of a new
// settlement is the session user, never a form field. Ids in the form only
// name the household, the settlement and the other person; the functions
// check all of them (membership, D9 rights, O9) again.

export type SettlementFormState = FormState & {
  raw?: RawSettlementForm;
  /**
   * Set when the amount is more than what the payer owes the recipient right
   * now (HJ017): that figure, as signed minor units in text, so the form can
   * show D9's warning with the latest numbers and ask again.
   */
  owedMinor?: string;
};

/** Signed whole minor units, as the database sends them in HJ017's DETAIL. */
const MINOR_TEXT = /^-?(0|[1-9][0-9]*)$/;

const ids = z.object({ householdId: z.uuid(), settlementId: z.uuid() });

/** Pages under every household: balances, settlements and the overview. */
function revalidateHouseholdPages() {
  revalidatePath("/households/[householdId]", "layout");
}

export async function recordSettlement(
  _previous: SettlementFormState,
  formData: FormData,
): Promise<SettlementFormState> {
  const user = await requireUser();
  const householdId = z.uuid().safeParse(formValue(formData, "householdId"));
  const requestKey = z.uuid().safeParse(formValue(formData, "requestKey"));
  if (!householdId.success || !requestKey.success) {
    return { status: "error", message: "Reload the page and try again." };
  }

  const household = await getHousehold(householdId.data);
  // Trusted, server-side list of who can be in a settlement (O9: active
  // members only).
  const members = await listMembersInJoinOrder(household.id);
  const raw = readSettlementForm(formData);
  const result = validateSettlementForm(raw, {
    viewerId: user.id,
    memberIds: members.map((m) => m.userId),
    exponent: currencyExponent(household.currencyCode),
  });
  if (!result.ok) {
    return { status: "error", fieldErrors: result.fieldErrors, raw };
  }

  // The figure the warning was shown for, when one was shown (D9).
  const acknowledged = formValue(formData, "acknowledgedOwed");
  if (
    acknowledged !== "" &&
    (!MINOR_TEXT.test(acknowledged) ||
      !Number.isSafeInteger(Number(acknowledged)))
  ) {
    return { status: "error", message: "Reload the page and try again.", raw };
  }

  const { settlement } = result;
  const supabase = await createClient();
  const { data: settlementId, error } = await supabase.rpc(
    "record_settlement",
    {
      target_household_id: household.id,
      payer_id: settlement.fromUserId,
      recipient_id: settlement.toUserId,
      amount: Number(settlement.amountMinor),
      paid_on: settlement.settledOn,
      ...(settlement.note ? { memo: settlement.note } : {}),
      request_key: requestKey.data,
      ...(acknowledged !== ""
        ? { acknowledged_owed: Number(acknowledged) }
        : {}),
    },
  );

  if (error?.code === "HJ017" && MINOR_TEXT.test(error.details ?? "")) {
    return { status: "error", owedMinor: error.details, raw };
  }
  if (error || !settlementId) {
    return {
      status: "error",
      message: householdErrorMessage(error?.code),
      raw,
    };
  }

  revalidateHouseholdPages();
  redirect(
    `/households/${household.id}/settlements/${settlementId}?recorded=1`,
  );
}

export async function voidSettlement(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = ids.safeParse({
    householdId: formValue(formData, "householdId"),
    settlementId: formValue(formData, "settlementId"),
  });
  if (!parsed.success) return { status: "error", message: GENERIC_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_settlement", {
    target_settlement_id: parsed.data.settlementId,
  });
  if (error) {
    return { status: "error", message: householdErrorMessage(error.code) };
  }

  revalidateHouseholdPages();
  refresh();
  return {
    status: "success",
    message: "The payment is voided. It no longer counts towards balances.",
  };
}
