import { describe, expect, it } from "vitest";
import { nodeInk, roleColors } from "@/modules/catalog/catalog";
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
    expect(node.color).toBe(roleColors.service);
    expect(node).toMatchObject({ textColor: nodeInk, fontFamily: "geist-mono", fontSize: 14, fontWeight: 700, textAlign: "left", borderStyle: "solid", borderWidth: 1, effect: "none", speed: 2.1, size: { width: 220, height: 104 } });
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

  it("covers every chart mode and keeps each template valid", () => {
    const modes = ["architecture", "flow", "sequence", "data-pipeline", "event-driven", "agent-loop", "infrastructure", "comparison", "explainer-grid"];

    // The library is no longer one sample per mode — it is a template gallery —
    // but every mode must still be represented by at least one of them.
    expect([...new Set(diagramSamples.map((sample) => sample.plan.mode))].sort()).toEqual([...modes].sort());

    expect(diagramSamples.map((sample) => sample.number)).toEqual(diagramSamples.map((_, index) => index + 1));
    expect(new Set(diagramSamples.map((sample) => sample.id)).size).toBe(diagramSamples.length);
    expect(new Set(diagramSamples.map((sample) => sample.plan.id)).size).toBe(diagramSamples.length);
    expect(new Set(diagramSamples.map((sample) => sample.plan.title)).size).toBe(diagramSamples.length);
    expect(diagramSamples.every((sample) => sample.category.length > 0)).toBe(true);

    for (const sample of diagramSamples) {
      expect(sample.plan.nodes.length, `${sample.id} nodes`).toBeGreaterThanOrEqual(4);
      if (sample.plan.mode !== "explainer-grid") {
        expect(sample.plan.edges.length, `${sample.id} edges`).toBeGreaterThanOrEqual(3);
      }
      const nodeIds = new Set(sample.plan.nodes.map((node) => node.id));
      expect(nodeIds.size, `${sample.id} duplicate node id`).toBe(sample.plan.nodes.length);
      for (const edge of sample.plan.edges) {
        expect(nodeIds.has(edge.from), `${sample.id}:${edge.id} unknown source`).toBe(true);
        expect(nodeIds.has(edge.to), `${sample.id}:${edge.id} unknown target`).toBe(true);
      }
      expect(new Set(sample.plan.edges.map((edge) => edge.id)).size, `${sample.id} duplicate edge id`).toBe(sample.plan.edges.length);
      expect(compilePlan(sample.plan).nodes.length, `${sample.id} compiles`).toBe(sample.plan.nodes.length);
    }
  });
});
