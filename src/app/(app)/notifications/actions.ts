"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { GENERIC_ERROR } from "@/lib/auth/errors";
import { formValue, type FormState } from "@/lib/auth/form-state";
import { requireUser } from "@/lib/auth/session";
import { mutedFromChecked } from "@/lib/notifications/categories";
import { describeNotifications } from "@/lib/notifications/describe";
import { getNotification } from "@/lib/notifications/queries";
import { createClient } from "@/lib/supabase/server";

// Notifications (roadmap Phase 17, D12). Every action re-checks the session.
// The person is auth.uid() inside the database functions, which only ever
// touch the caller's own notifications and preferences, in households they're
// an active member of; ids in a form only say which. Where opening one leads
// is worked out here from the notification as the database returns it, never
// taken from the form.

export type PreferencesState = FormState & { attempt?: number };

function revalidateNotifications() {
  revalidatePath("/notifications");
}

async function markRead(ids: string[] | null): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "mark_notifications_read",
    ids ? { target_notification_ids: ids } : {},
  );
  return !error;
}

export async function markNotificationRead(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const id = z.uuid().safeParse(formValue(formData, "notificationId"));
  if (!id.success) return { status: "error", message: GENERIC_ERROR };
  if (!(await markRead([id.data]))) {
    return { status: "error", message: GENERIC_ERROR };
  }
  revalidateNotifications();
  refresh();
  return { status: "success", message: "Marked as read." };
}

export async function markAllNotificationsRead(): Promise<FormState> {
  await requireUser();
  if (!(await markRead(null))) {
    return { status: "error", message: GENERIC_ERROR };
  }
  revalidateNotifications();
  refresh();
  return {
    status: "success",
    message: "All notifications are marked as read.",
  };
}

/**
 * Opens a notification: marks it read, then goes to what it's about. That
 * page checks access again (a 404 outside the household).
 */
export async function openNotification(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.uuid().safeParse(formValue(formData, "notificationId"));
  if (!id.success) redirect("/notifications?missing=1");
  const page = await getNotification(id.data);
  if (!page) redirect("/notifications?missing=1");
  const [view] = describeNotifications(page, user.id);
  await markRead([id.data]);
  revalidateNotifications();
  redirect(view.href);
}

export async function saveNotificationPreferences(
  previous: PreferencesState,
  formData: FormData,
): Promise<PreferencesState> {
  await requireUser();
  const attempt = (previous.attempt ?? 0) + 1;
  const householdId = z.uuid().safeParse(formValue(formData, "householdId"));
  if (!householdId.success) {
    return {
      status: "error",
      message: "Reload the page and try again.",
      attempt,
    };
  }
  const checked = formData
    .getAll("category")
    .filter((value): value is string => typeof value === "string");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_notification_preferences", {
    target_household_id: householdId.data,
    muted_categories: mutedFromChecked(checked),
  });
  if (error) {
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "You're not a member of that household any more."
          : GENERIC_ERROR,
      attempt,
    };
  }
  revalidatePath("/profile/notifications");
  return { status: "success", message: "Saved.", attempt };
}
