import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("initials", () => {
  it.each([
    ["Asha Rao", "AR"],
    ["asha", "A"],
    ["  Asha   Maria Rao ", "AM"],
    ["éva Ödön", "ÉÖ"],
    ["😀 Smile", "😀S"],
    ["", "?"],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
