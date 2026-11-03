/** Up to two initials for an avatar fallback, e.g. "Asha Rao" → "AR". */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toLocaleUpperCase("en-IN") ?? "");
  return letters.join("") || "?";
}
