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
  const outIndex = new Map<string, number>();
  const outTotal = new Map<string, number>();
  const inIndex = new Map<string, number>();
  const inTotal = new Map<string, number>();

  for (const edge of edges) {
    const out = `${edge.from}:${edge.sourcePort ?? "output"}`;
    outIndex.set(edge.id, outTotal.get(out) ?? 0);
    outTotal.set(out, (outTotal.get(out) ?? 0) + 1);

    const into = `${edge.to}:${edge.targetPort ?? "input"}`;
    inIndex.set(edge.id, inTotal.get(into) ?? 0);
    inTotal.set(into, (inTotal.get(into) ?? 0) + 1);
  }

  const lanes = new Map<string, EdgeLane>();
  edges.forEach((edge, position) => {
    const out = `${edge.from}:${edge.sourcePort ?? "output"}`;
    const into = `${edge.to}:${edge.targetPort ?? "input"}`;
    const fan = outIndex.get(edge.id) ?? 0;
    lanes.set(edge.id, {
      shift: spreadAt(fan, outTotal.get(out) ?? 1),
      targetShift: spreadAt(inIndex.get(edge.id) ?? 0, inTotal.get(into) ?? 1),
      lead: 14 + fan * 18,
      detour: 16 + fan * 22 + (position % 3) * 5,
    });
  });
  return lanes;
}
