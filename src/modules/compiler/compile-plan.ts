import { roleColors } from "@/modules/catalog/catalog";
import {
  diagramPlanSchema,
  type DiagramDocument,
  type DiagramEdge,
  type DiagramPlan,
  type EdgeEffect,
  type NodeEffect,
} from "@/modules/diagram/schema";
import { defaultNodeTypography, defaultPorts } from "@/modules/diagram/factory";

// Motion carries meaning here, so it is derived rather than uniform: a reader
// should be able to tell a queue from a datastore, or a fire-and-forget event
// from a synchronous call, without reading a single label. Anything the plan
// states explicitly still wins — these are only the defaults.

/** What a component does decides how it moves. */
function nodeEffect(role: DiagramPlan["nodes"][number]["role"]): NodeEffect {
  switch (role) {
    // Containers and annotations frame the diagram; animating them is noise.
    case "zone": case "group": case "text": case "note":
      return "none";
    // Where the story enters or leaves — a slow swell, not a heartbeat.
    case "actor": case "start": case "end": case "manual-input": case "input-output": case "off-page":
      return "breathe";
    // Things that hold state sit still and glow rather than move.
    case "database": case "cache": case "stored-data": case "document":
      return "glow";
    // Work happening out of band reads as a sweep.
    case "worker": case "event-bus": case "agent": case "delay": case "connector": case "merge":
      return "scan";
    // The synchronous path beats.
    default:
      return "pulse";
  }
}

/** What a connection means decides how it moves. */
function edgeEffect(semantics: DiagramPlan["edges"][number]["semantics"]): EdgeEffect {
  switch (semantics) {
    case "event": return "dash";      // fire-and-forget: marching, not travelling
    case "data": return "trail";      // a read or write leaves a wake
    case "feedback": return "signal"; // something coming back
    case "failure": return "dash";
    default: return "pulse";          // request and success: a travelling beat
  }
}

function compileEdge(
  edge: DiagramPlan["edges"][number],
  lanes: Map<string, DiagramPlan["nodes"][number]["lane"]>,
  fanoutIndex: number,
): DiagramEdge {
  const color = edge.color ?? (edge.semantics === "event" ? "#fbbf24" : edge.semantics === "data" || edge.semantics === "feedback" ? "#a78bfa" : edge.semantics === "failure" ? "#fb7185" : "#b6ff5c");
  const visual = {
    direction: edge.direction ?? "forward",
    thickness: edge.thickness ?? (edge.important ? 1.8 : 1.2),
    color,
    strokeStyle: edge.strokeStyle ?? (edge.semantics === "event" || edge.semantics === "feedback" ? "dashed" : "solid"),
    effect: edge.effect ?? edgeEffect(edge.semantics),
    speed: edge.speed ?? (edge.semantics === "event" ? 2.7 : 2.1),
    labelOffset: { x: 0, y: 0 },
  } as const;
  if (edge.semantics === "event" && lanes.get(edge.from) !== lanes.get(edge.to)) {
    return { ...edge, ...visual, sourcePort: "event-output", targetPort: "event-input", animated: true };
  }
  if (edge.semantics === "event") {
    if (fanoutIndex > 0) {
      return { ...edge, ...visual, sourcePort: "event-output", targetPort: "event-input-bottom", animated: true };
    }
    return { ...edge, ...visual, sourcePort: "output", targetPort: "input", animated: true };
  }
  if (edge.semantics === "feedback") {
    return { ...edge, ...visual, sourcePort: "event-output", targetPort: "event-input", animated: true };
  }
  if (edge.semantics === "data") {
    return { ...edge, ...visual, sourcePort: "data-output", targetPort: "data-input", animated: false };
  }
  return { ...edge, ...visual, sourcePort: "output", targetPort: "input", animated: edge.important };
}

export function compilePlan(input: DiagramPlan): DiagramDocument {
  const plan = diagramPlanSchema.parse(input);
  const nodeIds = new Set(plan.nodes.map((node) => node.id));
  const lanes = new Map(plan.nodes.map((node) => [node.id, node.lane]));
  const fanoutCounts = new Map<string, number>();
  const fanoutIndexes = new Map<string, number>();

  for (const edge of plan.edges) {
    if (edge.semantics !== "event" || lanes.get(edge.from) !== lanes.get(edge.to)) continue;
    const index = fanoutCounts.get(edge.from) ?? 0;
    fanoutIndexes.set(edge.id, index);
    fanoutCounts.set(edge.from, index + 1);
  }

  for (const edge of plan.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`Edge ${edge.id} references an unknown node`);
    }
  }

  return {
    id: plan.id,
    mode: plan.mode,
    title: plan.title,
    purpose: plan.purpose,
    nodes: plan.nodes.map((node) => ({
      ...node,
      color: roleColors[node.role],
      ...defaultNodeTypography(node.role),
      borderStyle: "solid",
      borderWidth: 1,
      effect: node.effect ?? nodeEffect(node.role),
      // Async work reads better a touch quicker than the synchronous path.
      speed: node.speed ?? (node.lane === "async" ? 2.6 : 2.1),
      size: node.role === "zone" ? { width: 520, height: 300 } : node.role === "group" ? { width: 440, height: 260 } : node.role === "text" ? { width: 240, height: 72 } : node.role === "note" ? { width: 240, height: 136 } : { width: 220, height: 104 },
      labelPosition: node.role === "zone" || node.role === "group" ? { side: "top", offset: 0.16 } : undefined,
      ports: defaultPorts,
      position: { x: 0, y: 0 },
    })),
    edges: plan.edges.map((edge) => compileEdge(edge, lanes, fanoutIndexes.get(edge.id) ?? 0)),
    theme: { background: "#080808", accent: "#b6ff5c" },
  };
}
