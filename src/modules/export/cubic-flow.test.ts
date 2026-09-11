import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { countEdgeCrossings, layoutDocument } from "@/modules/layout/layout-document";
import { bestFitFormat } from "@/modules/diagram/bounds";
import { roleColors } from "@/modules/catalog/catalog";
import { renderDocumentSvg } from "./export-document";

/**
 * The cubic-solver flowchart, written the way the house prompt asks for it.
 *
 * This is the shape a real request produces: a top-to-bottom procedure with
 * nested decisions and labelled branches. It is here to hold the layout to the
 * thing a flowchart is actually judged on — reading order and crossings.
 */
const plan = {
  id: "cubic",
  mode: "flow" as const,
  title: "Giải phương trình bậc ba",
  purpose: "$ax^3 + bx^2 + cx + d = 0$",
  nodes: [
    { id: "start", label: "Bắt đầu", role: "start" as const, detail: "", lane: "entry" as const },
    { id: "input", label: "Nhập $a, b, c, d$", role: "input-output" as const, detail: "hệ số", lane: "core" as const },
    { id: "check-a", label: "$a = 0$?", role: "decision" as const, detail: "suy biến", lane: "core" as const },
    { id: "quadratic", label: "Giải $bx^2 + cx + d = 0$", role: "subprocess" as const, detail: "bậc hai", lane: "core" as const },
    { id: "out-quadratic", label: "Xuất nghiệm bậc hai", role: "input-output" as const, detail: "kết quả", lane: "core" as const },
    { id: "normalise", label: "$A = b/a$, $B = c/a$, $C = d/a$", role: "process" as const, detail: "chuẩn hóa", lane: "core" as const },
    { id: "depress", label: "$p = B - A^2/3$, $q = 2A^3/27 - AB/3 + C$", role: "process" as const, detail: "đặt $x = t - A/3$", lane: "core" as const },
    { id: "delta", label: "$\\Delta = (q/2)^2 + (p/3)^3$", role: "process" as const, detail: "biệt thức", lane: "core" as const },
    { id: "check-pos", label: "$\\Delta > 0$?", role: "decision" as const, detail: "", lane: "core" as const },
    { id: "one-root", label: "$x = u + v - A/3$", role: "process" as const, detail: "$u,v$ căn bậc ba", lane: "core" as const },
    { id: "out-one", label: "1 nghiệm thực", role: "input-output" as const, detail: "kết quả", lane: "core" as const },
    { id: "check-zero", label: "$\\Delta = 0$?", role: "decision" as const, detail: "", lane: "core" as const },
    { id: "check-pq", label: "$p = 0$ và $q = 0$?", role: "decision" as const, detail: "", lane: "core" as const },
    { id: "triple", label: "$x = -A/3$", role: "process" as const, detail: "nghiệm bội ba", lane: "core" as const },
    { id: "out-triple", label: "Nghiệm ba", role: "input-output" as const, detail: "kết quả", lane: "core" as const },
    { id: "double", label: "$x_1 = 3q/p - A/3$, $x_2 = -3q/(2p) - A/3$", role: "process" as const, detail: "nghiệm kép", lane: "core" as const },
    { id: "out-double", label: "2 nghiệm, $x_2$ kép", role: "input-output" as const, detail: "kết quả", lane: "core" as const },
    { id: "three", label: "$x_k = r\\cos((\\theta + 2k\\pi)/3) - A/3$", role: "process" as const, detail: "$k = 0,1,2$", lane: "core" as const },
    { id: "out-three", label: "3 nghiệm thực phân biệt", role: "input-output" as const, detail: "kết quả", lane: "core" as const },
    { id: "end", label: "Kết thúc", role: "end" as const, detail: "", lane: "core" as const },
  ],
  edges: [
    { id: "e1", from: "start", to: "input", semantics: "request" as const, important: true },
    { id: "e2", from: "input", to: "check-a", semantics: "request" as const, important: true },
    { id: "e3", from: "check-a", to: "quadratic", semantics: "success" as const, label: "Có", important: false },
    { id: "e4", from: "quadratic", to: "out-quadratic", semantics: "request" as const, important: false },
    { id: "e5", from: "out-quadratic", to: "end", semantics: "request" as const, important: false },
    { id: "e6", from: "check-a", to: "normalise", semantics: "failure" as const, label: "Không", important: true },
    { id: "e7", from: "normalise", to: "depress", semantics: "request" as const, important: true },
    { id: "e8", from: "depress", to: "delta", semantics: "request" as const, important: true },
    { id: "e9", from: "delta", to: "check-pos", semantics: "request" as const, important: true },
    { id: "e10", from: "check-pos", to: "one-root", semantics: "success" as const, label: "Có", important: true },
    { id: "e11", from: "one-root", to: "out-one", semantics: "request" as const, important: true },
    { id: "e12", from: "out-one", to: "end", semantics: "request" as const, important: true },
    { id: "e13", from: "check-pos", to: "check-zero", semantics: "failure" as const, label: "Không", important: false },
    { id: "e14", from: "check-zero", to: "check-pq", semantics: "success" as const, label: "Có", important: false },
    { id: "e15", from: "check-pq", to: "triple", semantics: "success" as const, label: "Có", important: false },
    { id: "e16", from: "triple", to: "out-triple", semantics: "request" as const, important: false },
    { id: "e17", from: "out-triple", to: "end", semantics: "request" as const, important: false },
    { id: "e18", from: "check-pq", to: "double", semantics: "failure" as const, label: "Không", important: false },
    { id: "e19", from: "double", to: "out-double", semantics: "request" as const, important: false },
    { id: "e20", from: "out-double", to: "end", semantics: "request" as const, important: false },
    { id: "e21", from: "check-zero", to: "three", semantics: "failure" as const, label: "Không", important: false },
    { id: "e22", from: "three", to: "out-three", semantics: "request" as const, important: false },
    { id: "e23", from: "out-three", to: "end", semantics: "request" as const, important: false },
  ],
};

describe("cubic solver flowchart", () => {
  it("reads top to bottom, not left to right", async () => {
    const laid = await layoutDocument(compilePlan(plan));
    const at = (id: string) => laid.nodes.find((node) => node.id === id)!.position;

    // The regression this guards: flow mode used the lane layout, which put all
    // twenty steps on one row — a 5,700px strip with zero vertical extent.
    const rows = new Set(laid.nodes.map((node) => node.position.y));
    expect(rows.size).toBeGreaterThan(8);

    const spanX = Math.max(...laid.nodes.map((n) => n.position.x)) - Math.min(...laid.nodes.map((n) => n.position.x));
    const spanY = Math.max(...laid.nodes.map((n) => n.position.y)) - Math.min(...laid.nodes.map((n) => n.position.y));
    expect(spanY).toBeGreaterThan(spanX);

    // Reading order: entry at the top, exit at the bottom, decisions between.
    expect(at("start").y).toBeLessThan(at("check-a").y);
    expect(at("check-a").y).toBeLessThan(at("delta").y);
    expect(at("delta").y).toBeLessThan(at("check-pos").y);
    expect(at("end").y).toBeGreaterThan(at("out-three").y);
    expect(at("end").y).toBe(Math.max(...laid.nodes.map((node) => node.position.y)));
  });

  it("keeps the connectors from crossing more than a little", async () => {
    const laid = await layoutDocument(compilePlan(plan));
    // Twenty nodes with five exits into one join cannot reach zero, but the
    // sweep has to stay well under what an unordered layout produces.
    expect(countEdgeCrossings(laid)).toBeLessThanOrEqual(4);
  });

  it("chooses a frame that matches the shape of what was drawn", async () => {
    const laid = await layoutDocument(compilePlan(plan));
    // "Auto" used to keep the workspace's 16:9, which fitted a tall flowchart
    // by widening the canvas to 3,925px and leaving it a ribbon in the middle.
    expect(bestFitFormat(laid)).toBe("9:16");
  });

  it("shows every formula in full", async () => {
    const laid = await layoutDocument(compilePlan(plan));
    const document = { ...laid, format: bestFitFormat(laid) };
    const svg = renderDocumentSvg(document, { animate: false });

    // Transliterated, not raw LaTeX.
    expect(svg).toContain("Δ = (q/2)² + (p/3)³");
    expect(svg).not.toContain("\\Delta");
    expect(svg).not.toContain("\\frac");

    // A long formula wraps rather than being cut off or running past its box.
    expect(svg).toContain("<tspan");
    for (const fragment of ["2A³/27", "-3q/(2p)", "2kπ", "C = d/a"]) {
      expect(svg, `missing ${fragment}`).toContain(fragment);
    }

    if (process.env.WRITE_ARTIFACT) writeFileSync(process.env.WRITE_ARTIFACT, svg);
  });

  it("paints the house style", async () => {
    const document = compilePlan(plan);
    const colour = (id: string) => document.nodes.find((node) => node.id === id)!.color;
    expect(colour("start")).toBe(colour("end"));
    expect(colour("check-a")).toBe(roleColors.decision);
    expect(colour("normalise")).toBe(roleColors.process);
    expect(colour("input")).toBe(roleColors["input-output"]);
  });
});
