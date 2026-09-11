import type { DiagramDocument } from "@/modules/diagram/schema";

/**
 * How much of the drawing has two connectors running along the same line.
 *
 * Crossings and overlaps are different faults and only one of them was being
 * measured. Two connectors that cross make an X, which is readable; two that
 * share a stretch of the same horizontal or vertical lane look like one
 * connector, and there is no way to tell where either of them goes.
 *
 * Measured on the centre-to-centre segments rather than the routed path: this
 * is a property of where the boxes ended up, which is what the layout controls.
 */

type Segment = { id: string; from: string; to: string; x1: number; y1: number; x2: number; y2: number };

function segmentsOf(document: DiagramDocument): Segment[] {
  const centres = new Map(document.nodes.map((node) => [node.id, {
    x: node.position.x + node.size.width / 2,
    y: node.position.y + node.size.height / 2,
  }]));
  return document.edges
    .filter((edge) => edge.from !== edge.to && centres.has(edge.from) && centres.has(edge.to))
    .map((edge) => {
      const a = centres.get(edge.from)!;
      const b = centres.get(edge.to)!;
      return { id: edge.id, from: edge.from, to: edge.to, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });
}

const TOLERANCE = 6;

/** Length the two segments share while lying on the same line. */
function sharedLength(left: Segment, right: Segment) {
  const leftVertical = Math.abs(left.x1 - left.x2) <= TOLERANCE;
  const rightVertical = Math.abs(right.x1 - right.x2) <= TOLERANCE;
  const leftHorizontal = Math.abs(left.y1 - left.y2) <= TOLERANCE;
  const rightHorizontal = Math.abs(right.y1 - right.y2) <= TOLERANCE;

  if (leftVertical && rightVertical && Math.abs(left.x1 - right.x1) <= TOLERANCE) {
    const top = Math.max(Math.min(left.y1, left.y2), Math.min(right.y1, right.y2));
    const bottom = Math.min(Math.max(left.y1, left.y2), Math.max(right.y1, right.y2));
    return Math.max(0, bottom - top);
  }
  if (leftHorizontal && rightHorizontal && Math.abs(left.y1 - right.y1) <= TOLERANCE) {
    const start = Math.max(Math.min(left.x1, left.x2), Math.min(right.x1, right.x2));
    const end = Math.min(Math.max(left.x1, left.x2), Math.max(right.x1, right.x2));
    return Math.max(0, end - start);
  }
  return 0;
}

/** Pairs of connectors that run along each other for a visible distance. */
export function overlappingEdgePairs(document: DiagramDocument, minimum = 24) {
  const segments = segmentsOf(document);
  const pairs: Array<{ a: string; b: string; length: number }> = [];
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const left = segments[i];
      const right = segments[j];
      // Two connectors leaving the same box share their start by definition.
      if (left.from === right.from && left.to === right.to) continue;
      const length = sharedLength(left, right);
      if (length >= minimum) pairs.push({ a: left.id, b: right.id, length: Math.round(length) });
    }
  }
  return pairs;
}

export function countEdgeOverlaps(document: DiagramDocument, minimum = 24) {
  return overlappingEdgePairs(document, minimum).length;
}
