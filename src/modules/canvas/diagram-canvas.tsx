"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  ConnectionLineType,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  reconnectEdge,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import {
  createDiagramNode,
  findAvailablePosition,
  primitiveDefinitions,
  type PrimitiveDefinition,
} from "@/modules/diagram/factory";
import type { DiagramDocument, DiagramEdge, DiagramNode, EdgeDirection, EdgeSemantics } from "@/modules/diagram/schema";
import { exportBounds } from "@/modules/diagram/bounds";
import { layoutDocument } from "@/modules/layout/layout-document";
import { EdgeCaptionEditContext, EdgeLabelMoveContext, EdgeRouteMoveContext, SemanticEdge, edgeCaptionEditEvent, type SemanticFlowEdge } from "./semantic-edge";
import { ContainerLabelMoveContext, NodeInlineEditContext, SemanticNode, type SemanticFlowNode } from "./semantic-node";

export const primitiveDragType = "application/technical-infographic-primitive";

export type DiagramCanvasHandle = {
  arrange: () => Promise<void>;
  insertPrimitive: (primitive: PrimitiveDefinition) => void;
  updateNodes: (nodeIds: string[], updates: Partial<Pick<DiagramNode, "label" | "detail" | "caption" | "note" | "role" | "lane" | "color" | "textColor" | "fontFamily" | "fontSize" | "fontWeight" | "textAlign" | "technology" | "provider" | "borderStyle" | "borderWidth" | "effect" | "speed" | "size" | "backgroundImage" | "backgroundOpacity" | "backgroundFit" | "zIndex">>) => void;
  updateEdges: (edgeIds: string[], updates: Partial<Pick<DiagramEdge, "label" | "semantics" | "direction" | "thickness" | "animated" | "color" | "strokeStyle" | "effect" | "speed">> & { routeWaypoints?: DiagramEdge["routeWaypoints"] | null; routeWaypoint?: DiagramEdge["routeWaypoint"] | null }) => void;
  deleteSelection: (nodeIds: string[], edgeIds: string[]) => void;
  groupSelection: (nodeIds: string[]) => void;
  ungroupSelection: (nodeIds: string[]) => void;
  // Reachable from the menu bar as well as from the canvas toolbar.
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  fitToView: () => void;
};

type DiagramCanvasProps = {
  document: DiagramDocument;
  externalRevision?: number;
  onDocumentChange: (document: DiagramDocument) => void;
  onSelectionChange?: (selection: { nodeIds: string[]; edgeIds: string[] }) => void;
  readOnly?: boolean;
};

const nodeTypes = { semantic: SemanticNode };
const edgeTypes = { semantic: SemanticEdge };
const portIds = new Set<DiagramEdge["sourcePort"]>(["input", "output", "top-center", "event-input", "event-input-bottom", "event-output", "data-input", "data-output"]);

export function logicalPortId(handleId: string | null | undefined, fallback: DiagramEdge["sourcePort"]): DiagramEdge["sourcePort"] {
  const logical = handleId?.replace(/--(?:source|target)$/, "") as DiagramEdge["sourcePort"] | undefined;
  return logical && portIds.has(logical) ? logical : fallback;
}

export function sourceHandleId(port: DiagramEdge["sourcePort"]) {
  return `${port}--source`;
}

export function targetHandleId(port: DiagramEdge["targetPort"]) {
  return `${port}--target`;
}

function normalizeConnection(connection: Connection): Connection {
  const sourcePort = logicalPortId(connection.sourceHandle, "output");
  const targetPort = logicalPortId(connection.targetHandle, "input");
  return {
    ...connection,
    sourceHandle: sourceHandleId(sourcePort),
    targetHandle: targetHandleId(targetPort),
  };
}

// Undo history. Every structural change funnels through replaceCanvas, so one
// snapshot taken there covers the whole editor. Changes that land within the
// merge window collapse into a single step — typing a name in the Inspector
// fires per keystroke and should undo as one edit, not thirty.
const historyLimit = 50;
const historyMergeWindow = 400;
type CanvasSnapshot = { nodes: SemanticFlowNode[]; edges: SemanticFlowEdge[] };

type AlignmentGuides = { x?: number; y?: number; label: string };
type CanvasContextMenu = { x: number; y: number; flowPosition: { x: number; y: number } };

function isContainerNode(node: SemanticFlowNode) {
  return node.data.role === "zone" || node.data.role === "group";
}

function nodeZIndex(node: DiagramNode) {
  if (typeof node.zIndex === "number") return node.zIndex;
  if (node.role === "zone") return -2;
  if (node.role === "group") return -1;
  return 1;
}

function containingContainer(node: SemanticFlowNode, candidates: SemanticFlowNode[]) {
  const center = { x: node.position.x + node.data.size.width / 2, y: node.position.y + node.data.size.height / 2 };
  return candidates.filter((candidate) => isContainerNode(candidate) && candidate.id !== node.id
    && center.x > candidate.position.x && center.x < candidate.position.x + candidate.data.size.width
    && center.y > candidate.position.y && center.y < candidate.position.y + candidate.data.size.height)
    .sort((left, right) => left.data.size.width * left.data.size.height - right.data.size.width * right.data.size.height)[0];
}

function containerDescendants(containerId: string, nodes: SemanticFlowNode[]) {
  const ids = new Set<string>();
  let added = true;
  while (added) {
    added = false;
    for (const node of nodes) {
      if (node.data.containerId === containerId || (node.data.containerId && ids.has(node.data.containerId))) {
        if (!ids.has(node.id)) { ids.add(node.id); added = true; }
      }
    }
  }
  return nodes.filter((node) => ids.has(node.id));
}

function edgeColor(semantics: EdgeSemantics) {
  if (semantics === "event") return "#fbbf24";
  if (semantics === "data" || semantics === "feedback") return "#a78bfa";
  if (semantics === "failure") return "#fb7185";
  return "#b6ff5c";
}

function edgeMarkers(direction: EdgeDirection, color: string) {
  const marker = { type: MarkerType.ArrowClosed, color, width: 12, height: 12 };
  return {
    markerStart: direction === "reverse" || direction === "both" ? marker : undefined,
    markerEnd: direction === "forward" || direction === "both" ? marker : undefined,
  };
}

function toFlow(document: DiagramDocument) {
  const nodes: SemanticFlowNode[] = document.nodes.map((node) => ({
    id: node.id,
    type: "semantic",
    position: node.position,
    style: { width: node.size?.width ?? 220, height: node.size?.height ?? 104 },
    zIndex: nodeZIndex(node),
    data: node,
  }));
  const edges: SemanticFlowEdge[] = document.edges.map((edge, index) => ({
    id: edge.id,
    type: "semantic",
    source: edge.from,
    target: edge.to,
    sourceHandle: sourceHandleId(portIds.has(edge.sourcePort) ? edge.sourcePort : "output"),
    targetHandle: targetHandleId(portIds.has(edge.targetPort) ? edge.targetPort : "input"),
    label: edge.label,
    zIndex: index + 2,
    data: {
      semantics: edge.semantics,
      important: edge.important,
      animated: edge.animated,
      direction: edge.direction,
      thickness: edge.thickness,
      color: edge.color ?? edgeColor(edge.semantics),
      strokeStyle: edge.strokeStyle ?? (edge.semantics === "event" || edge.semantics === "feedback" ? "dashed" : "solid"),
      effect: edge.effect ?? "pulse",
      speed: edge.speed ?? (edge.semantics === "event" ? 2.7 : 2.1),
      labelOffset: edge.labelOffset ?? { x: 0, y: 0 },
      routeWaypoints: edge.routeWaypoints,
      routeWaypoint: edge.routeWaypoint,
      routeOffset: 16 + (index % 4) * 7,
    },
    ...edgeMarkers(edge.direction, edge.color ?? edgeColor(edge.semantics)),
  }));
  return { nodes, edges };
}

function toDocument(
  base: DiagramDocument,
  nodes: SemanticFlowNode[],
  edges: SemanticFlowEdge[],
): DiagramDocument {
  return {
    ...base,
    nodes: nodes.map((node) => ({ ...node.data, position: node.position })),
    edges: edges.map((edge) => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      semantics: edge.data?.semantics ?? "request",
      important: edge.data?.important ?? true,
      animated: edge.data?.animated ?? true,
      direction: edge.data?.direction ?? "forward",
      thickness: edge.data?.thickness ?? 1.8,
      color: edge.data?.color ?? edgeColor(edge.data?.semantics ?? "request"),
      strokeStyle: edge.data?.strokeStyle ?? "solid",
      effect: edge.data?.effect ?? "pulse",
      speed: edge.data?.speed ?? 2.1,
      labelOffset: edge.data?.labelOffset ?? { x: 0, y: 0 },
      routeWaypoints: edge.data?.routeWaypoints,
      routeWaypoint: edge.data?.routeWaypoint,
      label: typeof edge.label === "string" ? edge.label : undefined,
      sourcePort: logicalPortId(edge.sourceHandle, "output"),
      targetPort: logicalPortId(edge.targetHandle, "input"),
    })),
  };
}

const CanvasInner = forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(
  function CanvasInner({ document, externalRevision = 0, onDocumentChange, onSelectionChange, readOnly = false }, ref) {
    const initial = useMemo(() => toFlow(document), [document]);
    const [nodes, setNodes] = useState<SemanticFlowNode[]>(initial.nodes);
    const [edges, setEdges] = useState<SemanticFlowEdge[]>(initial.edges);
    const [isLayouting, setIsLayouting] = useState(false);
    const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides | null>(null);
    const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
    const nodesRef = useRef(nodes);
    const edgesRef = useRef(edges);
    const containerDragRef = useRef<{ id: string; position: { x: number; y: number }; children: Map<string, { x: number; y: number }> } | null>(null);
    const clipboardRef = useRef<{ nodes: DiagramNode[]; edges: DiagramEdge[] } | null>(null);
    const pasteCountRef = useRef(0);
    const wrapperRef = useRef<HTMLDivElement>(null);
    // Set once the person pans or zooms by hand; from then on the canvas keeps
    // their viewport instead of re-fitting when the stage is resized.
    const viewportPinnedRef = useRef(false);
    const historyRef = useRef<{ past: CanvasSnapshot[]; future: CanvasSnapshot[] }>({ past: [], future: [] });
    const lastCommitRef = useRef(0);
    const restoringRef = useRef(false);
    // ReactFlow measures every node on mount and reports it as a dimension
    // change; without this the canvas would start life with a phantom undo step.
    const interactedRef = useRef(false);
    const [historyRevision, setHistoryRevision] = useState(0);
    const { fitView, flowToScreenPosition, screenToFlowPosition, zoomIn, zoomOut, zoomTo } = useReactFlow();
    const zoom = useStore((state) => state.transform[2]);

    const commitHistory = useCallback(() => {
      if (restoringRef.current) return;
      const now = performance.now();
      const history = historyRef.current;
      if (history.past.length > 0 && now - lastCommitRef.current < historyMergeWindow) {
        lastCommitRef.current = now;
        return;
      }
      lastCommitRef.current = now;
      history.past.push({ nodes: nodesRef.current, edges: edgesRef.current });
      if (history.past.length > historyLimit) history.past.shift();
      history.future = [];
      setHistoryRevision((value) => value + 1);
    }, []);

    const resetHistory = useCallback(() => {
      historyRef.current = { past: [], future: [] };
      lastCommitRef.current = 0;
      interactedRef.current = false;
      setHistoryRevision((value) => value + 1);
    }, []);

    const replaceCanvas = useCallback(
      (nextNodes: SemanticFlowNode[], nextEdges: SemanticFlowEdge[], persist = true) => {
        if (persist) commitHistory();
        nodesRef.current = nextNodes;
        edgesRef.current = nextEdges;
        setNodes(nextNodes);
        setEdges(nextEdges);
        if (persist) onDocumentChange(toDocument(document, nextNodes, nextEdges));
      },
      [commitHistory, document, onDocumentChange],
    );

    const restore = useCallback((direction: "undo" | "redo") => {
      if (readOnly) return;
      const history = historyRef.current;
      const from = direction === "undo" ? history.past : history.future;
      const to = direction === "undo" ? history.future : history.past;
      const target = from.pop();
      if (!target) return;
      to.push({ nodes: nodesRef.current, edges: edgesRef.current });
      restoringRef.current = true;
      lastCommitRef.current = 0;
      replaceCanvas(target.nodes, target.edges);
      restoringRef.current = false;
      setHistoryRevision((value) => value + 1);
    }, [readOnly, replaceCanvas]);

    const arrange = useCallback(async () => {
      if (nodesRef.current.length === 0) return;
      setIsLayouting(true);
      const current = toDocument(document, nodesRef.current, edgesRef.current);
      const arranged = await layoutDocument(current);
      const flow = toFlow(arranged);
      replaceCanvas(flow.nodes, flow.edges);
      viewportPinnedRef.current = false;
      requestAnimationFrame(() => fitView({ padding: 0.14, duration: 520 }));
      setIsLayouting(false);
    }, [document, fitView, replaceCanvas]);

    useEffect(() => {
      let cancelled = false;
      const flow = toFlow(document);
      replaceCanvas(flow.nodes, flow.edges, false);

      const needsLayout = document.nodes.length > 0 && document.nodes.every(
        (node) => node.position.x === 0 && node.position.y === 0,
      );
      if (needsLayout) {
        void layoutDocument(document).then((arranged) => {
          if (cancelled) return;
          const arrangedFlow = toFlow(arranged);
          replaceCanvas(arrangedFlow.nodes, arrangedFlow.edges);
          requestAnimationFrame(() => fitView({ padding: 0.14, duration: 0 }));
        });
      } else if (flow.nodes.length > 0) {
        requestAnimationFrame(() => fitView({ padding: 0.14, duration: 0 }));
      }
      onSelectionChange?.({ nodeIds: [], edgeIds: [] });
      viewportPinnedRef.current = false;
      resetHistory();
      return () => { cancelled = true; };
      // Workspace changes reset the canvas; edits within a workspace stay local.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [document.id, externalRevision]);

    const insertPrimitive = useCallback(
      (primitive: PrimitiveDefinition, position?: { x: number; y: number }) => {
        const bounds = wrapperRef.current?.getBoundingClientRect();
        const center = bounds
          ? screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
          : { x: 320, y: 240 };
        const primitiveSize = primitive.size ?? { width: 220, height: 104 };
        const origin = { x: center.x - primitiveSize.width / 2, y: center.y - primitiveSize.height / 2 };
        const insertionPosition = position ?? findAvailablePosition(
          origin,
          nodesRef.current.map((node) => node.position),
        );
        const node = createDiagramNode(
          primitive,
          insertionPosition,
          `${primitive.role}-${crypto.randomUUID()}`,
        );
        const container = containingContainer({ id: node.id, type: "semantic", position: node.position, data: node }, nodesRef.current);
        if (container && primitive.role !== "zone" && primitive.role !== "group") node.containerId = container.id;
        const nextNodes: SemanticFlowNode[] = [
          ...nodesRef.current,
          { id: node.id, type: "semantic", position: node.position, style: { width: node.size.width, height: node.size.height }, zIndex: nodeZIndex(node), data: node },
        ];
        replaceCanvas(nextNodes, edgesRef.current);
      },
      [replaceCanvas, screenToFlowPosition],
    );

    const updateNodes = useCallback((nodeIds: string[], updates: Partial<DiagramNode>) => {
      const selected = new Set(nodeIds);
      const nextNodes = nodesRef.current.map((node) => {
        if (!selected.has(node.id)) return node;
        const data = { ...node.data, ...updates };
        return { ...node, zIndex: typeof updates.zIndex === "number" || updates.role ? nodeZIndex(data) : node.zIndex, style: updates.size ? { ...node.style, width: updates.size.width, height: updates.size.height } : node.style, data };
      });
      replaceCanvas(nextNodes, edgesRef.current);
    }, [replaceCanvas]);

    const updateEdges = useCallback((edgeIds: string[], updates: Partial<Pick<DiagramEdge, "label" | "semantics" | "direction" | "thickness" | "animated" | "color" | "strokeStyle" | "effect" | "speed">> & { routeWaypoints?: DiagramEdge["routeWaypoints"] | null; routeWaypoint?: DiagramEdge["routeWaypoint"] | null }) => {
      const selected = new Set(edgeIds);
      const nextEdges: SemanticFlowEdge[] = edgesRef.current.map((edge) => {
        if (!selected.has(edge.id)) return edge;
        const semantics = updates.semantics ?? edge.data?.semantics ?? "request";
        const direction = updates.direction ?? edge.data?.direction ?? "forward";
        const thickness = updates.thickness ?? edge.data?.thickness ?? 1.8;
        const animated = updates.animated ?? edge.data?.animated ?? true;
        const color = updates.color ?? edge.data?.color ?? edgeColor(semantics);
        const strokeStyle = updates.strokeStyle ?? edge.data?.strokeStyle ?? "solid";
        const effect = updates.effect ?? edge.data?.effect ?? "pulse";
        const speed = updates.speed ?? edge.data?.speed ?? 2.1;
        const routeWaypoints = updates.routeWaypoints === null ? undefined : updates.routeWaypoints ?? edge.data?.routeWaypoints;
        const routeWaypoint = updates.routeWaypoint === null ? undefined : updates.routeWaypoint ?? edge.data?.routeWaypoint;
        return {
          ...edge,
          label: updates.label !== undefined ? updates.label : edge.label,
          data: { ...edge.data, semantics, direction, thickness, animated, color, strokeStyle, effect, speed, routeWaypoints, routeWaypoint, labelOffset: edge.data?.labelOffset ?? { x: 0, y: 0 }, important: edge.data?.important ?? true },
          ...edgeMarkers(direction, color),
        };
      });
      replaceCanvas(nodesRef.current, nextEdges);
      requestAnimationFrame(() => onSelectionChange?.({ nodeIds: [], edgeIds: [...selected] }));
    }, [onSelectionChange, replaceCanvas]);

    const moveEdgeLabel = useCallback((edgeId: string, labelOffset: { x: number; y: number }) => {
      const nextEdges: SemanticFlowEdge[] = edgesRef.current.map((edge) => edge.id === edgeId ? { ...edge, data: { ...edge.data!, labelOffset } } : edge);
      replaceCanvas(nodesRef.current, nextEdges);
    }, [replaceCanvas]);

    const moveEdgeRoute = useCallback((edgeId: string, routeWaypoints: Array<{ x: number; y: number }>) => {
      const nextEdges: SemanticFlowEdge[] = edgesRef.current.map((edge) => edge.id === edgeId ? { ...edge, data: { ...edge.data!, routeWaypoints, routeWaypoint: undefined } } : edge);
      replaceCanvas(nodesRef.current, nextEdges);
    }, [replaceCanvas]);

    const editEdgeCaption = useCallback((edgeId: string, label: string) => updateEdges([edgeId], { label }), [updateEdges]);

    const editNodeInline = useCallback((nodeId: string, updates: Partial<Pick<DiagramNode, "label" | "detail">>) => {
      const nextNodes = nodesRef.current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...updates } } : node);
      replaceCanvas(nextNodes, edgesRef.current);
    }, [replaceCanvas]);

    const moveContainerLabel = useCallback((nodeId: string, labelPosition: NonNullable<DiagramNode["labelPosition"]>) => {
      const nextNodes = nodesRef.current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, labelPosition } } : node);
      replaceCanvas(nextNodes, edgesRef.current);
    }, [replaceCanvas]);

    const groupSelection = useCallback((nodeIds: string[]) => {
      const selected = nodesRef.current.filter((node) => nodeIds.includes(node.id) && !isContainerNode(node));
      if (selected.length < 2) return;
      const padding = 40;
      const left = Math.min(...selected.map((node) => node.position.x)) - padding;
      const top = Math.min(...selected.map((node) => node.position.y)) - padding;
      const right = Math.max(...selected.map((node) => node.position.x + node.data.size.width)) + padding;
      const bottom = Math.max(...selected.map((node) => node.position.y + node.data.size.height)) + padding;
      const primitive = primitiveDefinitions.find((candidate) => candidate.role === "group")!;
      const group = createDiagramNode(primitive, { x: left, y: top }, `group-${crypto.randomUUID()}`);
      group.label = "Component group";
      group.size = { width: right - left, height: bottom - top };
      group.containerId = containingContainer({ id: group.id, type: "semantic", position: group.position, data: group }, nodesRef.current)?.id;
      const selectedIds = new Set(selected.map((node) => node.id));
      const groupNode: SemanticFlowNode = { id: group.id, type: "semantic", position: group.position, style: { width: group.size.width, height: group.size.height }, zIndex: -1, selected: true, data: group };
      const nextNodes = [groupNode, ...nodesRef.current.map((node) => selectedIds.has(node.id) ? { ...node, selected: false, data: { ...node.data, containerId: group.id } } : { ...node, selected: false })];
      replaceCanvas(nextNodes, edgesRef.current);
      onSelectionChange?.({ nodeIds: [group.id], edgeIds: [] });
      setContextMenu(null);
    }, [onSelectionChange, replaceCanvas]);

    const ungroupSelection = useCallback((nodeIds: string[]) => {
      const selected = nodesRef.current.filter((node) => nodeIds.includes(node.id));
      const groupIds = new Set(selected.filter((node) => node.data.role === "group").map((node) => node.id));
      selected.forEach((node) => { if (node.data.containerId) groupIds.add(node.data.containerId); });
      if (!groupIds.size) return;
      const groupParents = new Map(nodesRef.current.filter((node) => groupIds.has(node.id)).map((node) => [node.id, node.data.containerId]));
      const nextNodes = nodesRef.current.filter((node) => !groupIds.has(node.id)).map((node) => groupIds.has(node.data.containerId ?? "") ? { ...node, data: { ...node.data, containerId: groupParents.get(node.data.containerId!) } } : node);
      replaceCanvas(nextNodes, edgesRef.current);
      onSelectionChange?.({ nodeIds: [], edgeIds: [] });
      setContextMenu(null);
    }, [onSelectionChange, replaceCanvas]);

    const matchSelectionStyle = useCallback((nodeIds: string[]) => {
      const selected = nodesRef.current.filter((node) => nodeIds.includes(node.id));
      if (selected.length < 2) return;
      const source = selected[0].data;
      const style = { color: source.color, borderStyle: source.borderStyle, borderWidth: source.borderWidth, effect: source.effect, speed: source.speed };
      const selectedIds = new Set(nodeIds);
      replaceCanvas(nodesRef.current.map((node) => selectedIds.has(node.id) ? { ...node, data: { ...node.data, ...style } } : node), edgesRef.current);
      setContextMenu(null);
    }, [replaceCanvas]);

    const deleteSelection = useCallback((nodeIds: string[], edgeIds: string[]) => {
      const deletedNodes = new Set(nodeIds);
      const deletedEdges = new Set(edgeIds);
      const deletedParents = new Map(nodesRef.current.filter((node) => deletedNodes.has(node.id)).map((node) => [node.id, node.data.containerId]));
      const nextNodes = nodesRef.current.filter((node) => !deletedNodes.has(node.id)).map((node) => deletedNodes.has(node.data.containerId ?? "") ? { ...node, data: { ...node.data, containerId: deletedParents.get(node.data.containerId!) } } : node);
      const nextEdges = edgesRef.current.filter((edge) => !deletedEdges.has(edge.id) && !deletedNodes.has(edge.source) && !deletedNodes.has(edge.target));
      replaceCanvas(nextNodes, nextEdges);
      onSelectionChange?.({ nodeIds: [], edgeIds: [] });
    }, [onSelectionChange, replaceCanvas]);

    const copySelection = useCallback((nodeIds: string[]) => {
      const copiedIds = new Set(nodeIds);
      for (const nodeId of nodeIds) {
        if (nodesRef.current.some((node) => node.id === nodeId && isContainerNode(node))) {
          containerDescendants(nodeId, nodesRef.current).forEach((node) => copiedIds.add(node.id));
        }
      }
      if (!copiedIds.size) return;
      const snapshot = toDocument(document, nodesRef.current, edgesRef.current);
      clipboardRef.current = {
        nodes: structuredClone(snapshot.nodes.filter((node) => copiedIds.has(node.id))),
        edges: structuredClone(snapshot.edges.filter((edge) => copiedIds.has(edge.from) && copiedIds.has(edge.to))),
      };
      pasteCountRef.current = 0;
      setContextMenu(null);
    }, [document]);

    const pasteSelection = useCallback(() => {
      const clipboard = clipboardRef.current;
      if (!clipboard?.nodes.length) return;
      pasteCountRef.current += 1;
      const offset = 32 * pasteCountRef.current;
      const idMap = new Map(clipboard.nodes.map((node) => [node.id, `${node.role}-${crypto.randomUUID()}`]));
      const existingIds = new Set(nodesRef.current.map((node) => node.id));
      const pastedNodes = clipboard.nodes.map((source) => {
        const node = structuredClone(source);
        node.id = idMap.get(source.id)!;
        node.position = { x: source.position.x + offset, y: source.position.y + offset };
        node.containerId = source.containerId ? idMap.get(source.containerId) ?? (existingIds.has(source.containerId) ? source.containerId : undefined) : undefined;
        return node;
      });
      const pastedEdges = clipboard.edges.map((source) => ({
        ...structuredClone(source),
        id: `edge-${crypto.randomUUID()}`,
        from: idMap.get(source.from)!,
        to: idMap.get(source.to)!,
        routeWaypoints: source.routeWaypoints?.map((point) => ({ x: point.x + offset, y: point.y + offset })),
        routeWaypoint: source.routeWaypoint ? { x: source.routeWaypoint.x + offset, y: source.routeWaypoint.y + offset } : undefined,
      }));
      const pastedFlow = toFlow({ ...document, nodes: pastedNodes, edges: pastedEdges });
      const pastedIds = new Set(pastedNodes.map((node) => node.id));
      const nextNodes = [
        ...nodesRef.current.map((node) => ({ ...node, selected: false })),
        ...pastedFlow.nodes.map((node) => ({ ...node, selected: true })),
      ];
      const nextEdges = [...edgesRef.current.map((edge) => ({ ...edge, selected: false })), ...pastedFlow.edges];
      replaceCanvas(nextNodes, nextEdges);
      onSelectionChange?.({ nodeIds: [...pastedIds], edgeIds: [] });
      setContextMenu(null);
    }, [document, onSelectionChange, replaceCanvas]);

    const autoFitSelection = useCallback(async (nodeIds: string[]) => {
      if (!nodeIds.length) return;
      setIsLayouting(true);
      const selectedIds = new Set(nodeIds);
      const current = toDocument(document, nodesRef.current, edgesRef.current);
      const selectedNodes = current.nodes.filter((node) => selectedIds.has(node.id));
      let positioned = selectedNodes;
      if (selectedNodes.length > 1) {
        const internalEdges = current.edges.filter((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to));
        const arranged = await layoutDocument({ ...current, nodes: selectedNodes, edges: internalEdges });
        const before = { x: Math.min(...selectedNodes.map((node) => node.position.x)), y: Math.min(...selectedNodes.map((node) => node.position.y)) };
        const after = { x: Math.min(...arranged.nodes.map((node) => node.position.x)), y: Math.min(...arranged.nodes.map((node) => node.position.y)) };
        positioned = arranged.nodes.map((node) => ({ ...node, position: { x: node.position.x + before.x - after.x, y: node.position.y + before.y - after.y } }));
      }
      const positions = new Map(positioned.map((node) => [node.id, node.position]));
      const nextNodes = nodesRef.current.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)!, selected: true } : node);
      const nextEdges = edgesRef.current.map((edge) => selectedIds.has(edge.source) || selectedIds.has(edge.target)
        ? { ...edge, data: { ...edge.data!, routeWaypoints: undefined, routeWaypoint: undefined } }
        : edge);
      replaceCanvas(nextNodes, nextEdges);
      setContextMenu(null);
      requestAnimationFrame(() => fitView({ nodes: nextNodes.filter((node) => selectedIds.has(node.id)), padding: 0.22, duration: 420 }));
      setIsLayouting(false);
    }, [document, fitView, replaceCanvas]);

    // Fix 11 — .canvas-stage is a size container, so resizing a panel or the
    // window changes the drawing surface while the ReactFlow viewport stays put
    // and the diagram drifts out of frame. Re-fit once the resizing settles,
    // unless the person has taken control of the viewport themselves.
    useEffect(() => {
      const element = wrapperRef.current;
      if (!element || typeof ResizeObserver === "undefined") return;
      let timer = 0;
      const observer = new ResizeObserver(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          if (viewportPinnedRef.current || nodesRef.current.length === 0) return;
          fitView({ padding: 0.14, duration: 0 });
        }, 150);
      });
      observer.observe(element);
      return () => {
        window.clearTimeout(timer);
        observer.disconnect();
      };
    }, [fitView]);

    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
        if (!(event.metaKey || event.ctrlKey)) return;
        if (event.key.toLowerCase() === "c") {
          const selected = nodesRef.current.filter((node) => node.selected).map((node) => node.id);
          if (!selected.length) return;
          event.preventDefault();
          copySelection(selected);
        }
        if (event.key.toLowerCase() === "v" && clipboardRef.current?.nodes.length) {
          event.preventDefault();
          pasteSelection();
        }
        if (event.key.toLowerCase() === "z") {
          event.preventDefault();
          restore(event.shiftKey ? "redo" : "undo");
        }
        if (event.key.toLowerCase() === "y") {
          event.preventDefault();
          restore("redo");
        }
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [copySelection, pasteSelection, restore]);

    const fitToView = useCallback(() => {
      viewportPinnedRef.current = false;
      fitView({ padding: 0.14, duration: 420 });
    }, [fitView]);

    useImperativeHandle(ref, () => ({
      arrange, deleteSelection, groupSelection, insertPrimitive, ungroupSelection, updateEdges, updateNodes,
      undo: () => restore("undo"),
      redo: () => restore("redo"),
      canUndo: () => historyRef.current.past.length > 0,
      canRedo: () => historyRef.current.future.length > 0,
      fitToView,
    }), [arrange, deleteSelection, fitToView, groupSelection, insertPrimitive, restore, ungroupSelection, updateEdges, updateNodes]);

    const handleNodesChange = useCallback((changes: NodeChange<SemanticFlowNode>[]) => {
      const dimensions = new Map<string, { width: number; height: number }>();
      for (const change of changes) {
        if (change.type === "dimensions" && change.dimensions) dimensions.set(change.id, change.dimensions);
      }
      const removed = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id));
      // Deletions and hand resizes are undoable; the measurement pass ReactFlow
      // runs before anyone has touched the canvas is not.
      if (removed.size > 0 || (dimensions.size > 0 && interactedRef.current)) commitHistory();
      const next = applyNodeChanges(changes, nodesRef.current).map((node) => dimensions.has(node.id)
        ? { ...node, data: { ...node.data, size: dimensions.get(node.id)! } }
        : node);
      nodesRef.current = next;
      setNodes(next);
      if (removed.size > 0) {
        const nextEdges = edgesRef.current.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target));
        edgesRef.current = nextEdges;
        setEdges(nextEdges);
        onDocumentChange(toDocument(document, next, nextEdges));
      } else if (dimensions.size > 0) {
        onDocumentChange(toDocument(document, next, edgesRef.current));
      }
    }, [commitHistory, document, onDocumentChange]);

    const handleEdgesChange = useCallback((changes: EdgeChange<SemanticFlowEdge>[]) => {
      const removes = changes.some((change) => change.type === "remove");
      if (removes) commitHistory();
      const next = applyEdgeChanges(changes, edgesRef.current);
      edgesRef.current = next;
      setEdges(next);
      if (removes) {
        onDocumentChange(toDocument(document, nodesRef.current, next));
      }
    }, [commitHistory, document, onDocumentChange]);

    const handleSelectionChange = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: { nodes: SemanticFlowNode[]; edges: SemanticFlowEdge[] }) => {
      onSelectionChange?.({ nodeIds: selectedNodes.map((node) => node.id), edgeIds: selectedEdges.map((edge) => edge.id) });
    }, [onSelectionChange]);

    const onConnect = useCallback((connection: Connection) => {
      const edge: SemanticFlowEdge = {
        ...normalizeConnection(connection),
        id: `edge-${crypto.randomUUID()}`,
        type: "semantic",
        selected: true,
        data: { semantics: "request", important: true, animated: true, direction: "forward", thickness: 1.8, color: "#b6ff5c", strokeStyle: "solid", effect: "pulse", speed: 2.1, labelOffset: { x: 0, y: 0 } },
        ...edgeMarkers("forward", "#b6ff5c"),
      };
      const next = addEdge(edge, edgesRef.current.map((candidate) => ({ ...candidate, selected: false }))) as SemanticFlowEdge[];
      const nextNodes = nodesRef.current.map((node) => ({ ...node, selected: false }));
      replaceCanvas(nextNodes, next);
      requestAnimationFrame(() => onSelectionChange?.({ nodeIds: [], edgeIds: [edge.id] }));
    }, [onSelectionChange, replaceCanvas]);

    const contextNodeIds = nodes.filter((node) => node.selected).map((node) => node.id);
    const canUngroup = nodes.some((node) => contextNodeIds.includes(node.id) && (node.data.role === "group" || Boolean(node.data.containerId)));
    const openContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
      if (!(event.target as HTMLElement).closest(".react-flow")) return;
      event.preventDefault();
      event.stopPropagation();
      const clickedNodeId = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node")?.dataset.id;
      if (clickedNodeId && !nodesRef.current.some((node) => node.id === clickedNodeId && node.selected)) {
        const nextNodes = nodesRef.current.map((node) => ({ ...node, selected: node.id === clickedNodeId }));
        const nextEdges = edgesRef.current.map((edge) => ({ ...edge, selected: false }));
        nodesRef.current = nextNodes;
        edgesRef.current = nextEdges;
        setNodes(nextNodes);
        setEdges(nextEdges);
        onSelectionChange?.({ nodeIds: [clickedNodeId], edgeIds: [] });
      }
      const bounds = wrapperRef.current!.getBoundingClientRect();
      const menuWidth = 206;
      const menuHeight = 326;
      setContextMenu({
        x: Math.max(8, Math.min(bounds.width - menuWidth - 8, event.clientX - bounds.left)),
        y: Math.max(8, Math.min(bounds.height - menuHeight - 8, event.clientY - bounds.top)),
        flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    }, [onSelectionChange, screenToFlowPosition]);

    const canUndo = historyRef.current.past.length > 0;
    const canRedo = historyRef.current.future.length > 0;
    // Recomputed only when the drawing actually moves, not on every render.
    const frame = useMemo(() => exportBounds(document), [document]);
    void historyRevision;

    return (
      <div className="canvas-wrap" onContextMenuCapture={openContextMenu} onPointerDownCapture={() => { interactedRef.current = true; }} ref={wrapperRef}>
        <div className="canvas-toolbar">
          <button aria-label="Undo" disabled={readOnly || !canUndo} onClick={() => restore("undo")} title="Undo (⌘Z)" type="button">↺</button>
          <button aria-label="Redo" disabled={readOnly || !canRedo} onClick={() => restore("redo")} title="Redo (⇧⌘Z)" type="button">↻</button>
          <i className="canvas-toolbar-divider" />
          <button disabled={nodes.length === 0 || isLayouting} onClick={() => void arrange()} type="button">
            {isLayouting ? "Arranging…" : "Auto-layout"}
          </button>
          <button disabled={nodes.length === 0} onClick={() => { viewportPinnedRef.current = false; fitView({ padding: 0.14, duration: 420 }); }} type="button">Fit view</button>
          <i className="canvas-toolbar-divider" />
          <button aria-label="Zoom out" onClick={() => { viewportPinnedRef.current = true; void zoomOut({ duration: 160 }); }} type="button">−</button>
          <button aria-label="Reset zoom to 100%" className="zoom-readout" onClick={() => { viewportPinnedRef.current = true; void zoomTo(1, { duration: 160 }); }} type="button">{Math.round(zoom * 100)}%</button>
          <button aria-label="Zoom in" onClick={() => { viewportPinnedRef.current = true; void zoomIn({ duration: 160 }); }} type="button">+</button>
          <span>{nodes.length} nodes · {edges.length} connections</span>
        </div>
        {nodes.length === 0 ? (
          <div className="canvas-empty"><i>＋</i><strong>Start with a primitive</strong><span>Click an item or drag it from the library</span></div>
        ) : null}
        {alignmentGuides?.x !== undefined ? <div className="alignment-guide alignment-guide--vertical" style={{ left: alignmentGuides.x }}><span>{alignmentGuides.label}</span></div> : null}
        {alignmentGuides?.y !== undefined ? <div className="alignment-guide alignment-guide--horizontal" style={{ top: alignmentGuides.y }}><span>{alignmentGuides.label}</span></div> : null}
        <EdgeCaptionEditContext.Provider value={editEdgeCaption}>
        <EdgeLabelMoveContext.Provider value={moveEdgeLabel}>
        <EdgeRouteMoveContext.Provider value={moveEdgeRoute}>
        <ContainerLabelMoveContext.Provider value={moveContainerLabel}>
        <NodeInlineEditContext.Provider value={editNodeInline}>
        <ReactFlow<SemanticFlowNode, SemanticFlowEdge>
          connectionLineType={ConnectionLineType.Straight}
          connectionLineStyle={{ stroke: "#b6ff5c", strokeWidth: 1.8, filter: "drop-shadow(0 0 5px rgba(182,255,92,.38))" }}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={56}
          edges={edges}
          edgeTypes={edgeTypes}
          elevateEdgesOnSelect
          elevateNodesOnSelect={false}
          fitView
          fitViewOptions={{ padding: 0.14 }}
          minZoom={0.1}
          maxZoom={2.5}
          nodeTypes={nodeTypes}
          nodes={nodes}
          nodesConnectable={!readOnly}
          nodesDraggable={!readOnly}
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          onConnect={onConnect}
          onPaneClick={() => setContextMenu(null)}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (readOnly) return;
            const raw = event.dataTransfer.getData(primitiveDragType);
            if (!raw) return;
            const primitive = JSON.parse(raw) as PrimitiveDefinition;
            insertPrimitive(primitive, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }}
          onEdgeClick={(event, clickedEdge) => {
            event.stopPropagation();
            const additive = event.metaKey || event.ctrlKey || event.shiftKey;
            const nextEdges = edgesRef.current.map((edge) => ({ ...edge, selected: edge.id === clickedEdge.id ? true : additive && Boolean(edge.selected) }));
            const nextNodes = additive ? nodesRef.current : nodesRef.current.map((node) => ({ ...node, selected: false }));
            nodesRef.current = nextNodes;
            edgesRef.current = nextEdges;
            setNodes(nextNodes);
            setEdges(nextEdges);
            onSelectionChange?.({ nodeIds: nextNodes.filter((node) => node.selected).map((node) => node.id), edgeIds: nextEdges.filter((edge) => edge.selected).map((edge) => edge.id) });
          }}
          onEdgeDoubleClick={(event, clickedEdge) => {
            event.preventDefault();
            event.stopPropagation();
            window.dispatchEvent(new CustomEvent(edgeCaptionEditEvent, { detail: { edgeId: clickedEdge.id } }));
          }}
          onEdgesChange={handleEdgesChange}
          onMoveStart={(event) => { if (event) viewportPinnedRef.current = true; }}
          onNodeDragStart={(_, node) => {
            if (!isContainerNode(node)) return;
            containerDragRef.current = {
              id: node.id,
              position: { ...node.position },
              children: new Map(containerDescendants(node.id, nodesRef.current).map((candidate) => [candidate.id, { ...candidate.position }])),
            };
          }}
          onNodeDrag={(_, node) => {
            const containerDrag = containerDragRef.current;
            if (containerDrag?.id === node.id) {
              const delta = { x: node.position.x - containerDrag.position.x, y: node.position.y - containerDrag.position.y };
              const next = nodesRef.current.map((candidate) => {
                const origin = containerDrag.children.get(candidate.id);
                return origin ? { ...candidate, position: { x: origin.x + delta.x, y: origin.y + delta.y } } : candidate;
              });
              nodesRef.current = next;
              setNodes(next);
              setAlignmentGuides(null);
              return;
            }
            const peers = nodesRef.current.filter((candidate) => candidate.id !== node.id);
            const nearX = peers.find((candidate) => Math.abs(candidate.position.x - node.position.x) <= 10);
            const nearY = peers.find((candidate) => Math.abs(candidate.position.y - node.position.y) <= 10);
            const bounds = wrapperRef.current?.getBoundingClientRect();
            if ((!nearX && !nearY) || !bounds) return setAlignmentGuides(null);
            const x = nearX ? flowToScreenPosition({ x: nearX.position.x, y: 0 }).x - bounds.left : undefined;
            const y = nearY ? flowToScreenPosition({ x: 0, y: nearY.position.y }).y - bounds.top : undefined;
            setAlignmentGuides({ x, y, label: nearX && nearY ? `${nearX.data.label} · ${nearY.data.label}` : (nearX ?? nearY)?.data.label ?? "Aligned" });
          }}
          onNodeDragStop={(_, node) => {
            if (containerDragRef.current?.id === node.id) {
              containerDragRef.current = null;
              replaceCanvas(nodesRef.current, edgesRef.current);
              setAlignmentGuides(null);
              return;
            }
            const peers = nodesRef.current.filter((candidate) => candidate.id !== node.id);
            const nearX = peers.find((candidate) => Math.abs(candidate.position.x - node.position.x) <= 10);
            const nearY = peers.find((candidate) => Math.abs(candidate.position.y - node.position.y) <= 10);
            const alignedNode = { ...node, position: { x: nearX?.position.x ?? node.position.x, y: nearY?.position.y ?? node.position.y } };
            const container = containingContainer(alignedNode, peers);
            alignedNode.data = { ...alignedNode.data, containerId: container?.id };
            const next = nodesRef.current.map((candidate) => candidate.id === node.id ? alignedNode : candidate);
            replaceCanvas(next, edgesRef.current);
            setAlignmentGuides(null);
          }}
          onNodesChange={handleNodesChange}
          onReconnect={(oldEdge, connection) => {
            const next = reconnectEdge(oldEdge, normalizeConnection(connection), edgesRef.current, { shouldReplaceId: false }).map((edge) => edge.id === oldEdge.id
              ? { ...edge, data: { ...edge.data!, routeWaypoints: undefined, routeWaypoint: undefined } }
              : edge);
            replaceCanvas(nodesRef.current, next);
          }}
          onSelectionChange={handleSelectionChange}
          multiSelectionKeyCode={["Meta", "Control", "Shift"]}
          panOnScroll
          autoPanOnConnect
          selectionOnDrag
          snapGrid={[8, 8]}
          snapToGrid
        >
          <Background id="minor-grid" color="#171717" gap={8} size={0.45} variant={BackgroundVariant.Lines} />
          <Background id="major-grid" color="#292929" gap={32} size={0.8} variant={BackgroundVariant.Lines} />
          {/* The export frame, in diagram coordinates rather than screen ones, so
              it pans and zooms with the drawing. This is the exact rectangle the
              exporter will cover — nothing outside it is cropped, because the
              frame grows to hold every component; it is there to show the shape
              the output will have. */}
          {nodes.length > 0 ? (
            <ViewportPortal>
              <div
                aria-hidden="true"
                className="export-frame"
                style={{
                  position: "absolute",
                  transform: `translate(${frame.minX}px, ${frame.minY}px)`,
                  width: frame.width,
                  height: frame.height,
                }}
              >
                <span>{(document.format ?? "16:9").toUpperCase()} · EXPORT</span>
              </div>
            </ViewportPortal>
          ) : null}
          <MiniMap
            ariaLabel="Diagram minimap"
            maskColor="rgba(5,5,5,.72)"
            nodeColor={(node) => (node as SemanticFlowNode).data.color}
            nodeStrokeWidth={3}
            pannable
            position="bottom-right"
            zoomable
          />
        </ReactFlow>
        {contextMenu ? <div aria-label="Canvas actions" className="canvas-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onContextMenu={(event) => event.preventDefault()}>
          <span>{contextNodeIds.length ? `${contextNodeIds.length} SELECTED` : "CANVAS"}</span>
          <button disabled={!contextNodeIds.length} onClick={() => void autoFitSelection(contextNodeIds)} role="menuitem">Auto-fit selected layout</button>
          <button disabled={!contextNodeIds.length} onClick={() => copySelection(contextNodeIds)} role="menuitem">Copy selection <kbd>⌘C</kbd></button>
          <button disabled={!clipboardRef.current?.nodes.length} onClick={pasteSelection} role="menuitem">Paste copy <kbd>⌘V</kbd></button>
          <i />
          <button onClick={() => { insertPrimitive(primitiveDefinitions.find((primitive) => primitive.role === "text")!, contextMenu.flowPosition); setContextMenu(null); }} role="menuitem">Add text</button>
          <button onClick={() => { insertPrimitive(primitiveDefinitions.find((primitive) => primitive.role === "note")!, contextMenu.flowPosition); setContextMenu(null); }} role="menuitem">Add note</button>
          <i />
          <button disabled={contextNodeIds.length < 2} onClick={() => groupSelection(contextNodeIds)} role="menuitem">Group selection</button>
          <button disabled={!canUngroup} onClick={() => ungroupSelection(contextNodeIds)} role="menuitem">Ungroup</button>
          <button disabled={contextNodeIds.length < 2} onClick={() => matchSelectionStyle(contextNodeIds)} role="menuitem">Match selected style</button>
        </div> : null}
        </NodeInlineEditContext.Provider>
        </ContainerLabelMoveContext.Provider>
        </EdgeRouteMoveContext.Provider>
        </EdgeLabelMoveContext.Provider>
        </EdgeCaptionEditContext.Provider>
      </div>
    );
  },
);

export const DiagramCanvas = forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(
  function DiagramCanvas(props, ref) {
    return (
      <ReactFlowProvider>
        <CanvasInner {...props} ref={ref} />
      </ReactFlowProvider>
    );
  },
);
