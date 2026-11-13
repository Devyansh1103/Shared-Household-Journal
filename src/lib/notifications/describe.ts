// What a notification says and where it leads: the journal's own words for
// its event (describe.ts), seen by the recipient, in the household's
// currency, with the household's people. Pure.

import { entryDescriber, type EntryDescription } from "@/lib/journal/describe";
import {
  peopleIn,
  type NotificationItem,
  type NotificationsPage,
} from "./payload";

export type NotificationView = {
  item: NotificationItem;
  description: EntryDescription;
  /**
   * Where opening it goes: the record's page (which checks access again), or
   * the household's journal when the record has none or isn't there any more.
   */
  href: string;
};

export function describeNotifications(
  page: Pick<NotificationsPage, "items" | "people">,
  viewerId: string,
): NotificationView[] {
  const describers = new Map<string, ReturnType<typeof entryDescriber>>();
  return page.items.map((item) => {
    let describe = describers.get(item.householdId);
    if (!describe) {
      describe = entryDescriber({
        householdId: item.householdId,
        viewerId,
        currency: item.currency,
        people: peopleIn(page, item.householdId),
      });
      describers.set(item.householdId, describe);
    }
    const description = describe(item.entry);
    return {
      item,
      description,
      href: description.link?.href ?? `/households/${item.householdId}/journal`,
    };
  });
}
