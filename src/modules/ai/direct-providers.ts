// Direct browser → provider calls
// ---------------------------------------------------------------------------
// The connector exists because a CLI login can only be read by a process on the
// machine that holds it. An API key has no such constraint: all three provider
// APIs answer CORS preflights from a browser, so the page can call them itself.
//
//   browser --(user's own key)--> api.anthropic.com | googleapis.com | api.openai.com
//
// That removes the install step for anyone who has a key. The key is the user's,
// stays in their browser, and never reaches this application's server — the same
// property the connector was built to preserve, reached a different way.
// ---------------------------------------------------------------------------

import { diagramProposalSchema, type AiCapability, type AiProvider, type AiRequest, type DiagramProposal } from "./contracts";
import type { AiConnector, AiProgress } from "./gateway";

export type DirectProviderId = "anthropic-api" | "gemini" | "openai";

const ANTHROPIC_API = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const OPENAI_API = "https://api.openai.com/v1";

// ------------------------------------------------------------------ schemas
// Written out as literal JSON Schema rather than derived from the zod plan
// schema: each provider takes a different dialect subset, and the browser
// re-validates the result with zod anyway, so drift is caught downstream.

const NODE_ROLES = [
  "actor", "gateway", "service", "event-bus", "worker", "database", "cache",
  "agent", "tool", "model", "start", "process", "decision", "input-output",
  "end", "document", "subprocess", "manual-input", "preparation", "delay",
  "connector", "off-page", "merge", "stored-data", "zone", "group", "text", "note",
];
const EDGE_SEMANTICS = ["request", "event", "data", "feedback", "success", "failure"];
const LANES = ["entry", "core", "async", "data"];
const MODES = [
  "architecture", "flow", "sequence", "data-pipeline", "event-driven",
  "agent-loop", "infrastructure", "comparison", "explainer-grid",
];

export const planJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "title", "purpose", "nodes", "edges"],
  properties: {
    mode: { type: "string", enum: MODES },
    title: { type: "string", description: "Short diagram title, under 60 characters." },
    purpose: { type: "string", description: "One sentence on what the diagram explains." },
    nodes: {
      type: "array", minItems: 2, maxItems: 24,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "label", "role", "lane"],
        properties: {
          id: { type: "string", description: "Short stable slug, lowercase, no spaces." },
          label: { type: "string" },
          role: { type: "string", enum: NODE_ROLES },
          lane: { type: "string", enum: LANES, description: "entry for inputs and actors, core for the main path, async for queues and workers, data for stores." },
          detail: { type: "string", description: "Up to six words of supporting detail." },
          caption: { type: "string" },
          technology: { type: "string", description: "Optional simple-icons slug, e.g. postgresql, kafka, vercel." },
        },
      },
    },
    edges: {
      type: "array", maxItems: 40,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "from", "to", "semantics"],
        properties: {
          id: { type: "string" },
          from: { type: "string", description: "Must match a node id." },
          to: { type: "string", description: "Must match a node id." },
          semantics: { type: "string", enum: EDGE_SEMANTICS },
          label: { type: "string", description: "Two or three words at most." },
          important: { type: "boolean" },
        },
      },
    },
  },
} as const;

export const selectionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["nodes"],
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          detail: { type: "string" },
          caption: { type: "string" },
          note: { type: "string" },
          role: { type: "string", enum: NODE_ROLES },
          technology: { type: "string" },
        },
      },
    },
  },
} as const;

export const systemPrompt = `You design technical diagrams for engineers. You emit structured diagram data only — never prose, code, SVG paths, CSS or coordinates. Layout is decided by a deterministic compiler downstream, so you choose semantics, not positions.

Rules that matter:
- Give every node a lane. entry is for actors and inbound edges of the system, core is the main synchronous path, async is for queues, buses and workers, data is for stores and caches.
- Pick the role that matches what the thing is, not what it looks like. A queue is event-bus, a table is database, a branch is decision.
- Mark the edges on the primary path important: true. Leave secondary and failure paths false.
- Use edge semantics honestly: request for synchronous calls, event for fire-and-forget, data for persistence and reads, feedback for callbacks, success and failure for branch outcomes.
- Keep labels short. A node label is a name, not a sentence. detail is at most six words.
- Node ids are lowercase slugs and every edge from/to must match one.
- Prefer 5 to 12 nodes. Merge detail into fewer nodes rather than sprawling.

Flowcharts and algorithms:
When the request is a procedure, an algorithm or a decision flow rather than a
system architecture, use mode "flow" and the flowchart roles. They carry the
house style, which the renderer paints for you — you never emit a colour:
- start and end — the entry and exit of the procedure. Both render green.
- decision — any branch or condition. Renders as an orange diamond.
- process — a computation or transformation step. Renders light blue.
- input-output — where a result is produced or handed back. Renders light violet.
Leave every other role for the things they actually name (subprocess, delay,
manual-input, stored-data, document, merge).

Every decision node must have exactly two outgoing edges, one with semantics
"success" and one with "failure", and each one labelled with the condition it
takes — "yes"/"no", or the comparison itself. A branch whose arms are not
labelled is unreadable.

Keeping the picture clean:
- Connectors must not cross. The layout orders nodes by what they connect to, so
  you keep it solvable: emit the nodes in the order they are reached, connect
  each node to the next one in that order, and do not jump backwards or skip
  ahead unless the logic truly loops.
- One idea per node. A node that needs "and" in its label is two nodes.
- Do not fan more than three edges out of a single node.

Mathematics:
Write formulas in LaTeX between dollar signs and they are typeset properly:
"$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$" in a label or detail renders as real
mathematics. Use $...$ for anything with a fraction, root, exponent, subscript,
sum or integral — never fake it with slashes or ^ in plain text, and never
describe a formula in words when you can write it. Escape a literal dollar sign
as \\$.`;

// -------------------------------------------------------------------- utils

/** Pull the first balanced JSON object out of loose model output. */
export function extractJson(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf("{");
  if (start === -1) throw new Error("The model returned no JSON object");
  let depth = 0, inString = false, escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\") { escaped = true; continue; }
    if (character === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new Error("The model returned a truncated JSON object");
}

function splitDataUrl(dataUrl?: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl ?? "");
  return match ? { mediaType: match[1], data: match[2] } : undefined;
}

type DiagramNode = { id: string; role?: string; lane?: string; label?: string; detail?: string };
type DiagramEdge = { id: string; from: string; to: string; semantics?: string; label?: string };
type LooseDocument = { title?: string; mode?: string; nodes?: DiagramNode[]; edges?: DiagramEdge[] };

function describeDocument(document: unknown) {
  const doc = (document ?? {}) as LooseDocument;
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  const edges = Array.isArray(doc.edges) ? doc.edges : [];
  if (!nodes.length) return "(empty canvas)";
  return [
    `title: ${doc.title ?? "untitled"}`,
    `mode: ${doc.mode ?? "architecture"}`,
    "nodes:",
    ...nodes.map((node) => `  ${node.id} | ${node.role} | ${node.lane ?? "core"} | ${node.label}${node.detail ? ` — ${node.detail}` : ""}`),
    "edges:",
    ...edges.map((edge) => `  ${edge.id} | ${edge.from} -> ${edge.to} | ${edge.semantics}${edge.label ? ` | ${edge.label}` : ""}`),
  ].join("\n");
}

export function buildUserText(request: AiRequest) {
  const context: string[] = [];
  if (request.mode && request.mode !== "auto") context.push(`Requested diagram mode: ${request.mode}.`);
  if (request.format && request.format !== "auto") context.push(`Canvas format: ${request.format} — keep the node count suited to that shape.`);
  if (request.threadSummary) context.push(`Earlier in this session: ${request.threadSummary}`);

  if (request.intent === "modify-selection") {
    const doc = (request.document ?? {}) as LooseDocument;
    const selected = (doc.nodes ?? []).filter((node) => request.selectedNodeIds.includes(node.id));
    context.push(`Change only these selected components, leave everything else alone:\n${selected.map((node) => `  ${node.id} | ${node.role} | ${node.label}`).join("\n")}`);
  } else if (request.intent === "modify-current") {
    context.push(`Rewrite the current diagram to satisfy the request. Reuse node ids where the component survives.\n\nCurrent diagram:\n${describeDocument(request.document)}`);
  }

  return `${request.prompt}\n\n${context.join("\n\n")}`.trim();
}

// ----------------------------------------------------------------- backends

type CompleteInput = {
  system: string;
  userText: string;
  image?: AiRequest["image"];
  schema: object;
  schemaName: string;
  model: string;
  signal: AbortSignal;
};

type DirectBackend = {
  id: DirectProviderId;
  label: string;
  listModels(): Promise<string[]>;
  complete(input: CompleteInput): Promise<Record<string, unknown>>;
};

async function failure(response: Response, provider: string): Promise<never> {
  const detail = await response.text().catch(() => "");
  // Google answers a bad key with 400, not 401, so status alone would report it
  // as a malformed request and send the user looking in the wrong place.
  const rejected = response.status === 401 || response.status === 403
    || (response.status === 400 && /api[_ ]?key[^"]*(not valid|invalid)|API_KEY_INVALID/i.test(detail));
  if (rejected) throw new Error(`That ${provider} key was rejected.`);
  if (response.status === 429) throw new Error(`${provider} rate limit or quota reached — check your account.`);
  throw new Error(`${provider} request failed (${response.status}): ${detail.slice(0, 240)}`);
}

function anthropicBackend(apiKey: string): DirectBackend {
  // Anthropic requires an explicit opt-in header before it will answer a
  // browser; without it the request is refused even though CORS would allow it.
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
    "content-type": "application/json",
  };

  return {
    id: "anthropic-api",
    label: "Claude (API key)",
    async listModels() {
      const response = await fetch(`${ANTHROPIC_API}/models?limit=50`, { headers });
      if (!response.ok) await failure(response, "Claude");
      const body = await response.json();
      const models = (body.data ?? []).map((model: { id?: string }) => model.id).filter((id: unknown): id is string => typeof id === "string");
      return models.length ? models : ["claude-opus-5"];
    },
    async complete({ system, userText, image, schema, schemaName, model, signal }) {
      const picture = splitDataUrl(image?.dataUrl);
      const content: unknown[] = [];
      if (picture) content.push({ type: "image", source: { type: "base64", media_type: picture.mediaType, data: picture.data } });
      content.push({ type: "text", text: userText });

      const response = await fetch(`${ANTHROPIC_API}/messages`, {
        method: "POST", headers, signal,
        body: JSON.stringify({
          model, max_tokens: 8000, system,
          tools: [{ name: schemaName, description: "Return the structured diagram data.", input_schema: schema }],
          tool_choice: { type: "tool", name: schemaName },
          messages: [{ role: "user", content }],
        }),
      });
      if (!response.ok) await failure(response, "Claude");
      const body = await response.json();
      const call = (body.content ?? []).find((block: { type?: string }) => block.type === "tool_use");
      if (!call) throw new Error("Claude returned no structured diagram");
      return call.input;
    },
  };
}

/**
 * Gemini takes an OpenAPI subset, not full JSON Schema: `additionalProperties`
 * makes it reject the request outright.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties" || key === "$schema") continue;
    out[key] = toGeminiSchema(value);
  }
  return out;
}

function geminiBackend(apiKey: string): DirectBackend {
  return {
    id: "gemini",
    label: "Gemini (API key)",
    async listModels() {
      const response = await fetch(`${GEMINI_API}/models?key=${encodeURIComponent(apiKey)}&pageSize=100`);
      if (!response.ok) await failure(response, "Gemini");
      const body = await response.json();
      const models = (body.models ?? [])
        .filter((model: { supportedGenerationMethods?: string[] }) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((model: { name?: string }) => String(model.name ?? "").replace(/^models\//, ""))
        .filter((name: string) => name.startsWith("gemini"));
      return models.length ? models : ["gemini-2.5-flash"];
    },
    async complete({ system, userText, image, schema, model, signal }) {
      const picture = splitDataUrl(image?.dataUrl);
      const parts: unknown[] = [];
      if (picture) parts.push({ inline_data: { mime_type: picture.mediaType, data: picture.data } });
      parts.push({ text: userText });

      const response = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST", headers: { "content-type": "application/json" }, signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType: "application/json", responseSchema: toGeminiSchema(schema), temperature: 0.2 },
        }),
      });
      if (!response.ok) await failure(response, "Gemini");
      const body = await response.json();
      const text = (body.candidates?.[0]?.content?.parts ?? []).map((part: { text?: string }) => part.text ?? "").join("");
      if (!text.trim()) throw new Error("Gemini returned no content");
      return extractJson(text);
    },
  };
}

function openAiBackend(apiKey: string): DirectBackend {
  const headers = { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" };

  return {
    id: "openai",
    label: "OpenAI (API key)",
    async listModels() {
      const response = await fetch(`${OPENAI_API}/models`, { headers });
      if (!response.ok) await failure(response, "OpenAI");
      const body = await response.json();
      const models = (body.data ?? [])
        .map((model: { id?: string }) => model.id)
        .filter((id: unknown): id is string => typeof id === "string" && /^(gpt|o\d)/.test(id))
        .sort();
      return models.length ? models : ["gpt-4o"];
    },
    async complete({ system, userText, image, schema, schemaName, model, signal }) {
      const content: unknown[] = [{ type: "text", text: userText }];
      if (image) content.push({ type: "image_url", image_url: { url: image.dataUrl } });

      const response = await fetch(`${OPENAI_API}/chat/completions`, {
        method: "POST", headers, signal,
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content }],
          response_format: { type: "json_schema", json_schema: { name: schemaName, schema, strict: false } },
        }),
      });
      if (!response.ok) await failure(response, "OpenAI");
      const body = await response.json();
      return extractJson(body.choices?.[0]?.message?.content ?? "");
    },
  };
}

const backendFactories: Record<DirectProviderId, (apiKey: string) => DirectBackend> = {
  "anthropic-api": anthropicBackend,
  gemini: geminiBackend,
  openai: openAiBackend,
};

export function directProviderLabel(provider: DirectProviderId) {
  return backendFactories[provider]("").label;
}

/** Confirm a key authenticates before it is accepted, so a bad paste fails where it was pasted. */
export async function validateDirectKey(provider: DirectProviderId, apiKey: string) {
  return backendFactories[provider](apiKey).listModels();
}

// ---------------------------------------------------------------- connector

export class BrowserKeyConnector implements AiConnector {
  capabilities = new Set<AiCapability>(["structured_output", "vision", "diagram_plan", "diagram_patch"]);
  providers: AiProvider[];
  private backend: DirectBackend;

  constructor(provider: DirectProviderId, private apiKey: string, models: string[]) {
    this.backend = backendFactories[provider](apiKey);
    this.providers = [{ id: provider, label: this.backend.label, models, defaultModel: models[0] }];
  }

  async generate(request: AiRequest, signal: AbortSignal, onProgress: (progress: AiProgress) => void): Promise<DiagramProposal> {
    onProgress("Understanding input");
    const selection = request.intent === "modify-selection";
    const model = request.model && request.model !== "auto" ? request.model : this.providers[0].defaultModel;

    const result = await this.backend.complete({
      system: systemPrompt,
      userText: buildUserText(request),
      image: request.image,
      schema: selection ? selectionJsonSchema : planJsonSchema,
      schemaName: selection ? "emit_selection_changes" : "emit_diagram_plan",
      model, signal,
    });

    onProgress("Validating proposal");

    if (selection) {
      const allowed = new Set(request.selectedNodeIds);
      const patches = ((result.nodes as DiagramNode[]) ?? [])
        .filter((node) => allowed.has(node.id))
        .map(({ id, ...changes }) => ({ op: "update-node" as const, id, changes }))
        .filter((patch) => Object.keys(patch.changes).length > 0);
      if (!patches.length) throw new Error("The model proposed no change inside the selection");
      return diagramProposalSchema.parse({
        id: `proposal-${crypto.randomUUID()}`,
        requestId: request.requestId,
        intent: request.intent,
        summary: `Updated ${patches.length} selected component${patches.length === 1 ? "" : "s"}`,
        explanation: "Only the components captured in the selection were changed.",
        threadSummary: request.prompt.slice(0, 240),
        confidence: 0.9, warnings: [], patches,
      });
    }

    const nodes = (result.nodes as DiagramNode[]) ?? [];
    if (!Array.isArray(nodes) || nodes.length < 2) throw new Error("The model returned a diagram with no components");
    const nodeIds = new Set(nodes.map((node) => node.id));
    const warnings: string[] = [];
    const edges = (((result.edges as DiagramEdge[]) ?? [])).filter((edge) => {
      const valid = nodeIds.has(edge.from) && nodeIds.has(edge.to);
      if (!valid) warnings.push(`Dropped connection ${edge.from} → ${edge.to}: unknown component.`);
      return valid;
    });
    if (request.image) warnings.push("Image interpretation should be reviewed before accepting.");

    return diagramProposalSchema.parse({
      id: `proposal-${crypto.randomUUID()}`,
      requestId: request.requestId,
      intent: request.intent,
      summary: result.title,
      explanation: result.purpose,
      threadSummary: request.prompt.slice(0, 240),
      confidence: 0.9, warnings,
      patches: [{ op: "replace-document", plan: { ...result, id: `plan-${crypto.randomUUID()}`, edges } }],
    });
  }
}

// ------------------------------------------------------------- key storage
// The key belongs to the person using the browser, and only their browser ever
// sees it. Persisting it beats re-pasting on every reload; "Forget" clears it.

const keyPrefix = "technical-infographic-provider-key:";
const activeProviderKey = "technical-infographic-active-direct-provider";

export function savedDirectKey(provider: DirectProviderId) {
  return typeof window === "undefined" ? undefined : localStorage.getItem(`${keyPrefix}${provider}`) ?? undefined;
}

export function saveDirectKey(provider: DirectProviderId, apiKey: string) {
  localStorage.setItem(`${keyPrefix}${provider}`, apiKey);
  localStorage.setItem(activeProviderKey, provider);
}

export function clearDirectKey(provider: DirectProviderId) {
  localStorage.removeItem(`${keyPrefix}${provider}`);
  if (localStorage.getItem(activeProviderKey) === provider) localStorage.removeItem(activeProviderKey);
}

export function activeDirectProvider() {
  if (typeof window === "undefined") return undefined;
  const provider = localStorage.getItem(activeProviderKey);
  return provider && provider in backendFactories ? provider as DirectProviderId : undefined;
}
