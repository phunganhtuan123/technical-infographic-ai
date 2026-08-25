import type { DiagramDocument } from "@/modules/diagram/schema";

export function scopedDiagramContext(document: DiagramDocument, nodeIds: string[], edgeIds: string[]) {
  if (!nodeIds.length && !edgeIds.length) return { id: document.id, title: document.title, purpose: document.purpose, mode: document.mode, format: document.format, theme: document.theme, nodes: document.nodes, edges: document.edges };
  const selectedNodes = new Set(nodeIds);
  const selectedEdges = new Set(edgeIds);
  const relatedEdges = document.edges.filter((edge) => selectedEdges.has(edge.id) || selectedNodes.has(edge.from) || selectedNodes.has(edge.to));
  const relatedNodes = new Set([...selectedNodes, ...relatedEdges.flatMap((edge) => [edge.from, edge.to])]);
  for (const node of document.nodes) {
    if ((node.role === "zone" || node.role === "group") && selectedNodes.has(node.id)) document.nodes.filter((child) => child.containerId === node.id).forEach((child) => relatedNodes.add(child.id));
  }
  return {
    id: document.id,
    title: document.title,
    purpose: document.purpose,
    mode: document.mode,
    selectedNodeIds: nodeIds,
    selectedEdgeIds: edgeIds,
    nodes: document.nodes.filter((node) => relatedNodes.has(node.id)),
    edges: relatedEdges,
  };
}

export function sceneFingerprint(document: DiagramDocument, nodeIds: string[], edgeIds: string[]) {
  return JSON.stringify(scopedDiagramContext(document, nodeIds, edgeIds));
}
