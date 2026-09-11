import { describe, expect, it } from "vitest";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { layoutDocument } from "./layout-document";
import { architecturePlan } from "@/modules/fixtures/architecture-plan";

describe("connector anchors", () => {
  it("meets the box in the middle when a side carries one connector", async () => {
    const document = await layoutDocument(compilePlan(architecturePlan));
    const down = new Set(["event-input-bottom", "event-output", "data-output"]);
    const up = new Set(["event-input", "top-center", "data-input"]);

    const leaving = new Map<string, number>();
    const arriving = new Map<string, number>();
    for (const edge of document.edges) {
      if (down.has(edge.sourcePort)) leaving.set(edge.from, (leaving.get(edge.from) ?? 0) + 1);
      if (up.has(edge.targetPort)) arriving.set(edge.to, (arriving.get(edge.to) ?? 0) + 1);
    }

    // The offset anchors exist to keep connectors apart. A side with only one
    // has nothing to avoid, so it should not be pushed off centre.
    for (const edge of document.edges) {
      if (down.has(edge.sourcePort) && (leaving.get(edge.from) ?? 0) === 1) {
        expect(edge.sourcePort, `${edge.id} source`).toBe("event-output");
      }
      if (up.has(edge.targetPort) && (arriving.get(edge.to) ?? 0) === 1) {
        expect(edge.targetPort, `${edge.id} target`).toBe("top-center");
      }
    }
  });

  it("gives every connector on a shared side its own anchor", async () => {
    const { serverlessTemplate } = await import("@/modules/fixtures/architecture-templates");
    const document = await layoutDocument(compilePlan(serverlessTemplate));

    // Two functions writing to the same table both resolved to the middle
    // anchor, and 419px of the two connectors were drawn on top of each other.
    const byTarget = new Map<string, string[]>();
    for (const edge of document.edges) {
      const up = ["event-input", "top-center", "data-input"];
      if (!up.includes(edge.targetPort)) continue;
      byTarget.set(edge.to, [...(byTarget.get(edge.to) ?? []), edge.targetPort]);
    }
    for (const [node, ports] of byTarget) {
      expect(new Set(ports).size, `${node} reuses an anchor`).toBe(ports.length);
    }
  });

  it("still separates connectors when one node feeds several below it", async () => {
    const fanout = {
      ...architecturePlan,
      edges: [
        ...architecturePlan.edges,
        { id: "extra-data", from: "market", to: "policy-db", semantics: "data" as const, important: false },
      ],
    };
    const document = await layoutDocument(compilePlan(fanout));
    const fromMarket = document.edges.filter((edge) => edge.from === "market" && edge.semantics === "data");
    expect(fromMarket.length).toBeGreaterThan(1);
    // With more than one leaving downward, the offset anchor is used again.
    expect(fromMarket.some((edge) => edge.sourcePort === "data-output")).toBe(true);
  });
});

describe("auto layout crossings", () => {
  it("keeps the built-in samples close to crossing-free", async () => {
    const { diagramSamples } = await import("@/modules/fixtures/diagram-samples");
    const { countEdgeCrossings } = await import("./layout-document");

    // The architecture sample used to cross seven times: the async lane was
    // spread evenly across the row, which dragged the event bus to the far side
    // of the service feeding it. Placing each node under what it connects to
    // took it to zero. Feedback loops in the agent sample cannot reach zero.
    // Measured, not aspirational. A diagram where one node fans out to several
    // below it, or loops back on itself, cannot reach zero without moving the
    // boxes somewhere that reads worse; these are the numbers the current
    // layout achieves, and the test exists to stop them growing.
    const budget: Record<string, number> = {
      "marketplace-architecture": 0,
      "sample-events": 2,
      "sample-agent": 1,
      "template-microservices": 2,
      "template-serverless": 1,
      "template-multi-region": 1,
      "template-observability": 2,
      "template-rag": 1,
    };

    for (const sample of diagramSamples) {
      const laid = await layoutDocument(compilePlan(sample.plan));
      const allowed = budget[sample.plan.id] ?? 0;
      expect(countEdgeCrossings(laid), `${sample.plan.id} crossings`).toBeLessThanOrEqual(allowed);
    }
  });
});

describe("callers", () => {
  it("stacks several entry points beside the system instead of ahead of it", async () => {
    const { microservicesTemplate } = await import("@/modules/fixtures/architecture-templates");
    const document = await layoutDocument(compilePlan(microservicesTemplate));
    const byId = new Map(document.nodes.map((node) => [node.id, node]));

    const web = byId.get("web")!;
    const mobile = byId.get("mobile")!;
    const gateway = byId.get("gateway")!;

    // Two callers in a row meant the first one's connector had to detour around
    // the second, which drew two long parallel lines over the whole diagram.
    expect(web.position.x).toBe(mobile.position.x);
    expect(web.position.y).not.toBe(mobile.position.y);
    expect(Math.max(web.position.x + web.size.width, mobile.position.x + mobile.size.width))
      .toBeLessThanOrEqual(gateway.position.x);
  });

  it("leaves a lone caller in the row", async () => {
    const { cqrsTemplate } = await import("@/modules/fixtures/architecture-templates");
    const document = await layoutDocument(compilePlan(cqrsTemplate));
    const byId = new Map(document.nodes.map((node) => [node.id, node]));
    // Nothing to route around, so nothing to move.
    expect(byId.get("client")!.position.y).toBe(byId.get("command")!.position.y);
  });
});

describe("anchors follow the boxes", () => {
  it("switches to vertical anchors once a box sits below another", async () => {
    const { planPorts } = await import("./layout-document");
    const box = (id: string, x: number, y: number) => ({
      id, label: id, role: "service", lane: "core", position: { x, y },
      size: { width: 220, height: 104 },
    }) as never;

    const edges = [{ id: "e", from: "a", to: "b", semantics: "request", important: true }] as never[];

    // Side by side: a horizontal pair.
    const sideBySide = planPorts(edges, new Map([["a", box("a", 0, 0)], ["b", box("b", 400, 0)]] as never));
    expect(sideBySide.get("e")).toEqual({ sourcePort: "output", targetPort: "input" });

    // Dragged below: the connector should leave the bottom and arrive at the
    // top. Keeping the sideways anchors is what drew a long L around the box.
    const stacked = planPorts(edges, new Map([["a", box("a", 0, 0)], ["b", box("b", 20, 400)]] as never));
    expect(stacked.get("e")).toEqual({ sourcePort: "event-output", targetPort: "top-center" });
  });
});
