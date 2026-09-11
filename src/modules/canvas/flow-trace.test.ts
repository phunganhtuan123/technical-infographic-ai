import { describe, expect, it } from "vitest";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { architecturePlan } from "@/modules/fixtures/architecture-plan";
import { diagramSamples } from "@/modules/fixtures/diagram-samples";
import { traceStateAt, traceSteps } from "./flow-trace";

describe("flow trace", () => {
  it("visits every node exactly once", () => {
    for (const sample of diagramSamples) {
      const document = compilePlan(sample.plan);
      const steps = traceSteps(document);
      const drawable = document.nodes.filter((node) => node.role !== "zone" && node.role !== "group");
      const visited = steps.map((step) => step.node);
      expect(new Set(visited).size, sample.plan.id).toBe(drawable.length);
      expect(visited.length, sample.plan.id).toBe(drawable.length);
    }
  });

  it("starts at an entry point rather than mid-diagram", () => {
    const document = compilePlan(architecturePlan);
    const steps = traceSteps(document);
    const first = document.nodes.find((node) => node.id === steps[0].node)!;
    const feeders = document.edges.filter((edge) => edge.to === first.id);
    expect(feeders.length === 0 || first.lane === "entry" || first.role === "start").toBe(true);
  });

  it("never arrives somewhere before the step that leads there", () => {
    const document = compilePlan(architecturePlan);
    const steps = traceSteps(document);
    const seen = new Set<string>();
    for (const step of steps) {
      // Every connector lit on arrival must come from somewhere already walked.
      for (const edgeId of step.edges) {
        const edge = document.edges.find((candidate) => candidate.id === edgeId)!;
        expect(seen.has(edge.from), `${edgeId} lit too early`).toBe(true);
      }
      seen.add(step.node);
    }
  });

  it("lights the current node and keeps earlier ones lit", () => {
    const steps = traceSteps(compilePlan(architecturePlan));
    const midway = traceStateAt(steps, 3);
    expect(midway.activeNode).toBe(steps[3].node);
    expect(midway.done.has(steps[0].node)).toBe(true);
    expect(midway.done.has(steps[3].node)).toBe(false);
    expect(midway.finished).toBe(false);
  });

  it("reports the end of the walk", () => {
    const steps = traceSteps(compilePlan(architecturePlan));
    expect(traceStateAt(steps, steps.length - 1).finished).toBe(true);
    expect(traceStateAt(steps, 999).index).toBe(steps.length - 1);
  });

  it("shows nothing lit before it starts", () => {
    const steps = traceSteps(compilePlan(architecturePlan));
    const idle = traceStateAt(steps, -1);
    expect(idle.activeNode).toBeUndefined();
    expect(idle.done.size).toBe(0);
  });

  it("survives a diagram with no connectors at all", () => {
    const document = compilePlan({ ...architecturePlan, edges: [] });
    expect(traceSteps(document)).toHaveLength(document.nodes.filter((n) => n.role !== "zone" && n.role !== "group").length);
  });
});
