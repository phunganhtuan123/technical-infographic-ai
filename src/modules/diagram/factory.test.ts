import { describe, expect, it } from "vitest";
import { createBlankDocument, createDiagramNode, findAvailablePosition, primitiveDefinitions } from "./factory";
import { diagramSamples } from "@/modules/fixtures/diagram-samples";
import { compilePlan } from "@/modules/compiler/compile-plan";

describe("diagram factory", () => {
  it("creates an independent blank workspace", () => {
    const document = createBlankDocument("workspace-2", "Untitled 2");

    expect(document).toMatchObject({ id: "workspace-2", title: "Untitled 2", nodes: [], edges: [] });
  });

  it("creates a semantic node with named ports", () => {
    const service = primitiveDefinitions.find((primitive) => primitive.role === "service");
    expect(service).toBeDefined();

    const node = createDiagramNode(service!, { x: 120, y: 80 }, "service-1");
    expect(node.color).toBe("#63e6ff");
    expect(node).toMatchObject({ textColor: "#f5f5f5", fontFamily: "geist-mono", fontSize: 14, fontWeight: 700, textAlign: "left", borderStyle: "solid", borderWidth: 1, effect: "none", speed: 2.1, size: { width: 220, height: 104 } });
    expect(node.ports.map((port) => port.id)).toContain("output");
    expect(node.ports.map((port) => port.id)).toContain("top-center");
  });

  it("places click-inserted nodes on the next free grid cell", () => {
    const origin = { x: 320, y: 240 };
    const next = findAvailablePosition(origin, [origin]);

    expect(next).not.toEqual(origin);
    expect(Math.abs(next.x - origin.x) >= 252 || Math.abs(next.y - origin.y) >= 136).toBe(true);
  });

  it("includes the basic flowchart primitives", () => {
    const roles = ["start", "process", "decision", "input-output", "end", "document", "subprocess", "manual-input", "preparation", "delay", "connector", "off-page", "merge", "stored-data", "zone", "group", "text", "note"];
    expect(primitiveDefinitions.filter((primitive) => roles.includes(primitive.role)).map((primitive) => primitive.role)).toEqual(roles);
  });

  it("provides draggable technology components with technology-specific styling", () => {
    const technologies = primitiveDefinitions.filter((primitive) => primitive.technology);
    const postgres = technologies.find((primitive) => primitive.technology === "postgresql");
    const sqs = technologies.find((primitive) => primitive.technology === "aws-sqs");

    expect(technologies.length).toBeGreaterThanOrEqual(40);
    expect(createDiagramNode(postgres!, { x: 0, y: 0 }, "postgres")).toMatchObject({ role: "database", technology: "postgresql", color: "#60a5fa" });
    expect(createDiagramNode(sqs!, { x: 0, y: 0 }, "sqs")).toMatchObject({ role: "event-bus", technology: "aws-sqs", provider: "AWS" });
  });

  it("gives containers and annotations purpose-specific geometry", () => {
    const nodeFor = (role: string) => createDiagramNode(primitiveDefinitions.find((primitive) => primitive.role === role)!, { x: 0, y: 0 }, role);

    expect(nodeFor("zone")).toMatchObject({ size: { width: 520, height: 300 }, labelPosition: { side: "top", offset: 0.16 } });
    expect(nodeFor("group")).toMatchObject({ size: { width: 440, height: 260 }, labelPosition: { side: "top", offset: 0.16 } });
    expect(nodeFor("text").size).toEqual({ width: 240, height: 72 });
    expect(nodeFor("text")).toMatchObject({ fontSize: 18, textAlign: "left" });
    expect(nodeFor("note").size).toEqual({ width: 240, height: 136 });
  });

  it("provides exactly one valid sample for every chart mode", () => {
    const modes = ["architecture", "flow", "sequence", "data-pipeline", "event-driven", "agent-loop", "infrastructure", "comparison", "explainer-grid"];
    expect(diagramSamples).toHaveLength(modes.length);
    expect(diagramSamples.map((sample) => sample.number)).toEqual(Array.from({ length: modes.length }, (_, index) => index + 1));
    expect(new Set(diagramSamples.map((sample) => sample.id)).size).toBe(modes.length);
    expect(new Set(diagramSamples.map((sample) => sample.plan.title)).size).toBe(modes.length);
    expect(diagramSamples.map((sample) => sample.plan.mode).sort()).toEqual([...modes].sort());
    expect(diagramSamples.every((sample) => sample.plan.nodes.length >= 4 && (sample.plan.mode === "explainer-grid" || sample.plan.edges.length >= 3))).toBe(true);
    expect(diagramSamples.every((sample) => {
      const nodeIds = new Set(sample.plan.nodes.map((node) => node.id));
      return nodeIds.size === sample.plan.nodes.length && sample.plan.edges.every((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
    })).toBe(true);
    expect(diagramSamples.every((sample) => compilePlan(sample.plan).nodes.length === sample.plan.nodes.length)).toBe(true);
  });
});
