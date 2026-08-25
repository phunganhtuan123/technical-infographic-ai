import { describe, expect, it } from "vitest";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { architecturePlan } from "@/modules/fixtures/architecture-plan";
import { applyPlan, runLocalCompiler } from "./diagram-ai";

describe("diagram AI contract", () => {
  it("changes only selected items with the local compiler", () => {
    const document = compilePlan(architecturePlan);
    const target = document.nodes[0];
    const result = runLocalCompiler({
      operation: "modify",
      scope: "selection",
      prompt: "rename it to Customer Portal",
      document,
      selectedNodeIds: [target.id],
    });
    expect(result.plan.nodes.find((node) => node.id === target.id)?.label).toBe("Customer Portal");
    expect(result.plan.nodes[1].label).toBe(document.nodes[1].label);
  });

  it("preserves positions for nodes that survive an AI edit", () => {
    const document = compilePlan(architecturePlan);
    document.nodes[0].position = { x: 256, y: 128 };
    const result = runLocalCompiler({
      operation: "modify",
      scope: "selection",
      prompt: "change it to database",
      document,
      selectedNodeIds: [document.nodes[0].id],
    });
    const updated = applyPlan(document, result.plan);
    expect(updated.nodes[0].position).toEqual({ x: 256, y: 128 });
    expect(updated.nodes[0].role).toBe("database");
  });

  it("preserves a custom color and technology icon when AI keeps the node type", () => {
    const document = compilePlan(architecturePlan);
    document.nodes[0] = { ...document.nodes[0], color: "#fb7185", technology: "postgresql" };
    const result = runLocalCompiler({
      operation: "modify",
      scope: "selection",
      prompt: "rename it to Customer Data",
      document,
      selectedNodeIds: [document.nodes[0].id],
    });
    const updated = applyPlan(document, result.plan);
    expect(updated.nodes[0].color).toBe("#fb7185");
    expect(updated.nodes[0].technology).toBe("postgresql");
  });

  it("preserves a manually adjusted connection route across AI edits", () => {
    const document = compilePlan(architecturePlan);
    document.edges[0].routeWaypoint = { x: 480, y: 96 };
    document.edges[0].routeWaypoints = [{ x: 420, y: 80 }, { x: 520, y: 180 }];
    const updated = applyPlan(document, runLocalCompiler({
      operation: "modify",
      scope: "selection",
      prompt: "rename it to Customer Portal",
      document,
      selectedNodeIds: [document.nodes[0].id],
    }).plan);

    expect(updated.edges[0].routeWaypoint).toEqual({ x: 480, y: 96 });
    expect(updated.edges[0].routeWaypoints).toEqual([{ x: 420, y: 80 }, { x: 520, y: 180 }]);
  });
});
