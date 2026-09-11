import { Position } from "@xyflow/react";

export type RoutePoint = { x: number; y: number };
export type RouteControl = RoutePoint & { segmentIndex: number; orientation: "horizontal" | "vertical" };
export type RouteObstacle = { x: number; y: number; width: number; height: number };

type RouteInput = {
  source: RoutePoint;
  target: RoutePoint;
  sourcePosition: Position;
  targetPosition: Position;
  obstacles: RouteObstacle[];
  protectedObstacles?: RouteObstacle[];
  waypoint?: RoutePoint;
  waypoints?: RoutePoint[];
  offset?: number;
  /**
   * How far to run straight out of the anchor before turning.
   *
   * Two connectors leaving the same anchor towards boxes on the same row share
   * every lane the router can pick, and are drawn as one line. Giving each a
   * different lead makes them turn at different distances, so they separate
   * immediately after the anchor instead of somewhere near the far end.
   */
  portLead?: number;
};

function lead(point: RoutePoint, position: Position, distance: number): RoutePoint {
  if (position === Position.Left) return { x: point.x - distance, y: point.y };
  if (position === Position.Right) return { x: point.x + distance, y: point.y };
  if (position === Position.Top) return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}

function simplify(points: RoutePoint[]) {
  const deduplicated = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  return deduplicated.filter((point, index) => {
    if (index === 0 || index === deduplicated.length - 1) return true;
    const previous = deduplicated[index - 1];
    const next = deduplicated[index + 1];
    const verticalMiddle = previous.x === point.x && point.x === next.x
      && (point.y - previous.y) * (next.y - point.y) >= 0;
    const horizontalMiddle = previous.y === point.y && point.y === next.y
      && (point.x - previous.x) * (next.x - point.x) >= 0;
    return !(verticalMiddle || horizontalMiddle);
  });
}

function segmentHitsObstacle(start: RoutePoint, end: RoutePoint, obstacle: RouteObstacle) {
  const left = obstacle.x;
  const right = obstacle.x + obstacle.width;
  const top = obstacle.y;
  const bottom = obstacle.y + obstacle.height;
  if (start.x === end.x) return start.x > left && start.x < right && Math.max(start.y, end.y) > top && Math.min(start.y, end.y) < bottom;
  if (start.y === end.y) return start.y > top && start.y < bottom && Math.max(start.x, end.x) > left && Math.min(start.x, end.x) < right;
  return true;
}

export function routeIntersectsObstacle(points: RoutePoint[], obstacles: RouteObstacle[]) {
  return points.slice(1).some((point, index) => obstacles.some((obstacle) => segmentHitsObstacle(points[index], point, obstacle)));
}

function routeLength(points: RoutePoint[]) {
  return points.slice(1).reduce((length, point, index) => length + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
}

function roundedPath(points: RoutePoint[], radius = 6) {
  if (points.length < 2) return `M ${points[0]?.x ?? 0} ${points[0]?.y ?? 0}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incoming = Math.abs(corner.x - previous.x) + Math.abs(corner.y - previous.y);
    const outgoing = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y);
    const bendRadius = Math.min(radius, incoming / 2, outgoing / 2);
    const before = {
      x: corner.x + Math.sign(previous.x - corner.x) * bendRadius,
      y: corner.y + Math.sign(previous.y - corner.y) * bendRadius,
    };
    const after = {
      x: corner.x + Math.sign(next.x - corner.x) * bendRadius,
      y: corner.y + Math.sign(next.y - corner.y) * bendRadius,
    };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const end = points[points.length - 1];
  return `${path} L ${end.x} ${end.y}`;
}

function midpoint(points: RoutePoint[]) {
  const total = routeLength(points);
  let remaining = total / 2;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (remaining <= length) {
      const ratio = length ? remaining / length : 0;
      return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
    }
    remaining -= length;
  }
  return points[Math.floor(points.length / 2)];
}

function routesThrough(points: RoutePoint[], waypoints: RoutePoint[]) {
  let candidates: RoutePoint[][] = [[points[0]]];
  for (const waypoint of [...waypoints, points[1]]) {
    candidates = candidates.flatMap((candidate) => {
      const current = candidate[candidate.length - 1];
      return [
        [...candidate, { x: waypoint.x, y: current.y }, waypoint],
        [...candidate, { x: current.x, y: waypoint.y }, waypoint],
      ];
    });
  }
  return candidates;
}

function editableControls(points: RoutePoint[]) {
  return points.slice(1).flatMap((end, index) => {
    const segmentIndex = index + 1;
    const start = points[segmentIndex - 1];
    const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (length < 8) return [];
    return [{
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      segmentIndex,
      orientation: start.y === end.y ? "horizontal" as const : "vertical" as const,
    }];
  });
}

function endpointDirectionsValid(points: RoutePoint[]) {
  if (points.length < 4) return true;
  const sourceDirection = { x: points[1].x - points[0].x, y: points[1].y - points[0].y };
  const sourceExit = { x: points[2].x - points[1].x, y: points[2].y - points[1].y };
  const targetEntry = { x: points[points.length - 1].x - points[points.length - 2].x, y: points[points.length - 1].y - points[points.length - 2].y };
  const targetApproach = { x: points[points.length - 2].x - points[points.length - 3].x, y: points[points.length - 2].y - points[points.length - 3].y };
  const sourceReverses = sourceDirection.x * sourceExit.x + sourceDirection.y * sourceExit.y < 0;
  const targetReverses = targetEntry.x * targetApproach.x + targetEntry.y * targetApproach.y < 0;
  return !sourceReverses && !targetReverses;
}

export function routeOrthogonal({ source, target, sourcePosition, targetPosition, obstacles, protectedObstacles = [], waypoint, waypoints, offset = 16, portLead: lead_ = 14 }: RouteInput) {
  const clearance = 8;
  const portLead = lead_;
  const expanded = obstacles.map((obstacle) => ({ x: obstacle.x - clearance, y: obstacle.y - clearance, width: obstacle.width + clearance * 2, height: obstacle.height + clearance * 2 }));
  const blocked = [...expanded, ...protectedObstacles];
  const start = lead(source, sourcePosition, portLead);
  const end = lead(target, targetPosition, portLead);
  const minX = Math.min(start.x, end.x, ...blocked.map((obstacle) => obstacle.x));
  const maxX = Math.max(start.x, end.x, ...blocked.map((obstacle) => obstacle.x + obstacle.width));
  const minY = Math.min(start.y, end.y, ...blocked.map((obstacle) => obstacle.y));
  const maxY = Math.max(start.y, end.y, ...blocked.map((obstacle) => obstacle.y + obstacle.height));
  const midX = (start.x + end.x) / 2 + offset;
  const midY = (start.y + end.y) / 2 + offset;
  const obstacleDetours = blocked.flatMap((obstacle) => {
    const left = obstacle.x - 12 - offset;
    const right = obstacle.x + obstacle.width + 12 + offset;
    const top = obstacle.y - 12 - offset;
    const bottom = obstacle.y + obstacle.height + 12 + offset;
    return [
      [start, { x: left, y: start.y }, { x: left, y: end.y }, end],
      [start, { x: right, y: start.y }, { x: right, y: end.y }, end],
      [start, { x: start.x, y: top }, { x: end.x, y: top }, end],
      [start, { x: start.x, y: bottom }, { x: end.x, y: bottom }, end],
    ];
  });
  const innerCandidates: RoutePoint[][] = [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
    [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end],
    [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end],
    [start, { x: start.x, y: minY - 24 - offset }, { x: end.x, y: minY - 24 - offset }, end],
    [start, { x: start.x, y: maxY + 24 + offset }, { x: end.x, y: maxY + 24 + offset }, end],
    [start, { x: minX - 24 - offset, y: start.y }, { x: minX - 24 - offset, y: end.y }, end],
    [start, { x: maxX + 24 + offset, y: start.y }, { x: maxX + 24 + offset, y: end.y }, end],
    ...obstacleDetours,
  ];
  const candidates = innerCandidates.map((candidate) => simplify([source, ...candidate, target]));
  const manualWaypoints = (waypoints?.length ? waypoints : waypoint ? [waypoint] : []).slice(0, 12);
  const manualCandidates = manualWaypoints.length
    ? routesThrough([start, end], manualWaypoints).map((candidate) => simplify([source, ...candidate, target]))
    : [];
  const validManual = manualCandidates.filter((candidate) => endpointDirectionsValid(candidate) && !routeIntersectsObstacle(candidate, blocked));
  const valid = candidates.filter((candidate) => endpointDirectionsValid(candidate) && !routeIntersectsObstacle(candidate, blocked));
  const routeScore = (left: RoutePoint[], right: RoutePoint[]) => (left.length - right.length) * 10000 + routeLength(left) - routeLength(right);
  const selected = validManual.length
    ? validManual.sort(routeScore)[0]
    : (valid.length ? valid : candidates).sort(routeScore)[0];
  const label = midpoint(selected);
  const controls = editableControls(selected);
  const control = controls[0] ?? label;
  return { path: roundedPath(selected), labelX: label.x, labelY: label.y, controlX: control.x, controlY: control.y, controls, points: selected };
}
