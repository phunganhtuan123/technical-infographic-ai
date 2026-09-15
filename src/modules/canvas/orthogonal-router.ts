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
  /**
   * Corridor this connector was given by the lane plan.
   *
   * `laneY` is the horizontal channel it should run along in the gap between
   * two rows; `laneX` the vertical channel in the margin beside the drawing.
   * They are worked out once for every connector together, because a router
   * that sees one connector at a time cannot tell that the lane it just picked
   * is the one the previous connector is already on.
   */
  laneY?: number;
  laneX?: number;
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

/** How many box crossings a route makes, so the least bad one can still win. */
function obstacleHits(points: RoutePoint[], obstacles: RouteObstacle[]) {
  return points.slice(1).reduce((count, point, index) =>
    count + obstacles.filter((obstacle) => segmentHitsObstacle(points[index], point, obstacle)).length, 0);
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

export function routeOrthogonal({ source, target, sourcePosition, targetPosition, obstacles, protectedObstacles = [], waypoint, waypoints, offset = 16, portLead: lead_ = 14, laneY, laneX }: RouteInput) {
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

  /**
   * The corridors this connector was told to use.
   *
   * Kept apart from the generic candidates so they can be given a discount:
   * a lane route is worth a couple of extra bends, because the bends are the
   * price of not being drawn on top of the connector next to it.
   */
  const laneCandidates: RoutePoint[][] = [];
  const laneFallbacks: RoutePoint[][] = [];
  const alongY = (y: number) => [start, { x: start.x, y }, { x: end.x, y }, end];
  const alongX = (x: number) => [start, { x, y: start.y }, { x, y: end.y }, end];
  if (laneY !== undefined && laneX !== undefined) {
    // Down into the channel, out to the margin, past the rows, then back in.
    // The long way round is the only way that crosses nothing — and both turns
    // happen on assigned lines, so no part of it is shared with a neighbour.
    //
    // Both corridors together mean a connector climbing back up the drawing:
    // the lane plan hands a margin to nothing else. So the discount belongs
    // here rather than being shared with the channel-only route — the margin is
    // what keeps three return lines off each other, and a cheaper route that
    // turns beside the boxes puts them back on one line.
    laneCandidates.push([start, { x: start.x, y: laneY }, { x: laneX, y: laneY }, { x: laneX, y: end.y }, end]);
    // Turning at the anchor instead is shorter, but the turn is then on a line
    // nothing assigned — which is how two connectors end up sharing it. Kept as
    // a candidate, without the discount.
    laneFallbacks.push(alongX(laneX), alongY(laneY));
  } else if (laneY !== undefined) {
    laneCandidates.push(alongY(laneY));
  } else if (laneX !== undefined) {
    laneCandidates.push(alongX(laneX));
  }

  const candidates = [...laneCandidates, ...laneFallbacks, ...innerCandidates].map((candidate) => simplify([source, ...candidate, target]));
  const laneCount = laneCandidates.length;
  const manualWaypoints = (waypoints?.length ? waypoints : waypoint ? [waypoint] : []).slice(0, 12);
  const manualCandidates = manualWaypoints.length
    ? routesThrough([start, end], manualWaypoints).map((candidate) => simplify([source, ...candidate, target]))
    : [];
  const validManual = manualCandidates.filter((candidate) => endpointDirectionsValid(candidate) && !routeIntersectsObstacle(candidate, blocked));

  /**
   * What a route costs, so the least bad one wins when none is clean.
   *
   * Filtering the invalid routes out and falling back to the shortest of
   * everything is what drew a connector straight through a box: once no
   * candidate was clean, the fallback ignored the boxes entirely. Scoring keeps
   * a route that clips one box ahead of one that clips three.
   */
  const LANE_DISCOUNT = 30000;
  const cost = (points: RoutePoint[], index: number) =>
    obstacleHits(points, blocked) * 250000
    + (endpointDirectionsValid(points) ? 0 : 120000)
    + points.length * 10000
    + routeLength(points)
    - (index < laneCount ? LANE_DISCOUNT : 0);

  const scored = candidates.map((points, index) => ({ points, cost: cost(points, index) }));
  const routeScore = (left: RoutePoint[], right: RoutePoint[]) => (left.length - right.length) * 10000 + routeLength(left) - routeLength(right);
  const selected = validManual.length
    ? validManual.sort(routeScore)[0]
    : scored.sort((left, right) => left.cost - right.cost)[0].points;
  const label = midpoint(selected);
  const controls = editableControls(selected);
  const control = controls[0] ?? label;
  return { path: roundedPath(selected), labelX: label.x, labelY: label.y, controlX: control.x, controlY: control.y, controls, points: selected };
}
