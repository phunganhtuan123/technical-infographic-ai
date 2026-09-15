import { describe, expect, it } from "vitest";
import { MAX_SHIFT, edgeLanes, spreadAt } from "./edge-lanes";

const edge = (id: string, from: string, to: string, sourcePort = "output", targetPort = "input") =>
  ({ id, from, to, sourcePort, targetPort }) as never;

describe("edge lanes", () => {
  it("leaves a lone connector on the anchor", () => {
    const lanes = edgeLanes([edge("a", "x", "y")]);
    expect(lanes.get("a")).toMatchObject({ shift: 0, targetShift: 0, lead: 14 });
  });

  it("spreads connectors that leave the same anchor", () => {
    // Two writes into one table used to start at the same point and be drawn
    // as a single line for 400px.
    const lanes = edgeLanes([edge("a", "x", "z"), edge("b", "y", "z")]);
    expect(lanes.get("a")!.targetShift).not.toBe(lanes.get("b")!.targetShift);
  });

  it("gives each connector out of one box a different lead and detour", () => {
    const lanes = edgeLanes([edge("a", "x", "p"), edge("b", "x", "q"), edge("c", "x", "r")]);
    const leads = ["a", "b", "c"].map((id) => lanes.get(id)!.lead);
    const detours = ["a", "b", "c"].map((id) => lanes.get(id)!.detour);
    const shifts = ["a", "b", "c"].map((id) => lanes.get(id)!.shift);
    expect(new Set(leads).size).toBe(3);
    expect(new Set(detours).size).toBe(3);
    expect(new Set(shifts).size).toBe(3);
  });

  it("counts the two ends separately", () => {
    // Shifting both ends of a connector by the same amount is what moved an
    // arrival on top of a different connector.
    const lanes = edgeLanes([edge("a", "x", "p"), edge("b", "x", "q"), edge("c", "w", "p")]);
    expect(lanes.get("a")!.shift).not.toBe(0);      // one of two leaving x
    expect(lanes.get("a")!.targetShift).not.toBe(0); // one of two arriving at p
    expect(lanes.get("b")!.targetShift).toBe(0);     // only connector into q
  });

  it("keeps the spread inside the box", () => {
    const many = Array.from({ length: 9 }, (_, i) => edge(`e${i}`, "x", `t${i}`));
    for (const lane of edgeLanes(many).values()) {
      expect(Math.abs(lane.shift)).toBeLessThanOrEqual(MAX_SHIFT);
    }
  });

  it("centres an odd group on the anchor", () => {
    expect(spreadAt(1, 3)).toBe(0);
    expect(spreadAt(0, 3)).toBe(-20);
    expect(spreadAt(2, 3)).toBe(20);
  });

  it("keeps a there-and-back pair off a single point", () => {
    // Two boxes wired both ways. Departures and arrivals used to be tallied
    // separately, so each connector came out as the only one at its anchor,
    // each took the centre, and the pair was drawn as one line.
    const lanes = edgeLanes([
      edge("there", "a", "b", "output", "input"),
      edge("back", "b", "a", "input", "output"),
    ]);
    expect(lanes.get("there")!.shift).not.toBe(0);
    expect(lanes.get("back")!.targetShift).not.toBe(0);
  });

  it("treats different anchors on one box as different groups", () => {
    const lanes = edgeLanes([
      edge("a", "x", "p", "output"),
      edge("b", "x", "q", "event-output"),
    ]);
    expect(lanes.get("a")!.shift).toBe(0);
    expect(lanes.get("b")!.shift).toBe(0);
  });
});
