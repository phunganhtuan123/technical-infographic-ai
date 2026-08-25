import { describe, expect, it } from "vitest";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { architecturePlan } from "@/modules/fixtures/architecture-plan";
import { diagramSamples } from "@/modules/fixtures/diagram-samples";
import { layoutDocument } from "./layout-document";

describe("layoutDocument", () => {
  it("does not place two nodes at the same position", async () => {
    const document = await layoutDocument(compilePlan(architecturePlan));
    const positions = document.nodes.map((node) => `${node.position.x}:${node.position.y}`);

    expect(new Set(positions).size).toBe(positions.length);
  });

  it("keeps node bounding boxes separated", async () => {
    const document = await layoutDocument(compilePlan(architecturePlan));
    for (let index = 0; index < document.nodes.length; index += 1) {
      const left = document.nodes[index];
      for (const right of document.nodes.slice(index + 1)) {
        const overlaps = left.position.x < right.position.x + right.size.width
          && left.position.x + left.size.width > right.position.x
          && left.position.y < right.position.y + right.size.height
          && left.position.y + left.size.height > right.position.y;
        expect(overlaps, `${left.id} overlaps ${right.id}`).toBe(false);
      }
    }
  });

  it("aligns owned databases below their services", async () => {
    const document = await layoutDocument(compilePlan(architecturePlan));
    const byId = new Map(document.nodes.map((node) => [node.id, node]));

    for (const edge of document.edges.filter((candidate) => candidate.semantics === "data")) {
      expect(byId.get(edge.to)?.position.x).toBe(byId.get(edge.from)?.position.x);
      expect(byId.get(edge.to)?.position.y).toBeGreaterThan(byId.get(edge.from)?.position.y ?? 0);
    }
  });

  it("keeps the async cluster out of owned data columns", async () => {
    const document = await layoutDocument(compilePlan(architecturePlan));
    const asyncNodes = document.nodes.filter((node) => node.lane === "async");
    const dataEdges = document.edges.filter((edge) => edge.semantics === "data");
    const byId = new Map(document.nodes.map((node) => [node.id, node]));

    for (const edge of dataEdges) {
      const x = (byId.get(edge.from)?.position.x ?? 0) + 110;
      expect(asyncNodes.some((node) => x > node.position.x && x < node.position.x + 220)).toBe(false);
    }
  });

  it("lays out every sample deterministically without overlapping ordinary nodes", async () => {
    for (const sample of diagramSamples) {
      const first = await layoutDocument(compilePlan(sample.plan));
      const second = await layoutDocument(first);
      const nodes = first.nodes.filter((node) => !node.containerId && node.role !== "zone" && node.role !== "group");
      expect(second.nodes.map((node) => node.position), sample.label).toEqual(first.nodes.map((node) => node.position));
      expect(first.edges.every((edge) => !edge.routeWaypoint && !edge.routeWaypoints?.length), sample.label).toBe(true);
      for (let index = 0; index < nodes.length; index += 1) {
        const left = nodes[index];
        for (const right of nodes.slice(index + 1)) {
          const overlaps = left.position.x < right.position.x + right.size.width
            && left.position.x + left.size.width > right.position.x
            && left.position.y < right.position.y + right.size.height
            && left.position.y + left.size.height > right.position.y;
          expect(overlaps, `${sample.label}: ${left.id} overlaps ${right.id}`).toBe(false);
        }
      }
    }
  });

  it("uses a stable vertical composition for portrait formats", async () => {
    const document = compilePlan(architecturePlan);
    document.format = "9:16";
    const arranged = await layoutDocument(document);
    const ordinary = arranged.nodes.filter((node) => node.role !== "zone" && node.role !== "group");

    expect(new Set(ordinary.map((node) => node.position.y)).size).toBe(ordinary.length);
    expect(arranged.edges.some((edge) => edge.targetPort === "top-center")).toBe(true);
  });
});
