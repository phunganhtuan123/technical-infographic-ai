import type { DiagramDocument, DiagramEdge, DiagramFormat, DiagramNode } from "@/modules/diagram/schema";
import { MAX_NODE_WIDTH } from "@/modules/diagram/label-metrics";

const outerPadding = 80;
const horizontalGap = 80;
const verticalGap = 168;

type RowName = "main" | "async" | "data";

function rowFor(node: DiagramNode): RowName {
  if (node.lane === "async") return "async";
  if (node.lane === "data") return "data";
  return "main";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function balancedSize(node: DiagramNode) {
  if (node.role === "zone" || node.role === "group") return {
    width: clamp(node.size.width, 280, 1400),
    height: clamp(node.size.height, 160, 900),
  };
  return {
    width: Math.round(clamp(node.size.width, node.role === "connector" ? 96 : 140, MAX_NODE_WIDTH)),
    height: Math.round(clamp(node.size.height, 72, 260)),
  };
}

function canvasWidth(format: DiagramFormat = "16:9") {
  if (format === "full") return 1920;
  if (format === "9:16") return 900;
  if (format === "4:5") return 1080;
  if (format === "1:1") return 1280;
  return 1680;
}

function orderedNodes(document: DiagramDocument, nodes: DiagramNode[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const sourceOrder = new Map(document.nodes.map((node, index) => [node.id, index]));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of document.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || edge.semantics === "feedback") continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const bySourceOrder = (left: DiagramNode, right: DiagramNode) => (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0);
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).sort(bySourceOrder);
  const ordered: DiagramNode[] = [];
  while (ready.length) {
    const node = ready.shift()!;
    ordered.push(node);
    for (const target of outgoing.get(node.id) ?? []) {
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if (indegree.get(target) === 0) {
        ready.push(nodes.find((candidate) => candidate.id === target)!);
        ready.sort(bySourceOrder);
      }
    }
  }
  const seen = new Set(ordered.map((node) => node.id));
  return [...ordered, ...nodes.filter((node) => !seen.has(node.id)).sort(bySourceOrder)];
}

function rowWidth(nodes: DiagramNode[], gap = horizontalGap) {
  return nodes.reduce((sum, node) => sum + node.size.width, 0) + Math.max(0, nodes.length - 1) * gap;
}

function placeRow(nodes: DiagramNode[], y: number, width: number, gap = horizontalGap) {
  const positions = new Map<string, DiagramNode["position"]>();
  let x = Math.max(outerPadding, (width - rowWidth(nodes, gap)) / 2);
  for (const node of nodes) {
    positions.set(node.id, { x: Math.round(x), y: Math.round(y) });
    x += node.size.width + gap;
  }
  return positions;
}

function placeRowAvoidingColumns(nodes: DiagramNode[], y: number, width: number, blockedColumns: number[], gap = 64) {
  const positions = new Map<string, DiagramNode["position"]>();
  let x = Math.max(outerPadding, (width - rowWidth(nodes, gap)) / 2);
  for (const node of nodes) {
    let blocking = blockedColumns.find((column) => column > x - 32 && column < x + node.size.width + 32);
    while (blocking !== undefined) {
      x = blocking + 48;
      blocking = blockedColumns.find((column) => column > x - 32 && column < x + node.size.width + 32);
    }
    positions.set(node.id, { x: Math.round(x), y: Math.round(y) });
    x += node.size.width + gap;
  }
  return positions;
}

function overlaps(left: DiagramNode, leftPosition: DiagramNode["position"], right: DiagramNode, rightPosition: DiagramNode["position"], gap = 32) {
  return leftPosition.x < rightPosition.x + right.size.width + gap
    && leftPosition.x + left.size.width + gap > rightPosition.x
    && leftPosition.y < rightPosition.y + right.size.height + gap
    && leftPosition.y + left.size.height + gap > rightPosition.y;
}

function findOpenPosition(node: DiagramNode, preferred: DiagramNode["position"], placed: DiagramNode[], positions: Map<string, DiagramNode["position"]>) {
  let candidate = { ...preferred };
  while (placed.some((other) => overlaps(node, candidate, other, positions.get(other.id)!))) candidate = { x: candidate.x + node.size.width + 56, y: candidate.y };
  return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
}

/**
 * Which anchor each end of a connector should leave from and arrive at.
 *
 * The node carries three anchors on its top edge and three on its bottom, at
 * 34%, 50% and 66%, so several connectors can share a side without overlapping.
 * The assignment used to be by semantics alone: a data edge always left from
 * 66%, which meant the common case — one store below one service — drew a line
 * visibly off the centre of both boxes for no reason.
 *
 * The side is still chosen by geometry and the meaning of the edge, but the
 * offset anchors are only used when a side actually has more than one connector
 * to fit. Anything else meets the box in the middle.
 */
/**
 * Which anchor each end of a connector leaves from and arrives at.
 *
 * A node carries three anchors along its top edge and three along its bottom,
 * at 34%, 50% and 66%. Picking one by the edge's meaning was not enough: two
 * writes into the same table both resolved to the middle anchor and the last
 * 400px of the two connectors were drawn on top of each other, reading as one
 * line. They are handed out by position instead — the connectors sharing a side
 * are sorted by where their other end sits, then spread across the anchors, so
 * they arrive in the same order they leave and never share a lane.
 *
 * A side carrying one connector still meets the box in the middle.
 */
const DOWN_PORTS = ["event-input-bottom", "event-output", "data-output"] as const;
const UP_PORTS = ["event-input", "top-center", "data-input"] as const;

export type PortPlan = Map<string, { sourcePort: DiagramEdge["sourcePort"]; targetPort: DiagramEdge["targetPort"] }>;

function isDownward(source: DiagramNode, target: DiagramNode) {
  const dx = (target.position.x + target.size.width / 2) - (source.position.x + source.size.width / 2);
  const dy = (target.position.y + target.size.height / 2) - (source.position.y + source.size.height / 2);
  return Math.abs(dy) > Math.abs(dx) * 0.7 && dy > 0;
}

/** Spread `count` connectors across the three anchors, centred when there is one. */
function spread<T>(ports: readonly T[], index: number, count: number): T {
  if (count <= 1) return ports[1];
  if (count === 2) return index === 0 ? ports[0] : ports[2];
  return ports[Math.min(ports.length - 1, Math.round((index * (ports.length - 1)) / (count - 1)))];
}

export function planPorts(edges: DiagramEdge[], nodes: Map<string, DiagramNode>): PortPlan {
  const plan: PortPlan = new Map();
  const leaving = new Map<string, DiagramEdge[]>();
  const arriving = new Map<string, DiagramEdge[]>();

  for (const edge of edges) {
    const source = nodes.get(edge.from);
    const target = nodes.get(edge.to);
    if (!source || !target) continue;
    if (!isDownward(source, target)) {
      plan.set(edge.id, { sourcePort: "output", targetPort: "input" });
      continue;
    }
    leaving.set(edge.from, [...(leaving.get(edge.from) ?? []), edge]);
    arriving.set(edge.to, [...(arriving.get(edge.to) ?? []), edge]);
    plan.set(edge.id, { sourcePort: "event-output", targetPort: "top-center" });
  }

  const centreOf = (id: string) => {
    const node = nodes.get(id);
    return node ? node.position.x + node.size.width / 2 : 0;
  };

  for (const [id, group] of leaving) {
    const ordered = [...group].sort((a, b) => centreOf(a.to) - centreOf(b.to));
    ordered.forEach((edge, index) => {
      const current = plan.get(edge.id)!;
      plan.set(edge.id, { ...current, sourcePort: spread(DOWN_PORTS, index, ordered.length) });
    });
    void id;
  }

  for (const [id, group] of arriving) {
    const ordered = [...group].sort((a, b) => centreOf(a.from) - centreOf(b.from));
    ordered.forEach((edge, index) => {
      const current = plan.get(edge.id)!;
      plan.set(edge.id, { ...current, targetPort: spread(UP_PORTS, index, ordered.length) });
    });
    void id;
  }

  return plan;
}

function placeContainers(nodes: DiagramNode[], positions: Map<string, DiagramNode["position"]>) {
  const containers = nodes.filter((node) => node.role === "zone" || node.role === "group");
  for (const container of containers) {
    const children = nodes.filter((node) => node.containerId === container.id && positions.has(node.id));
    if (!children.length) {
      positions.set(container.id, container.position);
      continue;
    }
    const left = Math.min(...children.map((node) => positions.get(node.id)!.x)) - 40;
    const top = Math.min(...children.map((node) => positions.get(node.id)!.y)) - 48;
    const right = Math.max(...children.map((node) => positions.get(node.id)!.x + node.size.width)) + 40;
    const bottom = Math.max(...children.map((node) => positions.get(node.id)!.y + node.size.height)) + 40;
    container.size = { width: right - left, height: bottom - top };
    positions.set(container.id, { x: left, y: top });
  }
}

/**
 * Order a lane so its connectors cross as little as possible.
 *
 * This is the crossing-reduction step of a layered layout: a node is pulled to
 * the average horizontal position of the neighbours it is already tied to, so
 * a queue sits under the service that publishes to it instead of wherever the
 * topological sort happened to leave it. Nodes with no placed neighbour keep
 * their existing relative order rather than drifting to one end.
 */
function byBarycenter(
  lane: DiagramNode[],
  edges: DiagramEdge[],
  placed: Map<string, DiagramNode["position"]>,
  sizes: Map<string, DiagramNode>,
) {
  const anchorOf = (id: string) => {
    const position = placed.get(id);
    if (!position) return undefined;
    return position.x + (sizes.get(id)?.size.width ?? 220) / 2;
  };
  const centers = new Map<string, number>();
  lane.forEach((node, index) => {
    const anchors: number[] = [];
    for (const edge of edges) {
      if (edge.from === node.id) { const a = anchorOf(edge.to); if (a !== undefined) anchors.push(a); }
      else if (edge.to === node.id) { const a = anchorOf(edge.from); if (a !== undefined) anchors.push(a); }
    }
    // No anchor: keep the incoming order by parking it at its own index.
    centers.set(node.id, anchors.length
      ? anchors.reduce((sum, value) => sum + value, 0) / anchors.length
      : Number.MAX_SAFE_INTEGER - lane.length + index);
  });
  return [...lane].sort((left, right) => (centers.get(left.id) ?? 0) - (centers.get(right.id) ?? 0));
}

/**
 * How many pairs of connectors cross, measured centre-to-centre.
 *
 * An approximation — the real routes are orthogonal — but a faithful enough
 * proxy to hold the layout to account in a test, which is the point: "avoid
 * crossings" is only a rule if something can tell when it is broken.
 */
export function countEdgeCrossings(document: DiagramDocument) {
  const centers = new Map(document.nodes.map((node) => [node.id, {
    x: node.position.x + node.size.width / 2,
    y: node.position.y + node.size.height / 2,
  }]));
  const segments = document.edges
    .filter((edge) => edge.from !== edge.to && centers.has(edge.from) && centers.has(edge.to))
    .map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, a: centers.get(edge.from)!, b: centers.get(edge.to)! }));

  const side = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));

  let crossings = 0;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const left = segments[i];
      const right = segments[j];
      // Edges meeting at a shared node touch by definition; that is not a cross.
      if (left.from === right.from || left.from === right.to || left.to === right.from || left.to === right.to) continue;
      const d1 = side(left.a, left.b, right.a);
      const d2 = side(left.a, left.b, right.b);
      const d3 = side(right.a, right.b, left.a);
      const d4 = side(right.a, right.b, left.b);
      if (d1 !== d2 && d3 !== d4) crossings += 1;
    }
  }
  return crossings;
}

/**
 * Rank every node by how far it is from an entry point, ignoring feedback.
 *
 * Longest path rather than shortest: a node must sit below *every* step that
 * can reach it, or a join like "Kết thúc" would be pulled up level with the
 * first branch that arrives at it and the arrows would run backwards.
 */
function rankNodes(nodes: DiagramNode[], edges: DiagramEdge[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const forward = edges.filter((edge) =>
    ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to && edge.semantics !== "feedback");

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of forward) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const rank = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const pending = new Map(indegree);
  const seen: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    seen.push(id);
    for (const next of outgoing.get(id) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));
      pending.set(next, (pending.get(next) ?? 1) - 1);
      if (pending.get(next) === 0) queue.push(next);
    }
  }
  // A cycle the feedback filter did not break leaves nodes unvisited; place them
  // after everything that was ranked rather than dropping them on top of it.
  if (seen.length < nodes.length) {
    const maxRank = Math.max(0, ...rank.values());
    for (const node of nodes) if (!seen.includes(node.id)) rank.set(node.id, maxRank + 1);
  }
  return { rank, incoming };
}

/**
 * Top-to-bottom placement for a flowchart.
 *
 * The generic lane layout puts everything on one row, which is fine for five
 * boxes and useless for twenty: a procedure with nested decisions came out as a
 * single 5,700px strip. Here each rank is a row, and the order within a row is
 * refined by sweeping against parents and children until the crossings stop
 * falling.
 */
function placeFlowchart(nodes: DiagramNode[], edges: DiagramEdge[], width: number) {
  if (!nodes.length) return new Map<string, DiagramNode["position"]>();

  const ids = new Set(nodes.map((node) => node.id));
  const { rank } = rankNodes(nodes, edges);
  const forward = edges.filter((edge) =>
    ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to && edge.semantics !== "feedback");

  type Slot = { id: string; width: number; height: number; real: boolean };
  const rows = new Map<number, Slot[]>();
  const push = (level: number, slot: Slot) => rows.set(level, [...(rows.get(level) ?? []), slot]);
  for (const node of nodes) {
    push(rank.get(node.id) ?? 0, { id: node.id, width: node.size.width, height: node.size.height, real: true });
  }

  // An edge spanning more than one rank gets a placeholder on each rank it
  // passes through. Without them a long connector — "xuất kết quả" jumping
  // straight to "Kết thúc" — has no lane of its own and cuts across whatever
  // happens to sit between, which no amount of reordering the real nodes fixes.
  const chain = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    children.set(from, [...(children.get(from) ?? []), to]);
    parents.set(to, [...(parents.get(to) ?? []), from]);
  };
  for (const edge of forward) {
    const fromRank = rank.get(edge.from) ?? 0;
    const toRank = rank.get(edge.to) ?? 0;
    if (toRank - fromRank <= 1) { link(edge.from, edge.to); continue; }
    const hops: string[] = [];
    for (let level = fromRank + 1; level < toRank; level += 1) {
      const id = `__lane:${edge.id}:${level}`;
      hops.push(id);
      push(level, { id, width: 28, height: 1, real: false });
    }
    chain.set(edge.id, hops);
    let previous = edge.from;
    for (const hop of hops) { link(previous, hop); previous = hop; }
    link(previous, edge.to);
  }

  const levels = [...rows.keys()].sort((a, b) => a - b);
  const rowGap = 68;
  const columnGap = 56;

  const positionsFor = (ordering: Slot[][]) => {
    const positions = new Map<string, DiagramNode["position"]>();
    let y = outerPadding;
    for (const row of ordering) {
      const total = row.reduce((sum, slot) => sum + slot.width, 0) + Math.max(0, row.length - 1) * columnGap;
      let x = Math.max(outerPadding, (width - total) / 2);
      for (const slot of row) {
        positions.set(slot.id, { x: Math.round(x), y: Math.round(y) });
        x += slot.width + columnGap;
      }
      y += Math.max(...row.map((slot) => slot.height)) + rowGap;
    }
    return positions;
  };

  const realPositions = (ordering: Slot[][]) => {
    const all = positionsFor(ordering);
    const kept = new Map<string, DiagramNode["position"]>();
    for (const node of nodes) {
      const position = all.get(node.id);
      if (position) kept.set(node.id, position);
    }
    return kept;
  };

  const score = (ordering: Slot[][]) => {
    const placed = realPositions(ordering);
    return countEdgeCrossings({
      nodes: nodes.map((node) => ({ ...node, position: placed.get(node.id) ?? node.position })),
      edges,
    } as DiagramDocument);
  };

  const byNeighbours = (row: Slot[], reference: Slot[], related: Map<string, string[]>) => {
    const index = new Map(reference.map((slot, position) => [slot.id, position]));
    const centre = new Map<string, number>();
    row.forEach((slot, position) => {
      const anchors = (related.get(slot.id) ?? [])
        .map((id) => index.get(id))
        .filter((value): value is number => value !== undefined);
      centre.set(slot.id, anchors.length ? anchors.reduce((sum, value) => sum + value, 0) / anchors.length : position);
    });
    return [...row].sort((left, right) => (centre.get(left.id) ?? 0) - (centre.get(right.id) ?? 0));
  };

  let working = levels.map((level) => [...rows.get(level)!]);
  let best = working.map((row) => [...row]);
  let bestScore = score(best);

  // Sweep down against parents, then up against children, keeping whichever
  // pass crosses least. One direction alone leaves avoidable crossings.
  for (let sweep = 0; sweep < 6 && bestScore > 0; sweep += 1) {
    for (let level = 1; level < working.length; level += 1) working[level] = byNeighbours(working[level], working[level - 1], parents);
    for (let level = working.length - 2; level >= 0; level -= 1) working[level] = byNeighbours(working[level], working[level + 1], children);
    const current = score(working);
    if (current < bestScore) {
      bestScore = current;
      best = working.map((row) => [...row]);
    }
  }

  return realPositions(best);
}

/**
 * Slide a box sideways until it stops sitting on a vertical connector lane.
 *
 * Async nodes are placed under whatever they connect to, which is what keeps
 * their connectors short — but a queue parked directly over the line from a
 * service to its store forces that line to detour around the box. Nudging to
 * whichever side is nearer keeps both properties.
 */
function clearOfColumns(x: number, boxWidth: number, columns: number[], clearance = 28) {
  const blocking = () => columns.find((column) => column > x - clearance && column < x + boxWidth + clearance);
  let guard = 0;
  let hit = blocking();
  while (hit !== undefined && guard < 24) {
    const left = hit - clearance - boxWidth;
    const right = hit + clearance;
    x = Math.abs(left - x) <= Math.abs(right - x) ? left : right;
    hit = blocking();
    guard += 1;
  }
  return x;
}

export async function layoutDocument(document: DiagramDocument): Promise<DiagramDocument> {
  const normalizedNodes = document.nodes.map((node) => ({ ...node, size: balancedSize(node) }));
  const ordinary = normalizedNodes.filter((node) => !node.containerId && node.role !== "zone" && node.role !== "group");
  const width = canvasWidth(document.format);
  const positions = new Map<string, DiagramNode["position"]>();
  const portrait = document.format === "4:5" || document.format === "9:16";

  if (document.mode === "flow") {
    // A flowchart reads downward. Everything else keeps the lane layout.
    for (const [id, position] of placeFlowchart(ordinary, document.edges, width)) positions.set(id, position);
  } else if (document.mode === "explainer-grid") {
    const columns = portrait ? 2 : 3;
    const gapX = 72;
    const gapY = 64;
    const cardWidth = Math.max(...ordinary.map((node) => node.size.width), 220);
    const gridWidth = columns * cardWidth + (columns - 1) * gapX;
    const startX = Math.max(outerPadding, (width - gridWidth) / 2);
    ordinary.forEach((node, index) => positions.set(node.id, {
      x: Math.round(startX + (index % columns) * (cardWidth + gapX)),
      y: Math.round(120 + Math.floor(index / columns) * (node.size.height + gapY)),
    }));
  } else if (document.mode === "comparison") {
    const left = ordinary.filter((node) => rowFor(node) !== "async");
    const right = ordinary.filter((node) => rowFor(node) === "async");
    const placeColumn = (column: DiagramNode[], centerX: number) => column.forEach((node, index) => positions.set(node.id, {
      x: Math.round(centerX - node.size.width / 2),
      y: Math.round(120 + index * (node.size.height + 72)),
    }));
    placeColumn(left, width * 0.3);
    placeColumn(right, width * 0.7);
  } else if (portrait) {
    const ordered = orderedNodes(document, ordinary);
    let y = outerPadding;
    for (const node of ordered) {
      const laneOffset = rowFor(node) === "async" ? 140 : rowFor(node) === "data" ? -140 : 0;
      positions.set(node.id, { x: Math.round((width - node.size.width) / 2 + laneOffset), y });
      y += node.size.height + 72;
    }
  } else {
    const sizeOf = new Map(normalizedNodes.map((node) => [node.id, node]));
    const mainNodes = ordinary.filter((node) => rowFor(node) === "main");
    // Several callers into the same system belong in a column beside it, not
    // strung out in the row ahead of it. Laid out in a line, the first caller's
    // connector has to detour around every caller between it and the entry
    // point — which is what put two long parallel lines across the top of the
    // diagram. One caller is left where it is; a line of one has nothing to
    // route around.
    const callers = mainNodes.filter((node) => node.lane === "entry");
    const stackCallers = callers.length > 1;
    const mainOrder = orderedNodes(document, stackCallers ? mainNodes.filter((node) => node.lane !== "entry") : mainNodes);
    const asyncOrder = orderedNodes(document, ordinary.filter((node) => rowFor(node) === "async"));
    const dataOrder = orderedNodes(document, ordinary.filter((node) => rowFor(node) === "data"));
    const mainY = 120;
    const asyncY = mainY + Math.max(104, ...mainOrder.map((node) => node.size.height)) + verticalGap;
    const dataY = asyncY + Math.max(104, ...asyncOrder.map((node) => node.size.height)) + verticalGap;

    /** Place all three lanes for a given main-row order. */
    const callerColumnWidth = stackCallers
      ? Math.max(...callers.map((node) => node.size.width)) + horizontalGap
      : 0;

    const placeLanes = (main: DiagramNode[], avoidLanes: boolean) => {
      const placed = new Map<string, DiagramNode["position"]>();
      for (const [id, position] of placeRow(main, mainY, width - callerColumnWidth)) {
        placed.set(id, { x: position.x + callerColumnWidth, y: position.y });
      }

      if (stackCallers) {
        // Centred on the row they feed, so the fan-in is symmetrical.
        const rowHeight = Math.max(104, ...main.map((node) => node.size.height));
        const stackHeight = callers.reduce((sum, node) => sum + node.size.height, 0)
          + Math.max(0, callers.length - 1) * 28;
        let y = mainY + rowHeight / 2 - stackHeight / 2;
        for (const caller of callers) {
          placed.set(caller.id, { x: outerPadding, y: Math.round(y) });
          y += caller.size.height + 28;
        }
      }
      // The main row is fixed, so the lanes below it can be ordered by who they
      // actually connect to instead of by topological accident.
      const asyncNodes = byBarycenter(asyncOrder, document.edges, placed, sizeOf);
      // Ordering the lane is not enough on its own: spreading it evenly across
      // the row still drags a queue to the far side of the service that feeds
      // it, and every connector in between gets crossed. Each node is placed
      // under what it connects to, then pushed aside only where they collide.
      const placedAsync: DiagramNode[] = [];
      for (const node of asyncNodes) {
        const neighbours = document.edges
          .filter((edge) => (edge.from === node.id || edge.to === node.id))
          .map((edge) => (edge.from === node.id ? edge.to : edge.from))
          .map((id) => {
            const position = placed.get(id);
            return position ? position.x + (sizeOf.get(id)?.size.width ?? 220) / 2 : undefined;
          })
          .filter((value): value is number => value !== undefined);
        const centre = neighbours.length
          ? neighbours.reduce((sum, value) => sum + value, 0) / neighbours.length
          : width / 2;
        const lanes = document.edges
          .filter((edge) => edge.semantics === "data" && placed.has(edge.from))
          .map((edge) => placed.get(edge.from)!.x + (sizeOf.get(edge.from)?.size.width ?? 220) / 2);
        const wanted = centre - node.size.width / 2;
        const nudged = avoidLanes ? clearOfColumns(wanted, node.size.width, lanes) : wanted;
        const preferred = { x: Math.max(outerPadding, nudged), y: asyncY };
        placed.set(node.id, findOpenPosition(node, preferred, placedAsync, placed));
        placedAsync.push(node);
      }

      const dataNodes = byBarycenter(dataOrder, document.edges, placed, sizeOf);
      const placedData: DiagramNode[] = [];
      for (const node of dataNodes) {
        const ownerEdge = document.edges.find((edge) => edge.to === node.id && edge.semantics === "data" && placed.has(edge.from));
        const owner = ownerEdge ? sizeOf.get(ownerEdge.from) : undefined;
        const ownerPosition = owner ? placed.get(owner.id) : undefined;
        const preferred = owner && ownerPosition
          ? { x: ownerPosition.x + (owner.size.width - node.size.width) / 2, y: dataY }
          : { x: outerPadding, y: dataY };
        placed.set(node.id, findOpenPosition(node, preferred, placedData, placed));
        placedData.push(node);
      }
      return placed;
    };

    /**
     * How bad an arrangement is.
     *
     * Crossings alone are not the whole story: a box parked on top of a
     * vertical connector scores zero crossings while forcing that connector to
     * detour around it, which reads no better. Both are counted so the two
     * placements can be compared on the same scale.
     */
    const penaltyOf = (placed: Map<string, DiagramNode["position"]>) => {
      const laidOut = normalizedNodes.map((node) => ({ ...node, position: placed.get(node.id) ?? node.position }));
      const crossings = countEdgeCrossings({ nodes: laidOut, edges: document.edges } as DiagramDocument);
      const byId = new Map(laidOut.map((node) => [node.id, node]));
      let blocked = 0;
      for (const edge of document.edges) {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) continue;
        const lane = from.position.x + from.size.width / 2;
        const top = Math.min(from.position.y, to.position.y);
        const bottom = Math.max(from.position.y + from.size.height, to.position.y + to.size.height);
        if (Math.abs(lane - (to.position.x + to.size.width / 2)) > 24) continue;
        for (const node of laidOut) {
          if (node.id === edge.from || node.id === edge.to) continue;
          const spansLane = node.position.x < lane && node.position.x + node.size.width > lane;
          const spansGap = node.position.y > top && node.position.y + node.size.height < bottom;
          if (spansLane && spansGap) blocked += 1;
        }
      }
      return crossings * 2 + blocked;
    };

    // Try the topological order both ways — nodes free to sit under what they
    // connect to, and nudged clear of the vertical lanes — then a few orders
    // nudged by the main row, keeping whichever scores lowest overall.
    let best = placeLanes(mainOrder, true);
    let bestPenalty = penaltyOf(best);
    for (const avoid of [false, true]) {
      let candidate = mainOrder;
      for (let sweep = 0; sweep < 4 && bestPenalty > 0; sweep += 1) {
        const placed = placeLanes(candidate, avoid);
        const penalty = penaltyOf(placed);
        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          best = placed;
        }
        candidate = byBarycenter(candidate, document.edges, placed, sizeOf);
      }
    }
    for (const [id, position] of best) positions.set(id, position);
  }

  placeContainers(normalizedNodes, positions);
  const nodes = normalizedNodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const ports = planPorts(document.edges, nodeMap);
  const edges = document.edges.map((edge) => ({
    ...edge,
    ...(ports.get(edge.id) ?? { sourcePort: edge.sourcePort, targetPort: edge.targetPort }),
    routeWaypoints: undefined,
    routeWaypoint: undefined,
  }));
  return { ...document, nodes, edges };
}
