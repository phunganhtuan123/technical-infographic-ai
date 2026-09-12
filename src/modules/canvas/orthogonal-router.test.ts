import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { routeIntersectsObstacle, routeOrthogonal } from "./orthogonal-router";

describe("routeOrthogonal", () => {
  it("routes around a component with a small number of bends", () => {
    const obstacle = { x: 180, y: 60, width: 220, height: 104 };
    const route = routeOrthogonal({
      source: { x: 100, y: 112 },
      target: { x: 500, y: 112 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      obstacles: [obstacle],
    });
    expect(routeIntersectsObstacle(route.points.slice(1, -1), [{ x: 162, y: 42, width: 256, height: 140 }])).toBe(false);
    expect(route.points.length).toBeLessThanOrEqual(6);
  });

  it("uses the direct orthogonal path when no obstacle exists", () => {
    const route = routeOrthogonal({ source: { x: 100, y: 80 }, target: { x: 420, y: 200 }, sourcePosition: Position.Right, targetPosition: Position.Left, obstacles: [] });
    expect(route.points.length).toBeLessThanOrEqual(5);
  });

  it("keeps straight endpoint leads and never reverses at a component", () => {
    const route = routeOrthogonal({ source: { x: 100, y: 80 }, target: { x: 420, y: 200 }, sourcePosition: Position.Right, targetPosition: Position.Left, obstacles: [] });
    const sourceLead = route.points[1].x - route.points[0].x;
    const last = route.points.length - 1;
    const targetEntry = route.points[last].x - route.points[last - 1].x;

    expect(sourceLead).toBeGreaterThanOrEqual(14);
    expect(route.points[1].y).toBe(route.points[0].y);
    expect(targetEntry).toBeGreaterThanOrEqual(14);
    expect(route.points[last].y).toBe(route.points[last - 1].y);
  });

  it("escapes a close obstacle without routing through it", () => {
    const obstacle = { x: 1016, y: 312, width: 220, height: 104 };
    const route = routeOrthogonal({
      source: { x: 991.5, y: 372 },
      target: { x: 1292.5, y: 348 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      obstacles: [obstacle],
      offset: 16,
    });

    expect(routeIntersectsObstacle(route.points, [obstacle]), JSON.stringify(route.points)).toBe(false);
    expect(route.points.length).toBeLessThanOrEqual(6);
  });

  it("detours a vertical data path around a side obstacle", () => {
    const obstacle = { x: 832, y: 472, width: 220, height: 104 };
    const route = routeOrthogonal({
      source: { x: 874.875, y: 236.5 },
      target: { x: 874.875, y: 711.5 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      obstacles: [obstacle],
      offset: 24,
    });

    expect(routeIntersectsObstacle(route.points, [obstacle]), JSON.stringify(route.points)).toBe(false);
    expect(route.points.length).toBeLessThanOrEqual(6);
  });

  it("does not cross a target body when connecting to its bottom port", () => {
    const targetBody = { x: 8, y: 208, width: 184, height: 84 };
    const route = routeOrthogonal({
      source: { x: 100, y: 100 },
      target: { x: 100, y: 300 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Bottom,
      obstacles: [],
      protectedObstacles: [targetBody],
    });

    expect(routeIntersectsObstacle(route.points, [targetBody]), JSON.stringify(route.points)).toBe(false);
  });

  it("routes through a dragged waypoint when the lane is clear", () => {
    const waypoint = { x: 260, y: 40 };
    const route = routeOrthogonal({
      source: { x: 100, y: 100 },
      target: { x: 420, y: 180 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      obstacles: [],
      waypoint,
    });

    const passesWaypoint = route.points.slice(1).some((point, index) => {
      const start = route.points[index];
      return start.x === point.x
        ? waypoint.x === start.x && waypoint.y >= Math.min(start.y, point.y) && waypoint.y <= Math.max(start.y, point.y)
        : waypoint.y === start.y && waypoint.x >= Math.min(start.x, point.x) && waypoint.x <= Math.max(start.x, point.x);
    });
    expect(passesWaypoint).toBe(true);
    expect(route.points.length).toBeLessThanOrEqual(6);
  });

  it("routes through multiple dragged control points", () => {
    const waypoints = [{ x: 180, y: 40 }, { x: 320, y: 240 }];
    const route = routeOrthogonal({
      source: { x: 80, y: 120 },
      target: { x: 440, y: 160 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      obstacles: [],
      waypoints,
    });

    const adjustableSegments = route.points.slice(1).filter((point, index) => Math.abs(point.x - route.points[index].x) + Math.abs(point.y - route.points[index].y) >= 8);
    expect(route.controls).toHaveLength(adjustableSegments.length);
    expect(route.controls.length).toBeGreaterThan(waypoints.length);
    expect(route.controls.every((control) => control.segmentIndex > 0 && (control.orientation === "horizontal" || control.orientation === "vertical"))).toBe(true);
    expect(route.points.length).toBeGreaterThanOrEqual(6);
  });
  it("runs along the horizontal channel it was assigned", () => {
    // Two branches out of one decision. Left to itself the router turns both of
    // them at the same height and draws them as one line; the channel is what
    // tells them apart, so it has to be followed even though turning at the
    // anchor would be shorter.
    const route = routeOrthogonal({
      source: { x: 500, y: 600 },
      target: { x: 300, y: 700 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      obstacles: [],
      laneY: 654,
    });

    const runsOnChannel = route.points.slice(1).some((point, index) =>
      point.y === 654 && route.points[index].y === 654 && point.x !== route.points[index].x);
    expect(runsOnChannel, JSON.stringify(route.points)).toBe(true);
  });

  it("takes the margin it was given rather than cutting across the boxes", () => {
    // A return line from the bottom of a flowchart to its first step. Every
    // column between the two ends is occupied, so the only clean way back is
    // round the outside.
    const obstacles = [0, 1, 2].map((row) => ({ x: 300, y: 200 + row * 200, width: 260, height: 110 }));
    const route = routeOrthogonal({
      source: { x: 430, y: 810 },
      target: { x: 300, y: 150 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Left,
      obstacles,
      laneY: 870,
      laneX: 210,
    });

    expect(routeIntersectsObstacle(route.points, obstacles), JSON.stringify(route.points)).toBe(false);
    expect(route.points.some((point) => point.x === 210), JSON.stringify(route.points)).toBe(true);
  });

  it("still avoids the boxes when the channel it was given is blocked", () => {
    // The plan is worked out from where the boxes were, and the user can drag
    // one afterwards. A stale channel must not be followed into a box.
    const obstacle = { x: 200, y: 300, width: 260, height: 110 };
    const route = routeOrthogonal({
      source: { x: 330, y: 200 },
      target: { x: 330, y: 520 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      obstacles: [obstacle],
      laneY: 350,
    });

    expect(routeIntersectsObstacle(route.points, [obstacle]), JSON.stringify(route.points)).toBe(false);
  });
});
