import { compilePlan } from "@/modules/compiler/compile-plan";
import type { DiagramDocument } from "@/modules/diagram/schema";
import { layoutDocument } from "@/modules/layout/layout-document";
import { diagramProposalSchema, type AiIntent, type DiagramPatch, type DiagramProposal } from "./contracts";

export function validateProposal(input: unknown, document: DiagramDocument, scope: { intent: AiIntent; nodeIds: string[]; edgeIds: string[] }) {
  const proposal = diagramProposalSchema.parse(input);
  if (proposal.intent !== scope.intent) throw new Error("Proposal intent does not match the request");
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  const edgeIds = new Set(document.edges.map((edge) => edge.id));
  const allowedNodes = new Set(scope.nodeIds);
  const allowedEdges = new Set(scope.edgeIds);
  for (const patch of proposal.patches) {
    if (patch.op === "replace-document" && scope.intent === "modify-selection") throw new Error("Selection requests cannot replace the document");
    if ((patch.op === "update-node" || patch.op === "delete-node") && (!nodeIds.has(patch.id) || (scope.intent === "modify-selection" && !allowedNodes.has(patch.id)))) throw new Error(`Node patch is outside scope: ${patch.id}`);
    if ((patch.op === "update-edge" || patch.op === "delete-edge") && (!edgeIds.has(patch.id) || (scope.intent === "modify-selection" && !allowedEdges.has(patch.id)))) throw new Error(`Edge patch is outside scope: ${patch.id}`);
  }
  return proposal;
}

function applyPatch(document: DiagramDocument, patch: DiagramPatch) {
  if (patch.op === "replace-document") return { ...compilePlan(patch.plan), format: document.format };
  if (patch.op === "update-node") return { ...document, nodes: document.nodes.map((node) => node.id === patch.id ? { ...node, ...patch.changes } : node) };
  if (patch.op === "update-edge") return { ...document, edges: document.edges.map((edge) => edge.id === patch.id ? { ...edge, ...patch.changes } : edge) };
  if (patch.op === "delete-edge") return { ...document, edges: document.edges.filter((edge) => edge.id !== patch.id) };
  return { ...document, nodes: document.nodes.filter((node) => node.id !== patch.id), edges: document.edges.filter((edge) => edge.from !== patch.id && edge.to !== patch.id) };
}

export async function buildProposalDocument(document: DiagramDocument, proposal: DiagramProposal) {
  let next = structuredClone(document);
  for (const patch of proposal.patches) next = applyPatch(next, patch);
  if (proposal.intent === "modify-selection") return next;
  return layoutDocument(next);
}

export function decorateProposalDocument(original: DiagramDocument, preview: DiagramDocument, proposal: DiagramProposal): DiagramDocument {
  const replaced = proposal.patches.some((patch) => patch.op === "replace-document");
  const nodeOperations = new Map(proposal.patches.flatMap((patch) => patch.op === "update-node" || patch.op === "delete-node" ? [[patch.id, patch.op]] : []));
  const edgeOperations = new Map(proposal.patches.flatMap((patch) => patch.op === "update-edge" || patch.op === "delete-edge" ? [[patch.id, patch.op]] : []));
  const originalNodeIds = new Set(original.nodes.map((node) => node.id));
  const originalEdgeIds = new Set(original.edges.map((edge) => edge.id));
  const previewNodeIds = new Set(preview.nodes.map((node) => node.id));
  const previewEdgeIds = new Set(preview.edges.map((edge) => edge.id));
  const nodes: DiagramDocument["nodes"] = preview.nodes.map((node) => ({ ...node, previewStatus: proposal.intent === "new-scene" || !originalNodeIds.has(node.id) ? "added" as const : replaced || nodeOperations.has(node.id) ? "modified" as const : undefined }));
  const edges: DiagramDocument["edges"] = preview.edges.map((edge) => ({ ...edge, previewStatus: proposal.intent === "new-scene" || !originalEdgeIds.has(edge.id) ? "added" as const : replaced || edgeOperations.has(edge.id) ? "modified" as const : undefined }));
  for (const node of original.nodes) if (!previewNodeIds.has(node.id)) nodes.push({ ...node, previewStatus: "deleted" });
  for (const edge of original.edges) if (!previewEdgeIds.has(edge.id)) edges.push({ ...edge, previewStatus: "deleted" });
  return { ...preview, nodes, edges };
}

export function createProposalRevealFrames(document: DiagramDocument, batchSize = 2) {
  const activeNodes = document.nodes.filter((node) => node.previewStatus !== "deleted");
  const activeNodeIds = new Set(activeNodes.map((node) => node.id));
  const activeEdges = document.edges.filter((edge) => edge.previewStatus !== "deleted" && activeNodeIds.has(edge.from) && activeNodeIds.has(edge.to));
  const frames: DiagramDocument[] = [];
  const size = Math.max(1, batchSize);
  for (let count = size; count < activeNodes.length; count += size) frames.push({ ...document, nodes: activeNodes.slice(0, count), edges: [] });
  frames.push({ ...document, nodes: activeNodes, edges: [] });
  for (let count = size; count < activeEdges.length; count += size) frames.push({ ...document, nodes: activeNodes, edges: activeEdges.slice(0, count) });
  frames.push(document);
  return frames;
}

export function proposalChangeCounts(proposal: DiagramProposal) {
  return proposal.patches.reduce((counts, patch) => {
    if (patch.op.startsWith("delete")) counts.deleted += 1;
    else if (patch.op === "replace-document") counts.added += patch.plan.nodes.length + patch.plan.edges.length;
    else counts.modified += 1;
    return counts;
  }, { added: 0, modified: 0, deleted: 0 });
}
