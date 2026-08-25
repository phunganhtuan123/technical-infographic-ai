import { roleColors } from "@/modules/catalog/catalog";
import {
  diagramPlanSchema,
  type DiagramDocument,
  type DiagramEdge,
  type DiagramPlan,
} from "@/modules/diagram/schema";
import { defaultNodeTypography, defaultPorts } from "@/modules/diagram/factory";

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
    effect: edge.effect ?? "pulse",
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
      effect: "none",
      speed: 2.1,
      size: node.role === "zone" ? { width: 520, height: 300 } : node.role === "group" ? { width: 440, height: 260 } : node.role === "text" ? { width: 240, height: 72 } : node.role === "note" ? { width: 240, height: 136 } : { width: 220, height: 104 },
      labelPosition: node.role === "zone" || node.role === "group" ? { side: "top", offset: 0.16 } : undefined,
      ports: defaultPorts,
      position: { x: 0, y: 0 },
    })),
    edges: plan.edges.map((edge) => compileEdge(edge, lanes, fanoutIndexes.get(edge.id) ?? 0)),
    theme: { background: "#080808", accent: "#b6ff5c" },
  };
}
