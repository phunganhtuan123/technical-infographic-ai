import type { DiagramEdge } from "@/modules/diagram/schema";

/**
 * Keeps connectors that share an anchor from being drawn as one line.
 *
 * Two connectors leaving the same box towards boxes on the same row start at
 * the same point and run along the same lane, so the router — which only sees
 * one connector at a time — cannot separate them. They have to be told apart
 * before it runs.
 *
 * Three things are varied, and all three are needed:
 *
 *   shift     where on the box's edge the connector attaches. Without it two
 *             connectors at the same height share a horizontal lane whatever
 *             else changes.
 *   lead      how far it runs straight before turning, so a fan-out separates
 *             beside the box rather than near its destination.
 *   detour    how wide it swings when it has to route around something.
 *
 * Source and target are counted separately. Spreading both ends of a connector
 * by the same amount moves its arrival onto a different connector — fixing one
 * overlap by creating another.
 */

export type EdgeLane = { shift: number; targetShift: number; lead: number; detour: number };

/** Furthest a connector may be moved along the side it leaves from. */
export const MAX_SHIFT = 22;
const STEP = 20;

/** Position within a group, centred on zero: one connector stays on the anchor. */
export function spreadAt(index: number, count: number) {
  if (count < 2) return 0;
  return Math.round(Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, (index - (count - 1) / 2) * STEP)));
}

export function edgeLanes(edges: Pick<DiagramEdge, "id" | "from" | "to" | "sourcePort" | "targetPort">[]) {
  // Seats at an anchor, counted per anchor rather than per direction.
  //
  // Leaving and arriving used to be counted in separate tallies, so two
  // connectors running between the same pair of boxes in opposite directions
  // each came out as the only one at its anchor, each took the centre, and they
  // were drawn exactly on top of each other. Whether a connector arrives or
  // departs makes no difference to the point it occupies.
  const seat = new Map<string, number>();
  const occupants = new Map<string, number>();
  const anchorOf = (node: string, port: string | undefined, fallback: string) => `${node}:${port ?? fallback}`;
  const take = (anchor: string, endpoint: string) => {
    seat.set(endpoint, occupants.get(anchor) ?? 0);
    occupants.set(anchor, (occupants.get(anchor) ?? 0) + 1);
  };

  for (const edge of edges) {
    take(anchorOf(edge.from, edge.sourcePort, "output"), `${edge.id}:out`);
    take(anchorOf(edge.to, edge.targetPort, "input"), `${edge.id}:in`);
  }

  const lanes = new Map<string, EdgeLane>();
  edges.forEach((edge, position) => {
    const out = anchorOf(edge.from, edge.sourcePort, "output");
    const into = anchorOf(edge.to, edge.targetPort, "input");
    const fan = seat.get(`${edge.id}:out`) ?? 0;
    lanes.set(edge.id, {
      shift: spreadAt(fan, occupants.get(out) ?? 1),
      targetShift: spreadAt(seat.get(`${edge.id}:in`) ?? 0, occupants.get(into) ?? 1),
      lead: 14 + fan * 18,
      detour: 16 + fan * 22 + (position % 3) * 5,
    });
  });
  return lanes;
}
