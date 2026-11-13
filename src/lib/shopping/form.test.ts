import { describe, expect, it } from "vitest";
import {
  EMPTY_ITEM_FORM,
  ITEM_NAME_MAX,
  ITEM_NOTE_MAX,
  ITEM_QUANTITY_MAX,
  readItemForm,
  validateItem,
} from "./form";

const OLIVE = "11111111-1111-4111-8111-111111111111";
const PAT = "22222222-2222-4222-8222-222222222222";
const QUIN = "33333333-3333-4333-8333-333333333333";
const members = [OLIVE, PAT];

describe("readItemForm", () => {
  it("reads the fields as text, and nothing else", () => {
    const data = new FormData();
    data.set("name", " Milk ");
    data.set("quantity", "2");
    data.set("assignee", PAT);
    data.set("householdId", "ignored");
    expect(readItemForm(data)).toEqual({
      name: " Milk ",
      quantity: "2",
      note: "",
      assignee: PAT,
    });
  });
});

describe("validateItem", () => {
  it("trims, and turns empty optional fields into nothing", () => {
    expect(
      validateItem(
        { name: "  Milk ", quantity: " ", note: "", assignee: "" },
        { memberIds: members },
      ),
    ).toEqual({
      ok: true,
      value: { name: "Milk", quantity: null, note: null, assigneeId: null },
    });
    expect(
      validateItem(
        { name: "Rice", quantity: " 5 kg", note: "Basmati ", assignee: OLIVE },
        { memberIds: members },
      ),
    ).toEqual({
      ok: true,
      value: {
        name: "Rice",
        quantity: "5 kg",
        note: "Basmati",
        assigneeId: OLIVE,
      },
    });
  });

  it("needs a name, and keeps every field within its limit", () => {
    const result = validateItem(
      {
        name: "x".repeat(ITEM_NAME_MAX + 1),
        quantity: "x".repeat(ITEM_QUANTITY_MAX + 1),
        note: "x".repeat(ITEM_NOTE_MAX + 1),
        assignee: "",
      },
      { memberIds: members },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual([
        "name",
        "note",
        "quantity",
      ]);
    }
    expect(
      validateItem({ ...EMPTY_ITEM_FORM, name: "   " }, { memberIds: members }),
    ).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    expect(
      validateItem(
        { ...EMPTY_ITEM_FORM, name: "x".repeat(ITEM_NAME_MAX) },
        { memberIds: members },
      ).ok,
    ).toBe(true);
  });

  it("assigns only to a current member, or keeps a former member already assigned (D13)", () => {
    const raw = { ...EMPTY_ITEM_FORM, name: "Milk", assignee: QUIN };
    expect(validateItem(raw, { memberIds: members })).toMatchObject({
      ok: false,
      fieldErrors: { assignee: expect.any(String) },
    });
    expect(
      validateItem(raw, { memberIds: members, currentAssigneeId: QUIN }),
    ).toMatchObject({ ok: true, value: { assigneeId: QUIN } });
    expect(
      validateItem(
        { ...raw, assignee: "not-a-member" },
        { memberIds: members, currentAssigneeId: QUIN },
      ).ok,
    ).toBe(false);
  });
});
