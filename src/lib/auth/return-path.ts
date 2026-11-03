// Where to send someone after they sign in. Only same-origin paths are
// allowed, so a crafted `?next=` can't redirect off the site.

export const SIGNED_IN_HOME = "/home";

/** Request header the proxy sets so server code knows the requested path. */
export const RETURN_PATH_HEADER = "x-return-path";

const AUTH_PATHS = ["/sign-in", "/sign-up", "/forgot-password", "/auth"];
const BASE = "http://internal.invalid";

/** Returns `value` if it is a safe in-app path, otherwise the signed-in home. */
export function safeReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return SIGNED_IN_HOME;
  }

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return SIGNED_IN_HOME;
  }
  if (url.origin !== BASE) return SIGNED_IN_HOME;

  // Sending a signed-in user back to an auth page would loop.
  if (
    AUTH_PATHS.some(
      (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
    )
  ) {
    return SIGNED_IN_HOME;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

/** The sign-in URL, carrying a safe return path when there is one. */
export function signInPath(returnPath?: string | null): string {
  const next = safeReturnPath(returnPath);
  return next === SIGNED_IN_HOME
    ? "/sign-in"
    : `/sign-in?next=${encodeURIComponent(next)}`;
}
