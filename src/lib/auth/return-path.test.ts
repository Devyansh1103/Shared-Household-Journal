import { describe, expect, it } from "vitest";
import { safeReturnPath, signInPath, SIGNED_IN_HOME } from "./return-path";

describe("safeReturnPath", () => {
  it.each([
    "/profile",
    "/home?tab=bills",
    "/invite/abc#top",
    "/households/1/expenses?page=2",
  ])("keeps the in-app path %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    ["an absolute URL", "https://evil.example/phish"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path", "profile"],
    ["a tab inside the path", "/\t/evil.example"],
    ["a newline", "/home\nSet-Cookie: x=1"],
    ["an empty string", ""],
    ["a non-string", ["/profile"]],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(safeReturnPath(value)).toBe(SIGNED_IN_HOME);
  });

  it.each([
    "/sign-in",
    "/sign-in?next=/profile",
    "/sign-up",
    "/forgot-password",
    "/auth/confirm",
  ])("doesn't return to the auth page %s", (path) => {
    expect(safeReturnPath(path)).toBe(SIGNED_IN_HOME);
  });

  it("keeps percent-encoded slashes on this site", () => {
    expect(safeReturnPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
  });

  it("normalises dot segments without leaving the site", () => {
    expect(safeReturnPath("/a/../../profile")).toBe("/profile");
  });
});

describe("signInPath", () => {
  it("carries a safe return path", () => {
    expect(signInPath("/profile?x=1")).toBe("/sign-in?next=%2Fprofile%3Fx%3D1");
  });

  it("drops unsafe or default return paths", () => {
    expect(signInPath("https://evil.example")).toBe("/sign-in");
    expect(signInPath(SIGNED_IN_HOME)).toBe("/sign-in");
    expect(signInPath(null)).toBe("/sign-in");
  });
});
