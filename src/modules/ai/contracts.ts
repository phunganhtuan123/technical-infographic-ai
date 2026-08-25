import { z } from "zod";
import { diagramPlanSchema, edgeDirectionSchema, edgeEffectSchema, edgeSemanticsSchema, edgeStrokeStyleSchema, nodeRoleSchema } from "@/modules/diagram/schema";

export const diagramModeSchema = diagramPlanSchema.shape.mode;
export const aiIntentSchema = z.enum(["new-scene", "modify-current", "modify-selection"]);
export const aiCapabilitySchema = z.enum(["structured_output", "vision", "diagram_plan", "diagram_patch", "streaming"]);

export const aiProviderSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1),
  models: z.array(z.string().min(1)).min(1),
  defaultModel: z.string().min(1),
});

export const gatewayCapabilitiesSchema = z.object({
  capabilities: z.array(aiCapabilitySchema).default([]),
  providers: z.array(aiProviderSchema).default([]),
});

export const gatewayMetadataSchema = z.object({
  organizationId: z.string().min(1),
  issuer: z.string().url().optional(),
  authorizationEndpoint: z.string().url().optional(),
  tokenEndpoint: z.string().url().optional(),
  apiBaseUrl: z.string().url().optional(),
  clientId: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  capabilitiesEndpoint: z.string().url().optional(),
  mock: z.boolean().default(false),
  policyVersion: z.string().default("1"),
});

const nodeChangesSchema = z.object({
  label: z.string().min(1).optional(),
  detail: z.string().optional(),
  caption: z.string().optional(),
  note: z.string().optional(),
  role: nodeRoleSchema.optional(),
  provider: z.string().optional(),
  technology: z.string().optional(),
  color: z.string().optional(),
  textColor: z.string().optional(),
  borderStyle: edgeStrokeStyleSchema.optional(),
  borderWidth: z.number().min(1).max(4).optional(),
  effect: z.enum(["none", "pulse", "trail", "glow", "scan", "breathe"]).optional(),
  speed: z.number().min(0.4).max(6).optional(),
  size: z.object({ width: z.number().min(72).max(1400), height: z.number().min(48).max(900) }).optional(),
}).strict();

const edgeChangesSchema = z.object({
  label: z.string().optional(),
  semantics: edgeSemanticsSchema.optional(),
  direction: edgeDirectionSchema.optional(),
  thickness: z.number().min(1).max(5).optional(),
  color: z.string().optional(),
  strokeStyle: edgeStrokeStyleSchema.optional(),
  effect: edgeEffectSchema.optional(),
  speed: z.number().min(0.4).max(6).optional(),
  animated: z.boolean().optional(),
}).strict();

export const diagramPatchSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("update-node"), id: z.string(), changes: nodeChangesSchema }),
  z.object({ op: z.literal("update-edge"), id: z.string(), changes: edgeChangesSchema }),
  z.object({ op: z.literal("delete-node"), id: z.string() }),
  z.object({ op: z.literal("delete-edge"), id: z.string() }),
  z.object({ op: z.literal("replace-document"), plan: diagramPlanSchema }),
]);

export const diagramProposalSchema = z.object({
  id: z.string().min(1),
  requestId: z.string().min(1),
  intent: aiIntentSchema,
  summary: z.string().min(1),
  explanation: z.string().default(""),
  threadSummary: z.string().default(""),
  confidence: z.number().min(0).max(1).default(1),
  warnings: z.array(z.string()).default([]),
  patches: z.array(diagramPatchSchema).min(1),
});

export type AiIntent = z.infer<typeof aiIntentSchema>;
export type AiCapability = z.infer<typeof aiCapabilitySchema>;
export type AiProvider = z.infer<typeof aiProviderSchema>;
export type GatewayMetadata = z.infer<typeof gatewayMetadataSchema>;
export type DiagramPatch = z.infer<typeof diagramPatchSchema>;
export type DiagramProposal = z.infer<typeof diagramProposalSchema>;

export type AiRequest = {
  requestId: string;
  prompt: string;
  intent: AiIntent;
  mode: "auto" | z.infer<typeof diagramModeSchema>;
  format: "auto" | "full" | "16:9" | "1:1" | "4:5" | "9:16";
  document: unknown;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  threadSummary?: string;
  image?: { mimeType: "image/png" | "image/jpeg" | "image/webp"; dataUrl: string };
  providerId?: "auto" | AiProvider["id"];
  model?: string;
};
