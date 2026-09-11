import { describe, expect, it } from "vitest";
import { edgeColors, resolveEdgeColor, resolveNodeColor, roleColors } from "./catalog";

describe("legacy colour resolution", () => {
  it("brings a diagram saved by the dark-only build back to the current palette", () => {
    // Neon lime was the old default for start; it is invisible mixed into white.
    expect(resolveNodeColor("#b6ff5c", "start")).toBe(roleColors.start);
    expect(resolveNodeColor("#63e6ff", "process")).toBe(roleColors.process);
    expect(resolveNodeColor("#fb7185", "end")).toBe(roleColors.end);
    expect(resolveNodeColor("#a78bfa", "database")).toBe(roleColors.database);
  });

  it("is case-insensitive about how the colour was written", () => {
    expect(resolveNodeColor("#B6FF5C", "start")).toBe(roleColors.start);
  });

  it("never overrides a colour the author chose", () => {
    expect(resolveNodeColor("#ff00ff", "start")).toBe("#ff00ff");
    expect(resolveNodeColor("#123456", "process")).toBe("#123456");
  });

  it("keeps a current palette value untouched", () => {
    expect(resolveNodeColor(roleColors.decision, "decision")).toBe(roleColors.decision);
  });

  it("applies the same rule to connectors, keyed by semantics", () => {
    expect(resolveEdgeColor("#b6ff5c", "request")).toBe(edgeColors.request);
    expect(resolveEdgeColor("#fb7185", "failure")).toBe(edgeColors.failure);
    expect(resolveEdgeColor("#00ffcc", "request")).toBe("#00ffcc");
    expect(resolveEdgeColor(undefined, "event")).toBe(edgeColors.event);
  });
});
