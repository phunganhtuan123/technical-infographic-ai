import { compilePlan } from "@/modules/compiler/compile-plan";
import { diagramPlanSchema, type DiagramDocument, type DiagramFormat, type DiagramScene, type NodeFontFamily, type NodeFontWeight, type NodeTextAlign } from "@/modules/diagram/schema";

const formats = new Set<DiagramFormat>(["full", "16:9", "1:1", "4:5", "9:16"]);
const nodeEffects = new Set(["none", "pulse", "trail", "glow", "scan", "breathe"]);
const nodeFontFamilies = new Set<NodeFontFamily>(["geist-mono", "jetbrains-mono", "ibm-plex-mono", "system-sans"]);
const nodeFontWeights = new Set<NodeFontWeight>([400, 500, 600, 700]);
const nodeTextAlignments = new Set<NodeTextAlign>(["left", "center", "right"]);

function finitePoint(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const point = value as { x?: unknown; y?: unknown };
  return typeof point.x === "number" && Number.isFinite(point.x) && typeof point.y === "number" && Number.isFinite(point.y)
    ? { x: point.x, y: point.y }
    : undefined;
}

function finiteSize(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const size = value as { width?: unknown; height?: unknown };
  return typeof size.width === "number" && size.width > 0 && typeof size.height === "number" && size.height > 0
    ? { width: size.width, height: size.height }
    : undefined;
}

function hydrateDiagram(raw: Record<string, unknown>): DiagramDocument {
  const plan = diagramPlanSchema.parse(raw);
  const compiled = compilePlan(plan);
  const rawNodes = new Map((Array.isArray(raw.nodes) ? raw.nodes : []).map((node) => [(node as { id?: string }).id, node as Record<string, unknown>]));
  const rawEdges = new Map((Array.isArray(raw.edges) ? raw.edges : []).map((edge) => [(edge as { id?: string }).id, edge as Record<string, unknown>]));
  const nodes = compiled.nodes.map((node) => {
    const visual = rawNodes.get(node.id);
    return {
      ...node,
      note: typeof visual?.note === "string" ? visual.note : undefined,
      backgroundImage: typeof visual?.backgroundImage === "string" ? visual.backgroundImage : undefined,
      backgroundOpacity: typeof visual?.backgroundOpacity === "number" ? Math.max(0, Math.min(1, visual.backgroundOpacity)) : node.backgroundOpacity,
      backgroundFit: visual?.backgroundFit === "contain" ? "contain" as const : "cover" as const,
      zIndex: typeof visual?.zIndex === "number" && Number.isFinite(visual.zIndex) ? visual.zIndex : undefined,
      color: typeof visual?.color === "string" ? visual.color : node.color,
      textColor: typeof visual?.textColor === "string" ? visual.textColor : node.textColor,
      fontFamily: typeof visual?.fontFamily === "string" && nodeFontFamilies.has(visual.fontFamily as NodeFontFamily) ? visual.fontFamily as NodeFontFamily : node.fontFamily,
      fontSize: typeof visual?.fontSize === "number" && Number.isFinite(visual.fontSize) ? Math.max(8, Math.min(48, visual.fontSize)) : node.fontSize,
      fontWeight: typeof visual?.fontWeight === "number" && nodeFontWeights.has(visual.fontWeight as NodeFontWeight) ? visual.fontWeight as NodeFontWeight : node.fontWeight,
      textAlign: typeof visual?.textAlign === "string" && nodeTextAlignments.has(visual.textAlign as NodeTextAlign) ? visual.textAlign as NodeTextAlign : node.textAlign,
      borderStyle: visual?.borderStyle === "dashed" || visual?.borderStyle === "dotted" ? visual.borderStyle : node.borderStyle,
      borderWidth: typeof visual?.borderWidth === "number" ? visual.borderWidth : node.borderWidth,
      effect: typeof visual?.effect === "string" && nodeEffects.has(visual.effect) ? visual.effect as typeof node.effect : node.effect,
      speed: typeof visual?.speed === "number" ? visual.speed : node.speed,
      size: finiteSize(visual?.size) ?? node.size,
      position: finitePoint(visual?.position) ?? node.position,
      containerId: typeof visual?.containerId === "string" ? visual.containerId : undefined,
      labelPosition: visual?.labelPosition && typeof visual.labelPosition === "object" ? visual.labelPosition as typeof node.labelPosition : node.labelPosition,
    };
  });
  const edges = compiled.edges.map((edge) => {
    const visual = rawEdges.get(edge.id);
    const routeWaypoints = Array.isArray(visual?.routeWaypoints) ? visual.routeWaypoints.map(finitePoint).filter((point): point is { x: number; y: number } => Boolean(point)) : undefined;
    return {
      ...edge,
      sourcePort: typeof visual?.sourcePort === "string" ? visual.sourcePort as typeof edge.sourcePort : edge.sourcePort,
      targetPort: typeof visual?.targetPort === "string" ? visual.targetPort as typeof edge.targetPort : edge.targetPort,
      animated: typeof visual?.animated === "boolean" ? visual.animated : edge.animated,
      labelOffset: finitePoint(visual?.labelOffset) ?? edge.labelOffset,
      routeWaypoints: routeWaypoints?.length ? routeWaypoints : undefined,
      routeWaypoint: finitePoint(visual?.routeWaypoint),
    };
  });
  return {
    ...compiled,
    workspaceTitle: typeof raw.workspaceTitle === "string" ? raw.workspaceTitle : compiled.title,
    format: typeof raw.format === "string" && formats.has(raw.format as DiagramFormat) ? raw.format as DiagramFormat : "16:9",
    theme: raw.theme && typeof raw.theme === "object" ? raw.theme as DiagramDocument["theme"] : compiled.theme,
    nodes,
    edges,
  };
}

function hydrateScene(raw: unknown): DiagramScene | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const document = hydrateDiagram({ ...value, id: typeof value.id === "string" ? value.id : crypto.randomUUID() });
  return {
    id: typeof value.id === "string" ? value.id : `scene-${crypto.randomUUID()}`,
    name: typeof value.name === "string" ? value.name : document.title,
    mode: document.mode,
    title: document.title,
    purpose: document.purpose,
    nodes: document.nodes,
    edges: document.edges,
  };
}

export function serializeWorkspaceFile(document: DiagramDocument) {
  return JSON.stringify({ kind: "technical-infographic-workspace", version: 1, workspace: document }, null, 2);
}

export function parseWorkspaceFile(contents: string): DiagramDocument {
  const parsed = JSON.parse(contents) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Workspace file must contain a JSON object");
  const envelope = parsed as Record<string, unknown>;
  const raw = (envelope.workspace && typeof envelope.workspace === "object" ? envelope.workspace : envelope) as Record<string, unknown>;
  const document = hydrateDiagram(raw);
  const scenes = Array.isArray(raw.scenes) ? raw.scenes.map(hydrateScene).filter((scene): scene is DiagramScene => Boolean(scene)) : undefined;
  return {
    ...document,
    scenes: scenes?.length ? scenes : undefined,
    activeSceneId: typeof raw.activeSceneId === "string" && scenes?.some((scene) => scene.id === raw.activeSceneId) ? raw.activeSceneId : scenes?.[0]?.id,
  };
}
