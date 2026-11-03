import { describe, expect, it } from "vitest";
import {
  fieldErrors,
  newPasswordSchema,
  profileSchema,
  signInSchema,
  signUpSchema,
} from "./schemas";

function errorsOf(result: {
  success: boolean;
  error?: Parameters<typeof fieldErrors>[0];
}) {
  return result.success ? {} : fieldErrors(result.error!);
}

describe("signUpSchema", () => {
  it("accepts valid input and trims the name and email", () => {
    const result = signUpSchema.parse({
      displayName: "  Asha Rao ",
      email: " asha@example.com ",
      password: "correct horse",
    });
    expect(result).toEqual({
      displayName: "Asha Rao",
      email: "asha@example.com",
      password: "correct horse",
    });
  });

  it("explains each problem on its own field", () => {
    const errors = errorsOf(
      signUpSchema.safeParse({
        displayName: "   ",
        email: "not-an-email",
        password: "short",
      }),
    );
    expect(errors).toEqual({
      displayName: "Enter the name other members will see.",
      email: "Enter an email address like name@example.com.",
      password: "Use at least 8 characters.",
    });
  });

  it("asks for an email when it's empty", () => {
    expect(
      errorsOf(
        signUpSchema.safeParse({
          displayName: "A",
          email: "",
          password: "12345678",
        }),
      ),
    ).toMatchObject({ email: "Enter your email address." });
  });

  it("enforces the display name and password length limits", () => {
    const errors = errorsOf(
      signUpSchema.safeParse({
        displayName: "x".repeat(81),
        email: "a@example.com",
        password: "p".repeat(73),
      }),
    );
    expect(errors).toEqual({
      displayName: "Use 80 characters or fewer.",
      password: "Use 72 characters or fewer.",
    });
  });
});

describe("signInSchema", () => {
  it("only requires a password to be present", () => {
    expect(
      signInSchema.safeParse({ email: "a@example.com", password: "x" }).success,
    ).toBe(true);
    expect(
      errorsOf(
        signInSchema.safeParse({ email: "a@example.com", password: "" }),
      ),
    ).toEqual({
      password: "Enter your password.",
    });
  });
});

describe("newPasswordSchema", () => {
  it("requires the confirmation to match", () => {
    expect(
      errorsOf(
        newPasswordSchema.safeParse({
          password: "long enough",
          confirmPassword: "other",
        }),
      ),
    ).toEqual({ confirmPassword: "The passwords don't match." });
  });
});

describe("profileSchema", () => {
  it("rejects a name that is only whitespace", () => {
    expect(errorsOf(profileSchema.safeParse({ displayName: " \t " }))).toEqual({
      displayName: "Enter the name other members will see.",
    });
  });
});
