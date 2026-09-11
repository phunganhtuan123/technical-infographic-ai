import type { DiagramDocument } from "@/modules/diagram/schema";

/**
 * The order a diagram is walked through when it plays.
 *
 * Each step lights one node and the connectors that carried you into it, so a
 * viewer follows the path rather than being handed the whole picture at once.
 * The order is the diagram's own: entry points first, then anything reachable,
 * and a node is never reached before everything feeding it has been — otherwise
 * a join lights up before its branches and the story runs backwards.
 *
 * Cycles are expected. A feedback edge closing a loop does not hold its target
 * back; the loop is simply walked once, in the order it was written.
 */

export type TraceStep = {
  /** The node this step arrives at. */
  node: string;
  /** Connectors travelled to get here — highlighted with the node. */
  edges: string[];
};

export function traceSteps(document: DiagramDocument): TraceStep[] {
  const nodes = document.nodes.filter((node) => node.role !== "zone" && node.role !== "group");
  if (!nodes.length) return [];
  const ids = new Set(nodes.map((node) => node.id));

  const edges = document.edges.filter((edge) =>
    ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, { to: string; edge: string }[]>();
  for (const edge of edges) {
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), { to: edge.to, edge: edge.id }]);
  }

  // Written order breaks every tie, so the same diagram always plays the same.
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const byOrder = (left: string, right: string) => (order.get(left) ?? 0) - (order.get(right) ?? 0);

  const roots = nodes
    .filter((node) => !(incoming.get(node.id)?.length) || node.role === "start" || node.lane === "entry")
    .map((node) => node.id)
    .sort(byOrder);

  const queue = roots.length ? [...new Set(roots)] : [nodes[0].id];
  const visited = new Set<string>();
  const steps: TraceStep[] = [];

  const arrivalsInto = (id: string) => edges.filter((edge) => edge.to === id && visited.has(edge.from)).map((edge) => edge.id);

  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;

    // Wait for the rest of a join, unless waiting would deadlock on a cycle.
    const feeders = incoming.get(id) ?? [];
    const pending = feeders.filter((feeder) => !visited.has(feeder));
    if (pending.length && queue.some((candidate) => !visited.has(candidate))) {
      const reachableLater = pending.some((feeder) => queue.includes(feeder));
      if (reachableLater) { queue.push(id); continue; }
    }

    visited.add(id);
    steps.push({ node: id, edges: arrivalsInto(id) });

    for (const next of (outgoing.get(id) ?? []).map((link) => link.to).sort(byOrder)) {
      if (!visited.has(next) && !queue.includes(next)) queue.push(next);
    }

    // Anything unreachable still gets its turn rather than being dropped.
    if (!queue.length) {
      const orphan = nodes.map((node) => node.id).filter((candidate) => !visited.has(candidate)).sort(byOrder)[0];
      if (orphan) queue.push(orphan);
    }
  }

  return steps;
}

/** What is lit at a given point in the walk. */
export function traceStateAt(steps: TraceStep[], index: number) {
  const done = new Set<string>();
  const doneEdges = new Set<string>();
  const clamped = Math.max(-1, Math.min(index, steps.length - 1));

  for (let at = 0; at < clamped; at += 1) {
    done.add(steps[at].node);
    for (const edge of steps[at].edges) doneEdges.add(edge);
  }

  const current = clamped >= 0 ? steps[clamped] : undefined;
  return {
    index: clamped,
    done,
    doneEdges,
    activeNode: current?.node,
    activeEdges: new Set(current?.edges ?? []),
    finished: clamped >= steps.length - 1,
  };
}
