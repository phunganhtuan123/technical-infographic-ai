import { describe, expect, it } from "vitest";
import { gapForChannels, laneRows, planLanes } from "./lane-plan";

const W = 268;
const H = 118;
const box = (id: string, x: number, y: number) => ({ id, position: { x, y }, size: { width: W, height: H } });
const link = (id: string, from: string, to: string) => ({ id, from, to }) as never;

/** The quadratic-formula flowchart: a decision, two branches, three returns. */
const nodes = [
  box("actor", 410, 55),
  box("delta", 410, 265),
  box("d<0", 410, 480),
  box("none", 214, 685),
  box("d=0", 610, 685),
  box("double", 238, 895),
  box("two", 580, 895),
];

describe("planLanes", () => {
  it("groups nodes on the same line into one row", () => {
    const rows = laneRows(nodes);
    expect(rows.map((row) => row.ids.length)).toEqual([1, 1, 1, 2, 2]);
    expect(rows[0].top).toBeLessThan(rows[1].top);
  });

  it("leaves a straight drop without a corridor", () => {
    const { lanes } = planLanes(nodes, [link("a", "actor", "delta")]);
    expect(lanes.get("a")).toBeUndefined();
  });

  it("gives the two branches of a decision different channels", () => {
    const { lanes } = planLanes(nodes, [link("yes", "d<0", "none"), link("no", "d<0", "d=0")]);
    // Both run sideways through the same gap, so they cannot share a line.
    expect(lanes.get("yes")!.laneY).toBeDefined();
    expect(lanes.get("no")!.laneY).toBeDefined();
    expect(lanes.get("yes")!.laneY).not.toBe(lanes.get("no")!.laneY);
  });

  it("reuses a channel when the two connectors never meet on it", () => {
    // Far apart horizontally: sharing the line is invisible, and stacking them
    // would push the rows apart for nothing.
    const wide = [box("a", 0, 0), box("b", 0, 400), box("c", 2000, 0), box("d", 2000, 400)];
    const { lanes } = planLanes(wide, [link("left", "a", "b"), link("right", "c", "d")]);
    expect(lanes.get("left")?.laneY).toBe(lanes.get("right")?.laneY);
  });

  it("hands a connector between two boxes on one row straight across", () => {
    // "Not going down" was read as "climbing back up", so a neighbour's
    // connector was given the gap under its own row to turn in and a margin to
    // run along, and drew as a small hook going nowhere.
    const { lanes } = planLanes(nodes, [link("across", "double", "two")]);
    expect(lanes.get("across")).toBeUndefined();
  });

  it("does not send a connector to the margin just for passing a row", () => {
    // The margin is six hundred pixels out and six hundred back. Getting around
    // one box in the way is a detour of a few dozen, which the router already
    // considers — the corridor is what keeps two such detours off one line, and
    // that is all the margin was ever needed for here.
    const { lanes } = planLanes(nodes, [link("skip", "d<0", "double")]);
    expect(lanes.get("skip")!.laneY).toBeDefined();
    expect(lanes.get("skip")!.laneX).toBeUndefined();
  });

  it("sends a connector climbing back up out to the margin", () => {
    const { lanes } = planLanes(nodes, [link("back", "double", "actor")]);
    const lane = lanes.get("back")!;
    const sheetLeft = Math.min(...nodes.map((node) => node.position.x));
    expect(lane.laneX).toBeLessThan(sheetLeft);
  });

  it("turns a return from the bottom row below the drawing, not above itself", () => {
    // The gap above the source is on the wrong side of it: turning there makes
    // the connector double back through the box it just left.
    const { lanes } = planLanes(nodes, [link("back", "double", "actor")]);
    const sheetBottom = Math.max(...nodes.map((node) => node.position.y + node.size.height));
    expect(lanes.get("back")!.laneY).toBeGreaterThan(sheetBottom);
  });

  it("picks the margin on the side the connector arrives at", () => {
    // Swinging out to the right and coming back into a left-facing port means
    // passing the box to reach it.
    const spread = [box("left", 0, 0), box("right", 1200, 0), box("below", 600, 400)];
    const { lanes } = planLanes(spread, [link("a", "below", "left"), link("b", "below", "right")]);
    expect(lanes.get("a")!.laneX).toBeLessThan(0);
    expect(lanes.get("b")!.laneX).toBeGreaterThan(1200 + 268);
  });

  it("reports how much room each gap needs", () => {
    const { demand } = planLanes(nodes, [link("yes", "d<0", "none"), link("no", "d<0", "d=0")]);
    expect(demand.get(2)).toBe(2);
    expect(gapForChannels(2)).toBeGreaterThan(gapForChannels(1));
    expect(gapForChannels(0)).toBe(0);
  });

  it("does not put two connectors on the same corridor anywhere in the sheet", () => {
    const edges = [
      link("e1", "actor", "delta"), link("e2", "delta", "d<0"),
      link("e3", "d<0", "none"), link("e4", "d<0", "d=0"),
      link("e5", "d=0", "double"), link("e6", "d=0", "two"),
      link("e7", "none", "actor"), link("e8", "double", "actor"), link("e9", "two", "actor"),
    ];
    const { lanes } = planLanes(nodes, edges);
    const returns = ["e7", "e8", "e9"].map((id) => lanes.get(id)!);
    expect(new Set(returns.map((lane) => lane.laneX)).size).toBe(3);
  });

  it("survives a drawing with no nodes", () => {
    expect(planLanes([], [link("a", "x", "y")]).lanes.size).toBe(0);
  });
});
