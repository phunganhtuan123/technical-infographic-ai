import { diagramTheme, nodeInk, roleColors, technologyDetails, technologyOptions } from "@/modules/catalog/catalog";
import type {
  DiagramDocument,
  DiagramNode,
  DiagramPort,
  NodeFontFamily,
  NodeFontWeight,
  NodeRole,
  NodeTextAlign,
} from "./schema";

export type PrimitiveDefinition = {
  label: string;
  role: NodeRole;
  detail: string;
  lane: DiagramNode["lane"];
  size?: DiagramNode["size"];
  technology?: string;
  provider?: string;
};

const basePrimitiveDefinitions: PrimitiveDefinition[] = [
  { label: "Start", role: "start", detail: "flow entry", lane: "entry" },
  { label: "Process", role: "process", detail: "flow step", lane: "core" },
  { label: "Decision", role: "decision", detail: "branch condition", lane: "core" },
  { label: "Input / Output", role: "input-output", detail: "data in or out", lane: "core" },
  { label: "End", role: "end", detail: "flow completion", lane: "core" },
  { label: "Document", role: "document", detail: "document output", lane: "core" },
  { label: "Subprocess", role: "subprocess", detail: "named subflow", lane: "core" },
  { label: "Manual input", role: "manual-input", detail: "operator input", lane: "entry" },
  { label: "Preparation", role: "preparation", detail: "initialization step", lane: "core" },
  { label: "Delay", role: "delay", detail: "wait or timeout", lane: "core" },
  { label: "Connector", role: "connector", detail: "same-page connector", lane: "core" },
  { label: "Off-page", role: "off-page", detail: "off-page connector", lane: "core" },
  { label: "Merge", role: "merge", detail: "merge paths", lane: "core" },
  { label: "Stored data", role: "stored-data", detail: "stored information", lane: "data" },
  { label: "Zone", role: "zone", detail: "architecture boundary", lane: "core", size: { width: 520, height: 300 } },
  { label: "Group", role: "group", detail: "visual component group", lane: "core", size: { width: 440, height: 260 } },
  { label: "Text", role: "text", detail: "free canvas text", lane: "core", size: { width: 240, height: 72 } },
  { label: "Note", role: "note", detail: "engineering note", lane: "core", size: { width: 240, height: 136 } },
  { label: "User", role: "actor", detail: "system actor", lane: "entry" },
  { label: "Gateway", role: "gateway", detail: "request boundary", lane: "core" },
  { label: "Service", role: "service", detail: "application service", lane: "core" },
  { label: "Event bus", role: "event-bus", detail: "async channel", lane: "async" },
  { label: "Worker", role: "worker", detail: "event consumer", lane: "async" },
  { label: "Database", role: "database", detail: "persistent data", lane: "data" },
  { label: "Cache", role: "cache", detail: "hot reads", lane: "data" },
  { label: "Agent", role: "agent", detail: "reasoning core", lane: "core" },
];

function technologyRole(category: string): NodeRole {
  if (category === "database" || category === "storage") return "database";
  if (category === "cache") return "cache";
  if (category === "messaging") return "event-bus";
  if (category === "auth" || category === "network" || category === "api") return "gateway";
  if (category === "observability" || category === "infrastructure") return "tool";
  return "service";
}

function technologyLane(category: string): DiagramNode["lane"] {
  if (category === "database" || category === "storage" || category === "cache" || category === "analytics") return "data";
  if (category === "messaging") return "async";
  return "core";
}

export const primitiveDefinitions: PrimitiveDefinition[] = [
  ...basePrimitiveDefinitions,
  ...technologyOptions.map((technology) => ({
    label: technology.label,
    role: technologyRole(technology.category),
    detail: technology.category,
    lane: technologyLane(technology.category),
    technology: technology.id,
    provider: technology.id.startsWith("aws-") ? "AWS" : technology.id.startsWith("gcp-") ? "GCP" : undefined,
  })),
];

export const defaultPorts: DiagramPort[] = [
  { id: "input", side: "left" },
  { id: "output", side: "right" },
  { id: "top-center", side: "top" },
  { id: "event-input", side: "top" },
  { id: "event-input-bottom", side: "bottom" },
  { id: "event-output", side: "bottom" },
  { id: "data-input", side: "top" },
  { id: "data-output", side: "bottom" },
];

export function defaultNodeTypography(role: NodeRole): {
  textColor: string;
  fontFamily: NodeFontFamily;
  fontSize: number;
  fontWeight: NodeFontWeight;
  textAlign: NodeTextAlign;
} {
  return {
    textColor: nodeInk,
    fontFamily: "geist-mono",
    fontSize: role === "text" ? 18 : role === "note" ? 13 : role === "zone" || role === "group" ? 10 : 14,
    fontWeight: role === "zone" || role === "group" ? 600 : 700,
    textAlign: role === "start" || role === "process" || role === "decision" || role === "input-output" || role === "end" || role === "document" || role === "subprocess" || role === "manual-input" || role === "preparation" || role === "delay" || role === "connector" || role === "off-page" || role === "merge" || role === "stored-data" ? "center" : "left",
  };
}

export function createDiagramNode(
  primitive: PrimitiveDefinition,
  position: DiagramNode["position"],
  id: string,
): DiagramNode {
  return {
    id,
    label: primitive.label,
    role: primitive.role,
    detail: primitive.detail,
    technology: primitive.technology,
    provider: primitive.provider,
    lane: primitive.lane,
    color: technologyDetails(primitive.technology)?.color ?? roleColors[primitive.role],
    ...defaultNodeTypography(primitive.role),
    borderStyle: "solid",
    borderWidth: 1,
    effect: "none",
    speed: 2.1,
    backgroundOpacity: 0.28,
    backgroundFit: "cover",
    size: primitive.size ?? { width: 220, height: 104 },
    labelPosition: primitive.role === "zone" || primitive.role === "group" ? { side: "top", offset: 0.16 } : undefined,
    ports: defaultPorts,
    position,
  };
}

export function createBlankDocument(id: string, title: string): DiagramDocument {
  return {
    id,
    mode: "architecture",
    title,
    purpose: "Drag a primitive onto the canvas to start a technical story.",
    nodes: [],
    edges: [],
    theme: { ...diagramTheme },
    format: "16:9",
  };
}

export function findAvailablePosition(
  origin: DiagramNode["position"],
  occupied: DiagramNode["position"][],
): DiagramNode["position"] {
  const stepX = 252;
  const stepY = 136;
  const isFree = (candidate: DiagramNode["position"]) => occupied.every((position) =>
    Math.abs(candidate.x - position.x) >= stepX || Math.abs(candidate.y - position.y) >= stepY,
  );

  for (let radius = 0; radius <= 8; radius += 1) {
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue;
        const candidate = { x: origin.x + x * stepX, y: origin.y + y * stepY };
        if (isFree(candidate)) return candidate;
      }
    }
  }
  return { x: origin.x, y: origin.y + (occupied.length + 1) * stepY };
}
