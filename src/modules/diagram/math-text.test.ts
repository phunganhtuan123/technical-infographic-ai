import { describe, expect, it } from "vitest";
import { hasMath, mathToPlainText, mathToUnicode, parseMathSegments, renderMathToHtml } from "./math-text";

describe("math text", () => {
  it("splits inline formulas out of surrounding prose", () => {
    expect(parseMathSegments("Solve $ax^2 + bx = 0$ then stop")).toEqual([
      { kind: "text", value: "Solve ", display: false },
      { kind: "math", value: "ax^2 + bx = 0", display: false },
      { kind: "text", value: " then stop", display: false },
    ]);
  });

  it("recognises display formulas", () => {
    const [segment] = parseMathSegments("$$\\frac{a}{b}$$");
    expect(segment).toEqual({ kind: "math", value: "\\frac{a}{b}", display: true });
  });

  it("leaves an escaped dollar as text", () => {
    expect(parseMathSegments("costs \\$5 per call")).toEqual([
      { kind: "text", value: "costs $5 per call", display: false },
    ]);
    expect(hasMath("costs \\$5 per call")).toBe(false);
  });

  it("treats a lone dollar as text rather than an open fence", () => {
    expect(hasMath("$100 budget")).toBe(false);
  });

  it("typesets a real formula", () => {
    const html = renderMathToHtml("x = \\frac{-b}{2a}", false);
    expect(html).toContain("katex");
    expect(html).toContain("frac");
  });

  it("returns markup instead of throwing on malformed input", () => {
    expect(renderMathToHtml("\\frac{", false)).toBeTypeOf("string");
  });
});

describe("unicode fallback", () => {
  it("keeps every symbol of a quadratic formula", () => {
    expect(mathToUnicode("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"))
      .toBe("x = (-b ± √(b² - 4ac))/(2a)");
  });

  it("writes exponents and subscripts as real characters", () => {
    expect(mathToUnicode("a_1 + a_2 = c^2")).toBe("a₁ + a₂ = c²");
  });

  it("falls back to caret form when no superscript character exists", () => {
    expect(mathToUnicode("x^{abc}")).toBe("x^(abc)");
  });

  it("translates greek and operators", () => {
    expect(mathToUnicode("\\sum_{i=1}^{n} \\alpha \\times \\beta \\leq \\infty"))
      .toContain("∑");
    expect(mathToUnicode("\\alpha \\times \\beta")).toBe("α × β");
  });

  it("leaves surrounding prose alone", () => {
    expect(mathToPlainText("Compute $E = mc^2$ now")).toBe("Compute E = mc² now");
  });

  it("passes through text with no formula", () => {
    expect(mathToPlainText("Validate payment")).toBe("Validate payment");
  });
});
