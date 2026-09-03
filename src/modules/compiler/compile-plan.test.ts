import { describe, expect, it } from "vitest";
import { architecturePlan } from "@/modules/fixtures/architecture-plan";
import { compilePlan } from "./compile-plan";

describe("compilePlan", () => {
  it("assigns semantic colors and exact ports", () => {
    const document = compilePlan(architecturePlan);
    const event = document.edges.find((edge) => edge.id === "payment-event");
    const database = document.nodes.find((node) => node.id === "market-db");

    expect(event).toMatchObject({
      sourcePort: "event-output",
      targetPort: "event-input",
      animated: true,
      direction: "forward",
      thickness: 1.8,
      color: "#fbbf24",
      strokeStyle: "dashed",
      effect: "dash",
      speed: 2.7,
      labelOffset: { x: 0, y: 0 },
    });
    expect(database?.color).toBe("#a78bfa");
    expect(database).toMatchObject({ borderStyle: "solid", borderWidth: 1, effect: "glow", speed: 2.1, size: { width: 220, height: 104 } });
    expect(document.edges.find((edge) => edge.id === "event-notify")).toMatchObject({
      sourcePort: "event-output",
      targetPort: "event-input-bottom",
    });
  });

  it("derives motion from what a component is and what a connection means", () => {
    const document = compilePlan(architecturePlan);
    const effectOf = (id: string) => document.nodes.find((node) => node.id === id)?.effect;
    const byRole = new Map(document.nodes.map((node) => [node.role, node.effect]));

    // Every component the plan produced is animated except the ones that frame
    // the diagram rather than take part in it.
    for (const node of document.nodes) {
      const framing = ["zone", "group", "text", "note"].includes(node.role);
      expect(framing ? node.effect === "none" : node.effect !== "none").toBe(true);
    }

    if (byRole.has("database")) expect(byRole.get("database")).toBe("glow");
    if (byRole.has("actor")) expect(byRole.get("actor")).toBe("breathe");
    if (byRole.has("worker")) expect(byRole.get("worker")).toBe("scan");
    if (byRole.has("event-bus")) expect(byRole.get("event-bus")).toBe("scan");
    if (byRole.has("service")) expect(byRole.get("service")).toBe("pulse");

    // Async components run a touch quicker than the synchronous path.
    for (const node of document.nodes) {
      expect(node.speed).toBe(node.lane === "async" ? 2.6 : 2.1);
    }

    // Connections move according to their semantics, not uniformly.
    for (const edge of document.edges) {
      const expected = edge.semantics === "event" || edge.semantics === "failure" ? "dash"
        : edge.semantics === "data" ? "trail"
        : edge.semantics === "feedback" ? "signal"
        : "pulse";
      expect(edge.effect).toBe(expected);
    }

    expect(effectOf("market-db")).toBe("glow");
  });

  it("preserves editable connection direction and thickness", () => {
    const document = compilePlan({
      ...architecturePlan,
      edges: architecturePlan.edges.map((edge) => edge.id === "web-gateway"
        ? { ...edge, direction: "both" as const, thickness: 3.4 }
        : edge),
    });
    expect(document.edges.find((edge) => edge.id === "web-gateway")).toMatchObject({ direction: "both", thickness: 3.4 });
  });

  it("preserves custom connection styling", () => {
    const document = compilePlan({
      ...architecturePlan,
      edges: architecturePlan.edges.map((edge) => edge.id === "web-gateway"
        ? { ...edge, color: "#63e6ff", strokeStyle: "dotted" as const, effect: "glow" as const, speed: 1.4 }
        : edge),
    });
    expect(document.edges.find((edge) => edge.id === "web-gateway")).toMatchObject({ color: "#63e6ff", strokeStyle: "dotted", effect: "glow", speed: 1.4 });
  });

  it("rejects edges that reference missing nodes", () => {
    expect(() =>
      compilePlan({
        ...architecturePlan,
        edges: [...architecturePlan.edges, { id: "broken", from: "missing", to: "web", semantics: "request", important: false }],
      }),
    ).toThrow("unknown node");
  });
});
