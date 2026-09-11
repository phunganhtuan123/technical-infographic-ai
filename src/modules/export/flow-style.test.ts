import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { diagramTheme, roleColors } from "@/modules/catalog/catalog";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { layoutDocument } from "@/modules/layout/layout-document";
import { countEdgeCrossings } from "@/modules/layout/layout-document";
import { renderDocumentSvg } from "./export-document";

/** A quadratic-solver flow: the shape the house style is written for. */
const plan = {
  id: "quadratic",
  mode: "flow" as const,
  title: "Solve a quadratic equation",
  purpose: "Roots of $ax^2 + bx + c = 0$",
  nodes: [
    { id: "start", label: "Start", role: "start" as const, detail: "read a, b, c", lane: "entry" as const },
    { id: "discriminant", label: "Compute $\\Delta = b^2 - 4ac$", role: "process" as const, detail: "discriminant", lane: "core" as const },
    { id: "check", label: "Is $\\Delta \\geq 0$?", role: "decision" as const, detail: "real roots?", lane: "core" as const },
    { id: "roots", label: "$x = \\frac{-b \\pm \\sqrt{\\Delta}}{2a}$", role: "process" as const, detail: "two real roots", lane: "core" as const },
    { id: "complex", label: "No real root", role: "process" as const, detail: "complex pair", lane: "core" as const },
    { id: "result", label: "Return $x_1, x_2$", role: "input-output" as const, detail: "result", lane: "core" as const },
    { id: "end", label: "End", role: "end" as const, detail: "done", lane: "core" as const },
  ],
  edges: [
    { id: "e1", from: "start", to: "discriminant", semantics: "request" as const, important: true },
    { id: "e2", from: "discriminant", to: "check", semantics: "request" as const, important: true },
    { id: "e3", from: "check", to: "roots", semantics: "success" as const, label: "yes", important: true },
    { id: "e4", from: "check", to: "complex", semantics: "failure" as const, label: "no", important: false },
    { id: "e5", from: "roots", to: "result", semantics: "request" as const, important: true },
    { id: "e6", from: "complex", to: "result", semantics: "request" as const, important: false },
    { id: "e7", from: "result", to: "end", semantics: "request" as const, important: true },
  ],
};

describe("flowchart house style", () => {
  it("paints the flowchart roles per the convention", () => {
    const document = compilePlan(plan);
    const colorOf = (id: string) => document.nodes.find((node) => node.id === id)!.color;

    expect(colorOf("start")).toBe(roleColors.start);
    expect(colorOf("end")).toBe(roleColors.end);
    expect(colorOf("start")).toBe(colorOf("end")); // both green
    expect(colorOf("check")).toBe(roleColors.decision);
    expect(colorOf("discriminant")).toBe(roleColors.process);
    expect(colorOf("result")).toBe(roleColors["input-output"]);
  });

  it("exports onto a light sheet with the maths readable", async () => {
    const document = await layoutDocument(compilePlan(plan));
    const svg = renderDocumentSvg(document, { animate: false });

    expect(svg).toContain(`fill="${diagramTheme.background}"`);
    expect(svg).not.toContain("#080808");
    expect(svg).not.toContain("#111111");
    // LaTeX is transliterated rather than printed with its backslashes.
    expect(svg).toContain("Δ");
    expect(svg).not.toContain("\\frac");
    expect(svg).not.toContain("\\Delta");
    // The subtitle carries a formula too.
    expect(svg).toContain("ax² + bx + c = 0");
    expect(svg).not.toContain("$ax^2");

    if (process.env.WRITE_ARTIFACT) writeFileSync(process.env.WRITE_ARTIFACT, svg);
  });

  it("lays the flow out without crossed connectors", async () => {
    const document = await layoutDocument(compilePlan(plan));
    expect(countEdgeCrossings(document)).toBe(0);
  });
});
