import { z } from "zod";
import { edgeColor, roleColors } from "@/modules/catalog/catalog";
import { defaultNodeTypography, defaultPorts, findAvailablePosition } from "@/modules/diagram/factory";
import {
  diagramPlanSchema,
  type DiagramDocument,
  type DiagramPlan,
  type NodeRole,
} from "@/modules/diagram/schema";

export const diagramAiRequestSchema = z.object({
  operation: z.enum(["generate", "modify", "regenerate"]),
  scope: z.enum(["document", "selection"]),
  prompt: z.string().trim().min(2).max(4000),
  document: z.custom<DiagramDocument>(),
  selectedNodeIds: z.array(z.string()).max(50).default([]),
});

export type DiagramAiRequest = z.infer<typeof diagramAiRequestSchema>;

export type DiagramAiResult = {
  plan: DiagramPlan;
  source: "openai" | "local";
  summary: string;
};

export function documentToPlan(document: DiagramDocument): DiagramPlan {
  return diagramPlanSchema.parse({
    id: document.id,
    mode: document.mode,
    title: document.title,
    purpose: document.purpose,
    nodes: document.nodes.map(({ id, label, role, provider, technology, detail, caption, lane }) => ({
      id, label, role, provider, technology, detail, caption, lane,
    })),
    edges: document.edges.map(({ id, from, to, semantics, label, important, direction, thickness, color, strokeStyle, effect, speed }) => ({
      id, from, to, semantics, label, important, direction, thickness, color, strokeStyle, effect, speed,
    })),
  });
}

export function applyPlan(document: DiagramDocument, input: DiagramPlan): DiagramDocument {
  const plan = diagramPlanSchema.parse(input);
  const previous = new Map(document.nodes.map((node) => [node.id, node]));
  let occupied = document.nodes.map((node) => node.position);

  const nodes = plan.nodes.map((node, index) => {
    const existing = previous.get(node.id);
    const position = existing?.position ?? findAvailablePosition(
      { x: 120 + (index % 4) * 252, y: 160 + Math.floor(index / 4) * 136 },
      occupied,
    );
    occupied = [...occupied, position];
    const typography = defaultNodeTypography(node.role);
    return {
      ...node,
      note: existing?.note,
      containerId: existing?.containerId,
      labelPosition: existing?.labelPosition,
      color: existing?.role === node.role ? existing.color : roleColors[node.role],
      textColor: existing?.textColor ?? typography.textColor,
      fontFamily: existing?.fontFamily ?? typography.fontFamily,
      fontSize: existing?.fontSize ?? typography.fontSize,
      fontWeight: existing?.fontWeight ?? typography.fontWeight,
      textAlign: existing?.textAlign ?? typography.textAlign,
      borderStyle: existing?.borderStyle ?? "solid",
      borderWidth: existing?.borderWidth ?? 1,
      effect: existing?.effect ?? "none",
      speed: existing?.speed ?? 2.1,
      size: existing?.size ?? { width: 220, height: 104 },
      ports: existing?.ports ?? defaultPorts,
      position,
    };
  });

  const dataFanout = new Map<string, number>();
  const dataEdgeIndex = new Map<string, number>();
  for (const edge of plan.edges.filter((candidate) => candidate.semantics === "data")) {
    const index = dataFanout.get(edge.from) ?? 0;
    dataEdgeIndex.set(edge.id, index);
    dataFanout.set(edge.from, index + 1);
  }

  return {
    ...document,
    id: plan.id,
    mode: plan.mode,
    title: plan.title,
    purpose: plan.purpose,
    nodes,
    edges: plan.edges.map((edge) => {
      const existing = document.edges.find((candidate) => candidate.id === edge.id);
      const vertical = edge.semantics === "data" || edge.semantics === "event";
      const sideRoute = edge.semantics === "data" && (dataEdgeIndex.get(edge.id) ?? 0) > 0;
      return {
        ...edge,
        direction: edge.direction ?? existing?.direction ?? "forward",
        thickness: edge.thickness ?? existing?.thickness ?? (edge.important ? 1.8 : 1.2),
        color: edge.color ?? existing?.color ?? edgeColor(edge.semantics),
        strokeStyle: edge.strokeStyle ?? existing?.strokeStyle ?? (edge.semantics === "event" || edge.semantics === "feedback" ? "dashed" : "solid"),
        effect: edge.effect ?? existing?.effect ?? "pulse",
        speed: edge.speed ?? existing?.speed ?? (edge.semantics === "event" ? 2.7 : 2.1),
        labelOffset: existing?.labelOffset ?? { x: 0, y: 0 },
        routeWaypoints: existing?.routeWaypoints,
        routeWaypoint: existing?.routeWaypoint,
        sourcePort: sideRoute ? "output" : existing?.sourcePort ?? (vertical ? "data-output" : "output"),
        targetPort: sideRoute ? "input" : existing?.targetPort ?? (vertical ? "data-input" : "input"),
        animated: existing?.animated ?? true,
      };
    }),
  };
}

const roles: Array<[RegExp, NodeRole]> = [
  [/\b(document)\b|tài liệu/i, "document"],
  [/\b(subprocess|subflow)\b|quy trình con/i, "subprocess"],
  [/\b(manual input)\b|nhập thủ công/i, "manual-input"],
  [/\b(delay|timeout|wait)\b|chờ/i, "delay"],
  [/\b(stored data)\b|dữ liệu lưu trữ/i, "stored-data"],
  [/\b(start|begin)\b|bắt đầu/i, "start"],
  [/\b(decision|condition|branch)\b|quyết định|điều kiện/i, "decision"],
  [/\b(input|output)\b|đầu vào|đầu ra/i, "input-output"],
  [/\b(end|finish)\b|kết thúc/i, "end"],
  [/\b(process|step)\b|xử lý/i, "process"],
  [/\b(database|postgres|mysql|db)\b|cơ sở dữ liệu/i, "database"],
  [/\b(cache|redis)\b/i, "cache"],
  [/\b(event bus|queue|kafka|pubsub|stream)\b/i, "event-bus"],
  [/\b(worker|consumer)\b/i, "worker"],
  [/\b(gateway|api gateway)\b/i, "gateway"],
  [/\b(agent)\b/i, "agent"],
  [/\b(model|llm)\b/i, "model"],
  [/\b(tool|terminal|browser|search)\b/i, "tool"],
  [/\b(user|actor)\b|người dùng/i, "actor"],
  [/\b(service|api)\b|dịch vụ/i, "service"],
];

function requestedRole(prompt: string) {
  return roles.find(([pattern]) => pattern.test(prompt))?.[1];
}

function laneFor(role: NodeRole): DiagramPlan["nodes"][number]["lane"] {
  if (role === "actor" || role === "start" || role === "manual-input") return "entry";
  if (role === "event-bus" || role === "worker") return "async";
  if (role === "database" || role === "cache" || role === "stored-data") return "data";
  return "core";
}

function readableRole(role: NodeRole) {
  return role.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export function runLocalCompiler(request: DiagramAiRequest): DiagramAiResult {
  const plan = documentToPlan(request.document);
  const selected = new Set(request.selectedNodeIds);
  const prompt = request.prompt.trim();
  const rename = prompt.match(/(?:rename(?:\s+(?:it|them))?\s+to|đổi tên(?:\s+thành)?|tên là)\s+["“]?(.+?)["”]?$/i);
  const role = requestedRole(prompt);
  const wantsAdd = /\b(add|create|insert)\b|\bthêm\b|\btạo\b/i.test(prompt);
  const wantsDelete = /\b(delete|remove)\b|\bxóa\b/i.test(prompt);

  if (request.scope === "selection" && selected.size > 0) {
    if (wantsDelete) {
      plan.nodes = plan.nodes.filter((node) => !selected.has(node.id));
      plan.edges = plan.edges.filter((edge) => !selected.has(edge.from) && !selected.has(edge.to));
      return { plan, source: "local", summary: `Removed ${selected.size} selected item(s).` };
    }

    if (rename) {
      const label = rename[1].trim().slice(0, 48);
      plan.nodes = plan.nodes.map((node) => selected.has(node.id) ? { ...node, label } : node);
      return { plan, source: "local", summary: `Renamed ${selected.size} selected item(s).` };
    }

    if (role && !wantsAdd) {
      plan.nodes = plan.nodes.map((node) => selected.has(node.id)
        ? { ...node, role, lane: laneFor(role), detail: `${readableRole(role).toLowerCase()} component` }
        : node);
      return { plan, source: "local", summary: `Changed selected item(s) to ${readableRole(role)}.` };
    }
  }

  if (wantsAdd && role) {
    const id = `${role}-${crypto.randomUUID()}`;
    const anchor = request.selectedNodeIds[0] ?? plan.nodes.at(-1)?.id;
    plan.nodes.push({
      id,
      label: rename?.[1].trim().slice(0, 48) || `New ${readableRole(role)}`,
      role,
      detail: `${readableRole(role).toLowerCase()} component`,
      lane: laneFor(role),
    });
    if (anchor) {
      plan.edges.push({
        id: `edge-${crypto.randomUUID()}`,
        from: anchor,
        to: id,
        semantics: role === "database" || role === "cache" ? "data" : role === "worker" || role === "event-bus" ? "event" : "request",
        important: true,
      });
    }
    return { plan, source: "local", summary: `Added ${readableRole(role)}${anchor ? " and connected it" : ""}.` };
  }

  plan.title = request.operation === "regenerate" ? `${plan.title} · regenerated` : plan.title;
  plan.purpose = prompt.slice(0, 140);
  return {
    plan,
    source: "local",
    summary: "Local mock compiler updated the technical story.",
  };
}
