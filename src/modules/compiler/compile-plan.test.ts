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
      effect: "pulse",
      speed: 2.7,
      labelOffset: { x: 0, y: 0 },
    });
    expect(database?.color).toBe("#a78bfa");
    expect(database).toMatchObject({ borderStyle: "solid", borderWidth: 1, effect: "none", speed: 2.1, size: { width: 220, height: 104 } });
    expect(document.edges.find((edge) => edge.id === "event-notify")).toMatchObject({
      sourcePort: "event-output",
      targetPort: "event-input-bottom",
    });
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
