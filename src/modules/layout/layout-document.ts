import type { DiagramDocument, DiagramEdge, DiagramFormat, DiagramNode } from "@/modules/diagram/schema";

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
    width: Math.round(clamp(node.size.width, node.role === "connector" ? 96 : 140, 440)),
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

function portsFor(edge: DiagramEdge, nodes: Map<string, DiagramNode>): Pick<DiagramEdge, "sourcePort" | "targetPort"> {
  const source = nodes.get(edge.from);
  const target = nodes.get(edge.to);
  if (!source || !target) return { sourcePort: edge.sourcePort, targetPort: edge.targetPort };
  const sourceCenter = { x: source.position.x + source.size.width / 2, y: source.position.y + source.size.height / 2 };
  const targetCenter = { x: target.position.x + target.size.width / 2, y: target.position.y + target.size.height / 2 };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  if (Math.abs(dy) > Math.abs(dx) * 0.7) {
    if (dy > 0) return edge.semantics === "data"
      ? { sourcePort: "data-output", targetPort: "data-input" }
      : { sourcePort: "event-output", targetPort: "top-center" };
    return { sourcePort: "output", targetPort: "input" };
  }
  return { sourcePort: "output", targetPort: "input" };
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

export async function layoutDocument(document: DiagramDocument): Promise<DiagramDocument> {
  const normalizedNodes = document.nodes.map((node) => ({ ...node, size: balancedSize(node) }));
  const ordinary = normalizedNodes.filter((node) => !node.containerId && node.role !== "zone" && node.role !== "group");
  const width = canvasWidth(document.format);
  const positions = new Map<string, DiagramNode["position"]>();
  const portrait = document.format === "4:5" || document.format === "9:16";

  if (document.mode === "explainer-grid") {
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
    const main = orderedNodes(document, ordinary.filter((node) => rowFor(node) === "main"));
    const asyncNodes = orderedNodes(document, ordinary.filter((node) => rowFor(node) === "async"));
    const dataNodes = orderedNodes(document, ordinary.filter((node) => rowFor(node) === "data"));
    const mainY = 120;
    const asyncY = mainY + Math.max(104, ...main.map((node) => node.size.height)) + verticalGap;
    const dataY = asyncY + Math.max(104, ...asyncNodes.map((node) => node.size.height)) + verticalGap;
    for (const [id, position] of placeRow(main, mainY, width)) positions.set(id, position);
    const dataColumns = document.edges.filter((edge) => edge.semantics === "data" && positions.has(edge.from)).map((edge) => {
      const source = normalizedNodes.find((node) => node.id === edge.from)!;
      return positions.get(edge.from)!.x + source.size.width / 2;
    });
    for (const [id, position] of placeRowAvoidingColumns(asyncNodes, asyncY, width, dataColumns)) positions.set(id, position);

    const placedData: DiagramNode[] = [];
    for (const node of dataNodes) {
      const ownerEdge = document.edges.find((edge) => edge.to === node.id && edge.semantics === "data" && positions.has(edge.from));
      const owner = ownerEdge ? normalizedNodes.find((candidate) => candidate.id === ownerEdge.from) : undefined;
      const ownerPosition = owner ? positions.get(owner.id) : undefined;
      const preferred = owner && ownerPosition
        ? { x: ownerPosition.x + (owner.size.width - node.size.width) / 2, y: dataY }
        : { x: outerPadding, y: dataY };
      positions.set(node.id, findOpenPosition(node, preferred, placedData, positions));
      placedData.push(node);
    }
  }

  placeContainers(normalizedNodes, positions);
  const nodes = normalizedNodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = document.edges.map((edge) => ({
    ...edge,
    ...portsFor(edge, nodeMap),
    routeWaypoints: undefined,
    routeWaypoint: undefined,
  }));
  return { ...document, nodes, edges };
}
