import { z } from "zod";

export const nodeRoleSchema = z.enum([
  "actor",
  "gateway",
  "service",
  "event-bus",
  "worker",
  "database",
  "cache",
  "agent",
  "tool",
  "model",
  "start",
  "process",
  "decision",
  "input-output",
  "end",
  "document",
  "subprocess",
  "manual-input",
  "preparation",
  "delay",
  "connector",
  "off-page",
  "merge",
  "stored-data",
  "zone",
  "group",
  "text",
  "note",
]);

export const edgeSemanticsSchema = z.enum([
  "request",
  "event",
  "data",
  "feedback",
  "success",
  "failure",
]);

export const edgeDirectionSchema = z.enum(["forward", "reverse", "both", "none"]);
export const edgeStrokeStyleSchema = z.enum(["solid", "dashed", "dotted"]);
export const edgeEffectSchema = z.enum(["pulse", "trail", "glow", "dash", "signal"]);

export const diagramPlanSchema = z.object({
  id: z.string(),
  mode: z.enum([
    "architecture",
    "flow",
    "sequence",
    "data-pipeline",
    "event-driven",
    "agent-loop",
    "infrastructure",
    "comparison",
    "explainer-grid",
  ]),
  title: z.string().min(1),
  purpose: z.string().min(1),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string().min(1),
      role: nodeRoleSchema,
      provider: z.string().optional(),
      technology: z.string().optional(),
      detail: z.string().optional(),
      caption: z.string().optional(),
      lane: z.enum(["entry", "core", "async", "data"]).default("core"),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      semantics: edgeSemanticsSchema,
      label: z.string().optional(),
      important: z.boolean().default(false),
      direction: edgeDirectionSchema.optional(),
      thickness: z.number().min(1).max(5).optional(),
      color: z.string().optional(),
      strokeStyle: edgeStrokeStyleSchema.optional(),
      effect: edgeEffectSchema.optional(),
      speed: z.number().min(0.4).max(6).optional(),
    }),
  ),
});

export type DiagramPlan = z.infer<typeof diagramPlanSchema>;
export type NodeRole = z.infer<typeof nodeRoleSchema>;
export type EdgeSemantics = z.infer<typeof edgeSemanticsSchema>;
export type EdgeDirection = z.infer<typeof edgeDirectionSchema>;
export type EdgeStrokeStyle = z.infer<typeof edgeStrokeStyleSchema>;
export type EdgeEffect = z.infer<typeof edgeEffectSchema>;

export type DiagramPort = {
  id: "input" | "output" | "top-center" | "event-input" | "event-input-bottom" | "event-output" | "data-input" | "data-output";
  side: "top" | "right" | "bottom" | "left";
};

export type DiagramFormat = "full" | "16:9" | "1:1" | "4:5" | "9:16";
export type NodeEffect = "none" | "pulse" | "trail" | "glow" | "scan" | "breathe";
export type NodeFontFamily = "geist-mono" | "jetbrains-mono" | "ibm-plex-mono" | "system-sans";
export type NodeFontWeight = 400 | 500 | 600 | 700;
export type NodeTextAlign = "left" | "center" | "right";

export type DiagramNode = DiagramPlan["nodes"][number] & {
  previewStatus?: "added" | "modified" | "deleted";
  note?: string;
  backgroundImage?: string;
  backgroundOpacity?: number;
  backgroundFit?: "cover" | "contain";
  zIndex?: number;
  color: string;
  textColor: string;
  fontFamily: NodeFontFamily;
  fontSize: number;
  fontWeight: NodeFontWeight;
  textAlign: NodeTextAlign;
  borderStyle: EdgeStrokeStyle;
  borderWidth: number;
  effect: NodeEffect;
  speed: number;
  size: { width: number; height: number };
  ports: DiagramPort[];
  position: { x: number; y: number };
  containerId?: string;
  labelPosition?: { side: "top" | "right" | "bottom" | "left"; offset: number };
};

export type DiagramEdge = DiagramPlan["edges"][number] & {
  previewStatus?: "added" | "modified" | "deleted";
  sourcePort: DiagramPort["id"];
  targetPort: DiagramPort["id"];
  animated: boolean;
  direction: EdgeDirection;
  thickness: number;
  color: string;
  strokeStyle: EdgeStrokeStyle;
  effect: EdgeEffect;
  speed: number;
  labelOffset: { x: number; y: number };
  routeWaypoints?: Array<{ x: number; y: number }>;
  /** Legacy single control point kept for saved workspace compatibility. */
  routeWaypoint?: { x: number; y: number };
};

export type DiagramScene = {
  id: string;
  name: string;
  mode: DiagramPlan["mode"];
  title: string;
  purpose: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

export type DiagramDocument = {
  id: string;
  workspaceTitle?: string;
  mode: DiagramPlan["mode"];
  title: string;
  purpose: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  theme: { background: string; accent: string };
  format?: DiagramFormat;
  scenes?: DiagramScene[];
  activeSceneId?: string;
};
