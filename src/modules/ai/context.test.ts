import { describe, expect, it } from "vitest";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { architecturePlan } from "@/modules/fixtures/architecture-plan";
import { scopedDiagramContext } from "./context";

describe("AI scoped context", () => {
  it("includes the selected node and direct neighbors, not the whole diagram", () => {
    const document = compilePlan(architecturePlan);
    const selected = document.nodes.find((node) => document.edges.some((edge) => edge.from === node.id))!;
    const context = scopedDiagramContext(document, [selected.id], []);
    expect(context.nodes.some((node) => node.id === selected.id)).toBe(true);
    expect(context.nodes.length).toBeLessThan(document.nodes.length);
    expect(context.edges.every((edge) => edge.from === selected.id || edge.to === selected.id)).toBe(true);
  });
});
