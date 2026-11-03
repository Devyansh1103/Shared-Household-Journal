import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  GENERIC_ERROR,
  isExistingAccountError,
} from "./errors";

describe("authErrorMessage", () => {
  it("doesn't say whether the email or the password was wrong", () => {
    expect(authErrorMessage("invalid_credentials")).toBe(
      "Email or password is incorrect.",
    );
  });

  it("falls back to a generic message for unknown or missing codes", () => {
    expect(authErrorMessage("unexpected_failure")).toBe(GENERIC_ERROR);
    expect(authErrorMessage(undefined)).toBe(GENERIC_ERROR);
    expect(authErrorMessage("__proto__")).toBe(GENERIC_ERROR);
  });
});

describe("isExistingAccountError", () => {
  it("recognises the duplicate-account codes", () => {
    expect(isExistingAccountError("user_already_exists")).toBe(true);
    expect(isExistingAccountError("email_exists")).toBe(true);
    expect(isExistingAccountError("weak_password")).toBe(false);
  });
});
