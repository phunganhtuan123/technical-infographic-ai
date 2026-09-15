import { describe, expect, it } from "vitest";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { architecturePlan } from "@/modules/fixtures/architecture-plan";
import { diagramSamples } from "@/modules/fixtures/diagram-samples";
import { createBlankDocument, createDiagramNode, primitiveDefinitions } from "@/modules/diagram/factory";
import { countEdgeCrossings, layoutDocument, planPorts } from "./layout-document";
import { gapForChannels, planLanes } from "./lane-plan";

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
      // Centres line up; the boxes are no longer the same width.
      const centre = (id: string) => {
        const node = byId.get(id)!;
        return node.position.x + node.size.width / 2;
      };
      // Positions are rounded to whole pixels, so allow one pixel of drift.
      expect(Math.abs(centre(edge.to) - centre(edge.from))).toBeLessThanOrEqual(1);
      expect(byId.get(edge.to)?.position.y).toBeGreaterThan(byId.get(edge.from)?.position.y ?? 0);
    }
  });

  it("only parks a node on a data lane when it buys a crossing-free layout", async () => {
    const document = await layoutDocument(compilePlan(architecturePlan));
    const byId = new Map(document.nodes.map((node) => [node.id, node]));
    const asyncNodes = document.nodes.filter((node) => node.lane === "async");

    // The layout weighs two costs against each other: connectors that cross,
    // and connectors forced to detour around a box sitting on their lane. It
    // prefers the detour, because a crossing is harder to read than a bend —
    // but only when the result is genuinely crossing-free.
    let blocking = 0;
    for (const edge of document.edges.filter((candidate) => candidate.semantics === "data")) {
      const owner = byId.get(edge.from);
      const store = byId.get(edge.to);
      if (!owner || !store) continue;
      const lane = owner.position.x + owner.size.width / 2;
      blocking += asyncNodes.filter((node) =>
        node.position.x < lane
        && node.position.x + node.size.width > lane
        && node.position.y > owner.position.y
        && node.position.y + node.size.height < store.position.y).length;
    }

    if (blocking > 0) expect(countEdgeCrossings(document)).toBe(0);
    expect(blocking).toBeLessThanOrEqual(1);
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

describe("crossing reduction", () => {
  it("orders the async and data lanes by who they connect to", async () => {
    // Three services on the main row, each publishing to its own queue, with
    // the queues listed in the reverse of the order their publishers sit in.
    // Laid out naively that is three crossed connectors; ordered by barycenter
    // it is none.
    const document = {
      ...createBlankDocument("crossing", "Crossing"),
      nodes: [
        ...["a", "b", "c"].map((id, index) => ({
          ...createDiagramNode(primitiveDefinitions.find((p) => p.role === "service")!, { x: index * 300, y: 0 }, `svc-${id}`),
          lane: "core" as const,
        })),
        ...["c", "b", "a"].map((id, index) => ({
          ...createDiagramNode(primitiveDefinitions.find((p) => p.role === "event-bus")!, { x: index * 300, y: 400 }, `queue-${id}`),
          lane: "async" as const,
        })),
      ],
      edges: ["a", "b", "c"].map((id) => ({
        id: `edge-${id}`,
        from: `svc-${id}`,
        to: `queue-${id}`,
        semantics: "event" as const,
        important: true,
        direction: "forward" as const,
        thickness: 1.8,
        color: "#d97706",
        strokeStyle: "solid" as const,
        effect: "pulse" as const,
        speed: 2.1,
        animated: false,
        labelOffset: { x: 0, y: 0 },
        sourcePort: "event-output" as const,
        targetPort: "event-input" as const,
      })),
    };

    const laidOut = await layoutDocument(document);
    expect(countEdgeCrossings(laidOut)).toBe(0);

    const queueX = ["a", "b", "c"].map((id) => laidOut.nodes.find((node) => node.id === `queue-${id}`)!.position.x);
    expect(queueX[0]).toBeLessThan(queueX[1]);
    expect(queueX[1]).toBeLessThan(queueX[2]);
  });
});

describe("room for the connectors", () => {
  it("widens a flowchart gap until the branches crossing it fit", async () => {
    // A decision's two branches both have to run sideways through the gap below
    // it. Spaced by a constant the gap holds one line, so the second was drawn
    // on top of the first.
    const step = (id: string, role: string) => ({
      ...createDiagramNode(primitiveDefinitions.find((primitive) => primitive.role === role)!, { x: 0, y: 0 }, id),
      lane: "core" as const,
    });
    const connect = (id: string, from: string, to: string) => ({
      id, from, to,
      semantics: "request" as const,
      important: true,
      animated: false,
      direction: "forward" as const,
      thickness: 1.8,
      color: "#888888",
      strokeStyle: "solid" as const,
      effect: "pulse" as const,
      speed: 2.1,
      labelOffset: { x: 0, y: 0 },
      sourcePort: "output" as const,
      targetPort: "input" as const,
    });
    const document = {
      ...createBlankDocument("quadratic", "Quadratic"),
      mode: "flow" as const,
      nodes: [
        step("start", "start"), step("delta", "process"), step("sign", "decision"),
        step("none", "process"), step("zero", "decision"), step("double", "process"), step("pair", "process"),
      ],
      edges: [
        connect("e1", "start", "delta"), connect("e2", "delta", "sign"),
        connect("e3", "sign", "none"), connect("e4", "sign", "zero"),
        connect("e5", "zero", "double"), connect("e6", "zero", "pair"),
      ],
    };

    const laidOut = await layoutDocument(document);
    const { demand, rows } = planLanes(laidOut.nodes, laidOut.edges);
    expect(rows.length).toBeGreaterThan(2);
    rows.forEach((row, index) => {
      const next = rows[index + 1];
      if (!next) return;
      expect(next.top - row.bottom, `gap below row ${index}`)
        .toBeGreaterThanOrEqual(gapForChannels(demand.get(index) ?? 0));
    });
  });
});

describe("planPorts", () => {
  const box = (id: string, x: number, y: number) => [id, {
    id, position: { x, y }, size: { width: 240, height: 104 },
  }] as const;
  const wire = (id: string, from: string, to: string) => ({ id, from, to }) as never;
  // Two boxes side by side, and one well above them.
  const sheet = new Map([box("left", 100, 600), box("right", 600, 600), box("above", 300, 100)]
    .map(([id, node]) => [id, node])) as never;

  it("leaves from the side the target is actually on", () => {
    // Everything not going down used to leave from the right and arrive on the
    // left, whichever way it was heading. For a target sitting to the left that
    // is the worst possible pair: the connector leaves the far side of its own
    // box, cannot cut back through it, and loops around — the small hook that
    // shows up beside a node with nothing else near it.
    const plan = planPorts([wire("leftward", "right", "left")], sheet);
    expect(plan.get("leftward")).toEqual({ sourcePort: "input", targetPort: "output" });
  });

  it("keeps the ordinary left-to-right pair for a target on the right", () => {
    const plan = planPorts([wire("rightward", "left", "right")], sheet);
    expect(plan.get("rightward")).toEqual({ sourcePort: "output", targetPort: "input" });
  });

  it("sends a connector climbing back up downwards, not into the gap beside it", () => {
    // It is going down into a channel and round a margin either way — that is
    // the only way past the rows between. A sideways exit adds a turn, and the
    // space beside a box is the narrow gap to its neighbour, already carrying
    // the connectors that genuinely run through it.
    const plan = planPorts([wire("back", "right", "above")], sheet);
    expect(["event-output", "data-output"]).toContain(plan.get("back")!.sourcePort);
    // and it arrives on the margin side rather than crossing the target.
    expect(["input", "output"]).toContain(plan.get("back")!.targetPort);
  });
});
