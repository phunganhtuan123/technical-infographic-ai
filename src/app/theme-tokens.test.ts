import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string) {
  const start = css.indexOf(selector);
  expect(start, `${selector} missing`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

function declarations(source: string) {
  const found = new Map<string, string[]>();
  for (const match of source.matchAll(/^\s+(--[a-z0-9-]+):\s*([^;]+);/gim)) {
    found.set(match[1], [...(found.get(match[1]) ?? []), match[2].trim()]);
  }
  return found;
}

const light = declarations(block(":root {"));
const dark = declarations(block(':root[data-theme="dark"]'));

describe("theme tokens", () => {
  it("declares each token exactly once per theme", () => {
    // A token declared twice silently takes the later value. That is how the
    // brand accent turned olive across the whole dark theme: the generated
    // block redeclared --accent after the base block set it.
    const duplicated = (found: Map<string, string[]>) =>
      [...found.entries()].filter(([, values]) => values.length > 1).map(([name]) => name);

    expect(duplicated(light)).toEqual([]);
    expect(duplicated(dark)).toEqual([]);
  });

  it("keeps the brand palette the dark theme originally shipped", () => {
    expect(dark.get("--accent")?.[0]).toBe("#b6ff5c");
    expect(dark.get("--cyan")?.[0]).toBe("#63e6ff");
    expect(dark.get("--violet")?.[0]).toBe("#a78bfa");
  });

  it("gives every colour token a dark counterpart", () => {
    // Radii, spacing and easing are theme-independent and are declared once.
    const isColour = (values: string[]) => /^(#|rgba?\()/.test(values[0]);
    const missing = [...light.entries()]
      .filter(([name, values]) => isColour(values) && !dark.has(name))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("styles disabled controls by surface rather than by fading them", () => {
    // Nine different opacities across nineteen rules is what made enabled and
    // disabled hard to tell apart.
    const fadedDisabled = css
      .split("\n")
      .filter((line) => line.includes(":disabled") && /opacity:\s*[0-9.]+/.test(line) && !line.includes(":hover"));
    expect(fadedDisabled).toEqual([]);
    expect(css).toContain("--text-disabled");
  });
});
