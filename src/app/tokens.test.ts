import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Verifies D16: every text/background pairing used by the design system meets
// WCAG 2.1 AA. Reads the real token values from globals.css.

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const root = css.slice(
  css.indexOf(":root {"),
  css.indexOf("}", css.indexOf(":root {")),
);
const tokens = Object.fromEntries(
  [...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(
    ([, name, hex]) => [name, hex],
  ),
);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5; // WCAG 1.4.3, normal-size text
const NON_TEXT = 3; // WCAG 1.4.11, focus rings and input borders

const pairs: Array<[fg: string, bg: string, min: number]> = [
  ["foreground", "background", TEXT],
  ["foreground", "card", TEXT],
  ["foreground", "muted", TEXT],
  ["muted-foreground", "background", TEXT],
  ["muted-foreground", "card", TEXT],
  ["muted-foreground", "muted", TEXT],
  ["accent-foreground", "accent", TEXT],
  ["primary-foreground", "primary", TEXT],
  ["primary-foreground", "primary-hover", TEXT],
  ["primary", "background", TEXT],
  ["primary", "card", TEXT],
  ["secondary-foreground", "secondary", TEXT],
  ["destructive", "card", TEXT],
  ["destructive", "background", TEXT],
  ["destructive", "destructive-subtle", TEXT],
  ["destructive-foreground", "destructive", TEXT],
  ["destructive-foreground", "destructive-hover", TEXT],
  ["secondary-foreground", "secondary-hover", TEXT],
  ["highlight-foreground", "highlight-subtle", TEXT],
  ["success", "success-subtle", TEXT],
  ["success", "card", TEXT],
  ["warning", "warning-subtle", TEXT],
  ["warning", "card", TEXT],
  ["info", "info-subtle", TEXT],
  ["sidebar-foreground", "sidebar-accent", TEXT],
  ["ring", "card", NON_TEXT],
  ["ring", "background", NON_TEXT],
  ["input", "card", NON_TEXT],
  ["input", "background", NON_TEXT],
];

describe("design token contrast (WCAG AA)", () => {
  it.each(pairs)("%s on %s ≥ %d:1", (fg, bg, min) => {
    expect(tokens[fg], `missing token --${fg}`).toBeDefined();
    expect(tokens[bg], `missing token --${bg}`).toBeDefined();
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
  });

  it("documents why the PRD brand colours are not used for body text", () => {
    expect(contrast(tokens["brand-primary"], "#ffffff")).toBeLessThan(TEXT);
  });
});
