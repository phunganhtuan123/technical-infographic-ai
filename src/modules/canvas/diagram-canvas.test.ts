import { describe, expect, it } from "vitest";
import { logicalPortId, sourceHandleId, targetHandleId } from "./diagram-canvas";

describe("connection handle mapping", () => {
  it("preserves every logical point for both edge endpoints", () => {
    const ports = ["input", "output", "top-center", "event-input", "event-input-bottom", "event-output", "data-input", "data-output"] as const;

    for (const port of ports) {
      expect(logicalPortId(sourceHandleId(port), "output")).toBe(port);
      expect(logicalPortId(targetHandleId(port), "input")).toBe(port);
    }
  });

  it("keeps old saved logical handle ids compatible", () => {
    expect(logicalPortId("event-input-bottom", "input")).toBe("event-input-bottom");
    expect(logicalPortId("unknown", "input")).toBe("input");
  });
});
