import { describe, expect, it } from "vitest";
import { bestFitFormat, exportBounds } from "./bounds";
import type { DiagramDocument, DiagramNode } from "./schema";

const node = (id: string, x: number, y: number): DiagramNode => ({
  id, label: id, role: "process", lane: "core", position: { x, y },
  size: { width: 220, height: 104 }, color: "#3b82f6", textColor: "#0f172a",
  fontFamily: "geist-mono", fontSize: 14, fontWeight: 700, textAlign: "center",
  borderStyle: "solid", borderWidth: 1, effect: "none", speed: 2.1, ports: [],
} as unknown as DiagramNode);

const doc = (nodes: DiagramNode[], format: DiagramDocument["format"] = "16:9") =>
  ({ id: "d", title: "t", purpose: "p", mode: "flow", nodes, edges: [], format } as unknown as DiagramDocument);

describe("best fit format", () => {
  it("picks a tall frame for a tall flowchart", () => {
    // One column, twelve rows — the cubic solver's shape.
    const nodes = Array.from({ length: 12 }, (_, index) => node(`n${index}`, 700, index * 172));
    expect(bestFitFormat(doc(nodes))).toBe("9:16");
  });

  it("picks a wide frame for a wide diagram", () => {
    const nodes = Array.from({ length: 8 }, (_, index) => node(`n${index}`, index * 300, 120));
    expect(bestFitFormat(doc(nodes))).toBe("16:9");
  });

  it("picks a square frame for a square one", () => {
    // Nodes are 220x104, so a square *arrangement* is not a square bounding
    // box — two columns 400 apart span 620, matched by four rows 172 apart.
    const nodes = [0, 1, 2, 3].flatMap((row) => [
      node(`a${row}`, 0, row * 172),
      node(`b${row}`, 400, row * 172),
    ]);
    expect(bestFitFormat(doc(nodes))).toBe("1:1");
  });

  it("falls back to a wide frame when there is nothing to measure", () => {
    expect(bestFitFormat(doc([]))).toBe("16:9");
  });

  it("stops a tall diagram from being padded into a huge wide canvas", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => node(`n${index}`, 700, index * 172));
    const wide = exportBounds(doc(nodes, "16:9"));
    const fitted = exportBounds(doc(nodes, bestFitFormat(doc(nodes))));
    expect(fitted.width).toBeLessThan(wide.width / 2);
  });
});
