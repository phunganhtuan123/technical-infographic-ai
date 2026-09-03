#!/usr/bin/env node
// Local AI Connector
// ---------------------------------------------------------------------------
// A client-owned AI Gateway that runs on this machine only. It implements the
// contract in docs/client-ai-gateway-contract.md so the editor can generate
// diagrams without the Technical Infographic server ever seeing a prompt, an
// image, or a diagram.
//
//   browser  --(PKCE)-->  this connector  -->  Ollama | claude CLI | Anthropic
//
// Which of those three it uses is detected at boot; see backends.mjs. Nothing
// but an opaque, expiring token ever reaches the browser.
//
//   npm run ai:local
// ---------------------------------------------------------------------------

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { discoverBackends, validateGeminiKey } from "./backends.mjs";

// Flags win over environment, so `npx ... --editor https://…` needs no setup.
const flags = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (!argument.startsWith("--")) continue;
  const [name, inline] = argument.slice(2).split("=");
  flags.set(name, inline ?? (process.argv[index + 1]?.startsWith("--") ? "true" : process.argv[++index] ?? "true"));
}
const option = (name, environment, fallback) => flags.get(name) ?? process.env[environment]?.trim() ?? fallback;

// Loopback by default: the connector fronts a CLI that is already logged in, so
// anything that can reach this port can spend that login. It only binds wider
// when told to, which is what a server-side deployment needs — the CLI lives on
// the server and the browsers are elsewhere on the LAN.
const HOST = option("host", "AI_CONNECTOR_HOST", "127.0.0.1");
const PORT = Number(flags.get("port") ?? process.env.AI_CONNECTOR_PORT ?? 47821);
const LOOPBACK_ONLY = HOST === "127.0.0.1" || HOST === "::1" || HOST === "localhost";
// What the connector calls itself in the discovery document. When it is bound
// wider, the browser has to be handed an address it can actually resolve, not
// its own loopback.
// May include a path, e.g. https://editor.example.com/ai-connector, for the
// case where a reverse proxy mounts the connector under the editor's own
// origin. Endpoints are advertised relative to it, so the browser is always
// handed an address it can actually reach.
const ORIGIN = (option("public-origin", "AI_CONNECTOR_PUBLIC_ORIGIN", "") || `http://${LOOPBACK_ONLY ? "127.0.0.1" : HOST}:${PORT}`).replace(/\/$/, "");
// Requests arrive with the prefix already stripped by the proxy, so routing
// still works off bare paths; only what is advertised carries the prefix.
const ROUTE_BASE = `http://${LOOPBACK_ONLY ? "127.0.0.1" : HOST}:${PORT}`;
const CLIENT_ID = "technical-infographic-web";
const SCOPES = ["openid", "profile", "diagram.generate"];
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 12 * 1024 * 1024;

const wantedBackend = option("backend", "AI_BACKEND", undefined);
const localBaseUrl = option("base-url", "AI_BASE_URL", "http://127.0.0.1:11434").replace(/\/$/, "");
const cliCommand = option("claude-cli", "CLAUDE_CLI", "claude");
const codexCommand = option("codex-cli", "CODEX_CLI", "codex");
const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
// Held in memory only, and settable at runtime from the editor so a key never
// has to be written to disk to try it. It is not echoed back anywhere.
let geminiKey = option("gemini-key", "GEMINI_API_KEY", "") || undefined;
const preferredModel = option("model", "AI_MODEL", process.env.ANTHROPIC_MODEL?.trim());

// Which editor may pair with this connector. A page served from this machine is
// always allowed; a deployed editor has to be named explicitly, because the
// connector is the only thing standing between a random web page and the AI
// running on this machine.
//
//   EDITOR_ORIGIN=https://infographic.company.com npm run ai:local
const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const editorOrigins = (option("editor", "EDITOR_ORIGIN", "") ?? "")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean);

function allowedEditorOrigin(origin) {
  if (!origin) return false;
  return localOrigin.test(origin) || editorOrigins.includes(origin);
}

// Origin checks are enforced by browsers, not by the network, so they do nothing
// against a direct request. Once this connector is bound past loopback the
// address of the caller is the only thing left to check, and the pairing flow
// hands out a token to anyone who can complete it. Default to the private
// ranges; --allow-ip narrows it further.
const allowedClients = (option("allow-ip", "AI_CONNECTOR_ALLOW_IPS", "") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function isPrivateAddress(address) {
  if (address === "::1" || address === "127.0.0.1") return true;
  const parts = address.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function clientAddress(request) {
  // No proxy is trusted here: the connector is meant to be reached directly, so
  // a forwarded header would only let a caller name itself.
  return (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
}

function allowedClient(request) {
  const address = clientAddress(request);
  if (address === "127.0.0.1" || address === "::1") return true;
  if (LOOPBACK_ONLY) return false;
  if (allowedClients.length) return allowedClients.some((prefix) => address === prefix || address.startsWith(prefix.replace(/\*$/, "")));
  return isPrivateAddress(address);
}

/** @type {Map<string, { challenge: string, redirectUri: string, expiresAt: number }>} */
const pendingCodes = new Map();
/** @type {Map<string, number>} */
const tokens = new Map();

/** @type {Array<{ id: string, providerId: string, label: string, vision: boolean, listModels: Function, complete: Function }>} */
let backends = [];
/** providerId -> { models, defaultModel } */
const modelCache = new Map();

// --------------------------------------------------------------------- utils

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sweep() {
  const now = Date.now();
  for (const [code, entry] of pendingCodes) if (entry.expiresAt < now) pendingCodes.delete(code);
  for (const [token, expiresAt] of tokens) if (expiresAt < now) tokens.delete(token);
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  if (!allowedEditorOrigin(origin)) return {};
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  // Chrome asks before letting a public page reach a loopback address. Versions
  // that negotiate it on the preflight get their answer here; newer ones put the
  // decision in a permission prompt the user sees instead.
  if (request.headers["access-control-request-private-network"] === "true") {
    headers["Access-Control-Allow-Private-Network"] = "true";
  }
  return headers;
}

function sendJson(request, response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...corsHeaders(request),
  });
  response.end(body);
}

function sendHtml(response, status, html) {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(html);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function readFormBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function bearerToken(request) {
  const header = request.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return undefined;
  const token = header.slice(7).trim();
  const expiresAt = tokens.get(token);
  if (!expiresAt || expiresAt < Date.now()) return undefined;
  return token;
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------- plan schemas
// Mirrors diagramPlanSchema in src/modules/diagram/schema.ts. Written out as a
// literal JSON Schema because every backend needs the enums spelled out to
// stay in range — the browser re-validates with zod, so drift is caught there.

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

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "title", "purpose", "nodes", "edges"],
  properties: {
    mode: { type: "string", enum: MODES },
    title: { type: "string", description: "Short diagram title, under 60 characters." },
    purpose: { type: "string", description: "One sentence on what the diagram explains." },
    nodes: {
      type: "array",
      minItems: 2,
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
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
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
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
};

const selectionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["nodes"],
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
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
};

// ------------------------------------------------------------------ prompting

const systemPrompt = `You design technical diagrams for engineers. You emit structured diagram data only — never prose, code, SVG paths, CSS or coordinates. Layout is decided by a deterministic compiler downstream, so you choose semantics, not positions.

Rules that matter:
- Give every node a lane. entry is for actors and inbound edges of the system, core is the main synchronous path, async is for queues, buses and workers, data is for stores and caches.
- Pick the role that matches what the thing is, not what it looks like. A queue is event-bus, a table is database, a branch is decision.
- Mark the edges on the primary path important: true. Leave secondary and failure paths false.
- Use edge semantics honestly: request for synchronous calls, event for fire-and-forget, data for persistence and reads, feedback for callbacks, success and failure for branch outcomes.
- Keep labels short. A node label is a name, not a sentence. detail is at most six words.
- Node ids are lowercase slugs and every edge from/to must match one.
- Prefer 5 to 12 nodes. Merge detail into fewer nodes rather than sprawling.`;

function describeDocument(document) {
  if (!document || typeof document !== "object") return "(empty canvas)";
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  const edges = Array.isArray(document.edges) ? document.edges : [];
  if (!nodes.length) return "(empty canvas)";
  return [
    `title: ${document.title ?? "untitled"}`,
    `mode: ${document.mode ?? "architecture"}`,
    "nodes:",
    ...nodes.map((node) => `  ${node.id} | ${node.role} | ${node.lane ?? "core"} | ${node.label}${node.detail ? ` — ${node.detail}` : ""}`),
    "edges:",
    ...edges.map((edge) => `  ${edge.id} | ${edge.from} -> ${edge.to} | ${edge.semantics}${edge.label ? ` | ${edge.label}` : ""}`),
  ].join("\n");
}

function buildUserText(input) {
  const context = [];
  if (input.mode && input.mode !== "auto") context.push(`Requested diagram mode: ${input.mode}.`);
  if (input.format && input.format !== "auto") context.push(`Canvas format: ${input.format} — keep the node count suited to that shape.`);
  if (input.threadSummary) context.push(`Earlier in this session: ${input.threadSummary}`);

  if (input.intent === "modify-selection") {
    const selected = (input.document?.nodes ?? []).filter((node) => input.selectedNodeIds?.includes(node.id));
    context.push(`Change only these selected components, leave everything else alone:\n${selected.map((node) => `  ${node.id} | ${node.role} | ${node.label}`).join("\n")}`);
  } else if (input.intent === "modify-current") {
    context.push(`Rewrite the current diagram to satisfy the request. Reuse node ids where the component survives.\n\nCurrent diagram:\n${describeDocument(input.document)}`);
  }

  return `${input.prompt}\n\n${context.join("\n\n")}`.trim();
}

// ----------------------------------------------------------------- generation

async function modelsFor(backend) {
  const cached = modelCache.get(backend.providerId);
  if (cached) return cached;
  const found = await backend.listModels().catch(() => []);
  const models = found.length ? found : [preferredModel ?? backend.id];
  const entry = { models, defaultModel: preferredModel && models.includes(preferredModel) ? preferredModel : models[0] };
  modelCache.set(backend.providerId, entry);
  return entry;
}

/** Pick the backend the editor asked for, by provider first and model second. */
function pickBackend(input) {
  const wanted = input.providerId;
  if (wanted && wanted !== "auto") {
    const match = backends.find((backend) => backend.providerId === wanted);
    if (match) return match;
  }
  if (input.model && input.model !== "auto") {
    const match = backends.find((backend) => modelCache.get(backend.providerId)?.models.includes(input.model));
    if (match) return match;
  }
  return backends[0];
}

async function generateProposal(input) {
  const backend = pickBackend(input);
  const { defaultModel } = await modelsFor(backend);
  const selection = input.intent === "modify-selection";
  const model = input.model && input.model !== "auto" ? input.model : defaultModel;

  const result = await backend.complete({
    system: systemPrompt,
    userText: buildUserText(input),
    image: input.image,
    schema: selection ? selectionSchema : planSchema,
    schemaName: selection ? "emit_selection_changes" : "emit_diagram_plan",
    model,
  });

  if (selection) {
    const allowed = new Set(input.selectedNodeIds ?? []);
    const patches = (result.nodes ?? [])
      .filter((node) => allowed.has(node.id))
      .map(({ id, ...changes }) => ({ op: "update-node", id, changes }))
      .filter((patch) => Object.keys(patch.changes).length > 0);
    if (!patches.length) throw new Error("The model proposed no change inside the selection");
    return {
      backendId: backend.id,
      id: `proposal-${randomUUID()}`,
      requestId: input.requestId,
      intent: input.intent,
      summary: `Updated ${patches.length} selected component${patches.length === 1 ? "" : "s"}`,
      explanation: "Only the components captured in the selection were changed.",
      threadSummary: String(input.prompt ?? "").slice(0, 240),
      confidence: 0.9,
      warnings: [],
      patches,
    };
  }

  if (!Array.isArray(result.nodes) || result.nodes.length < 2) throw new Error("The model returned a diagram with no components");
  const plan = { id: `plan-${randomUUID()}`, ...result, edges: Array.isArray(result.edges) ? result.edges : [] };
  const nodeIds = new Set(plan.nodes.map((node) => node.id));
  const warnings = [];
  const edges = plan.edges.filter((edge) => {
    const valid = nodeIds.has(edge.from) && nodeIds.has(edge.to);
    if (!valid) warnings.push(`Dropped connection ${edge.from} → ${edge.to}: unknown component.`);
    return valid;
  });
  if (input.image) warnings.push("Image interpretation should be reviewed before accepting.");
  if (backend.id === "local") warnings.push("Generated by a local model — check roles and lanes before accepting.");

  return {
    backendId: backend.id,
    id: `proposal-${randomUUID()}`,
    requestId: input.requestId,
    intent: input.intent,
    summary: plan.title,
    explanation: plan.purpose,
    threadSummary: String(input.prompt ?? "").slice(0, 240),
    confidence: backend.id === "local" ? 0.7 : 0.9,
    warnings,
    patches: [{ op: "replace-document", plan: { ...plan, edges } }],
  };
}

// --------------------------------------------------------------------- routes

function approvalPage({ redirectUri, code, state }) {
  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);
  return `<!doctype html><meta charset="utf-8"><title>Pair with Technical Infographic</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#080808; color:#f5f5f5;
         font:14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace }
  main { width:min(460px, calc(100vw - 40px)); padding:28px; border:1px solid #262626; border-radius:14px; background:#111 }
  h1 { margin:0 0 6px; font-size:17px; letter-spacing:-.02em }
  p { margin:0 0 8px; color:#8f8f8f; font-size:12px }
  dl { margin:18px 0; display:grid; grid-template-columns:auto 1fr; gap:6px 14px; font-size:11px }
  dt { color:#5f5f5f } dd { margin:0; color:#d0d0d0; overflow-wrap:anywhere }
  a { display:block; margin-top:20px; padding:11px; border:1px solid #435c25; border-radius:9px;
      background:#17200d; color:#b6ff5c; font-size:12px; text-align:center; text-decoration:none }
  a:hover { background:#1d2a10 }
</style>
<main>
  <h1>Pair with Technical Infographic</h1>
  <p>The editor is asking to use the AI this connector is wired to. Nothing it sends leaves this machine except what the backend itself requires.</p>
  <dl>
    <dt>Editor</dt><dd>${target.origin}</dd>
    <dt>Connector</dt><dd>${ORIGIN}</dd>
    <dt>Backend</dt><dd>${backends.map((backend) => backend.label).join("<br>")}</dd>
    <dt>Valid for</dt><dd>8 hours</dd>
  </dl>
  <a href="${target.toString()}">Allow this editor</a>
</main>`;
}

async function route(request, response, url) {
  if (request.method === "GET" && url.pathname === "/.well-known/technical-infographic-ai") {
    return sendJson(request, response, 200, {
      organizationId: "local-machine",
      issuer: `${ORIGIN}/`,
      authorizationEndpoint: `${ORIGIN}/authorize`,
      tokenEndpoint: `${ORIGIN}/token`,
      apiBaseUrl: `${ORIGIN}/v1`,
      clientId: CLIENT_ID,
      scopes: SCOPES,
      capabilitiesEndpoint: `${ORIGIN}/v1/capabilities`,
      policyVersion: "1",
      mock: false,
      // Not part of the contract, and ignored by the schema. It lets the Config
      // dialog show which buttons will actually work, and which models each one
      // offers, before anyone pairs.
      backends: backends.map((backend) => backend.providerId),
      backendDetails: await Promise.all(backends.map(async (backend) => {
        const { models, defaultModel } = await modelsFor(backend);
        return { id: backend.providerId, label: backend.label, models, defaultModel, vision: backend.vision };
      })),
    });
  }

  // PKCE authorize: a top-level navigation, so no CORS involved.
  if (request.method === "GET" && url.pathname === "/authorize") {
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    const method = url.searchParams.get("code_challenge_method");
    const clientId = url.searchParams.get("client_id");

    let parsed;
    try {
      parsed = new URL(redirectUri);
    } catch {
      return sendHtml(response, 400, "<p>Invalid redirect_uri.</p>");
    }
    if (!allowedEditorOrigin(parsed.origin)) {
      return sendHtml(response, 400, `<p>This connector does not pair with <code>${parsed.origin}</code>.</p><p>Start it with <code>EDITOR_ORIGIN=${parsed.origin}</code> if that editor is yours.</p>`);
    }
    if (clientId !== CLIENT_ID) return sendHtml(response, 400, "<p>Unknown client_id.</p>");
    if (method !== "S256" || !challenge || !state) return sendHtml(response, 400, "<p>This connector requires PKCE with S256.</p>");

    const code = base64Url(randomBytes(32));
    pendingCodes.set(code, { challenge, redirectUri, expiresAt: Date.now() + CODE_TTL_MS });
    return sendHtml(response, 200, approvalPage({ redirectUri, code, state }));
  }

  if (request.method === "POST" && url.pathname === "/token") {
    const form = await readFormBody(request);
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    const entry = pendingCodes.get(code);
    pendingCodes.delete(code);

    if (!entry || entry.expiresAt < Date.now()) return sendJson(request, response, 400, { error: "invalid_grant" });
    if (form.get("client_id") !== CLIENT_ID) return sendJson(request, response, 400, { error: "invalid_client" });
    if (form.get("redirect_uri") !== entry.redirectUri) return sendJson(request, response, 400, { error: "invalid_grant" });

    const digest = base64Url(createHash("sha256").update(verifier).digest());
    if (!safeEqual(digest, entry.challenge)) return sendJson(request, response, 400, { error: "invalid_grant" });

    const token = base64Url(randomBytes(32));
    tokens.set(token, Date.now() + TOKEN_TTL_MS);
    console.log(`[connector] paired with ${new URL(entry.redirectUri).origin}`);
    return sendJson(request, response, 200, {
      access_token: token,
      token_type: "Bearer",
      expires_in: Math.floor(TOKEN_TTL_MS / 1000),
      scope: SCOPES.join(" "),
    });
  }

  if (url.pathname.startsWith("/v1/") && !bearerToken(request)) {
    return sendJson(request, response, 401, { error: "unauthorized" });
  }

  if (request.method === "GET" && url.pathname === "/v1/capabilities") {
    const providers = await Promise.all(backends.map(async (backend) => {
      const { models, defaultModel } = await modelsFor(backend);
      return { id: backend.providerId, label: backend.label, models, defaultModel };
    }));
    const capabilities = ["structured_output", "diagram_plan", "diagram_patch"];
    // Advertised once for the whole connector, so only claim it if something here can do it.
    if (backends.some((backend) => backend.vision)) capabilities.push("vision");
    return sendJson(request, response, 200, { capabilities, providers });
  }

  // Adding a provider key from the editor. Requires an existing pairing, so a
  // caller that has not been through the approval page cannot reconfigure the
  // connector. The key stays in this process; it is never written to disk and
  // never returned.
  if (request.method === "POST" && url.pathname === "/v1/providers/gemini") {
    const body = await readJsonBody(request);
    const key = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (key) {
      try { await validateGeminiKey(key); }
      catch (error) { return sendJson(request, response, 400, { error: error.message }); }
    }
    const previous = geminiKey;
    geminiKey = key || undefined;
    try {
      await refreshBackends();
    } catch (error) {
      geminiKey = previous;
      await refreshBackends().catch(() => undefined);
      return sendJson(request, response, 400, { error: error.message });
    }
    if (key && !backends.some((backend) => backend.providerId === "gemini")) {
      geminiKey = previous;
      await refreshBackends().catch(() => undefined);
      return sendJson(request, response, 400, { error: `Gemini is not in AI_BACKEND (currently ${wantedBackend ?? "all"})` });
    }
    console.log(`[connector] gemini key ${key ? "set" : "cleared"}`);
    return sendJson(request, response, 200, { providers: backends.map((backend) => backend.providerId) });
  }

  if (request.method === "POST" && url.pathname === "/v1/responses") {
    const body = await readJsonBody(request);
    const input = body.input ?? {};
    if (!input.prompt || typeof input.prompt !== "string") {
      return sendJson(request, response, 400, { error: "prompt is required" });
    }
    const started = Date.now();

    // Generation can outlast every timeout between here and the browser: a
    // reverse proxy waiting on the first byte, Node's fetch waiting on headers,
    // a CDN waiting on the origin. All of them are satisfied by bytes, so the
    // headers go out now and a newline follows every few seconds until the
    // answer is ready. Leading whitespace is legal JSON, so the client still
    // just parses the body — no streaming code needed on the other side.
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
    });
    const heartbeat = setInterval(() => {
      if (!response.writableEnded) response.write("\n");
    }, 5000);

    try {
      const { backendId, ...proposal } = await generateProposal(input);
      console.log(`[connector] ${backendId} · ${input.intent} · ${proposal.patches.length} patch(es) · ${Date.now() - started}ms`);
      clearInterval(heartbeat);
      return response.end(JSON.stringify(proposal));
    } catch (error) {
      console.error(`[connector] generation failed after ${Date.now() - started}ms:`, error.message);
      clearInterval(heartbeat);
      // The status line is long gone, so the failure has to travel in the body.
      return response.end(JSON.stringify({ error: error.message }));
    }
  }

  return sendJson(request, response, 404, { error: "not_found" });
}

// ---------------------------------------------------------------------- boot

async function refreshBackends() {
  backends = await discoverBackends({
    wanted: wantedBackend,
    baseUrl: localBaseUrl,
    cliCommand,
    codexCommand,
    apiKey,
    geminiKey,
    preferredModel,
  });
  modelCache.clear();
  return backends;
}

try {
  await refreshBackends();
} catch (error) {
  console.error([
    "",
    `  ${error.message}`,
    "",
    ...(error.tried ? ["  Looked for, in order:", ...error.tried.map((item) => `    · ${item}`), ""] : []),
    "  Set up any one of these and start again:",
    "",
    "    A local model — no key, no cost, nothing leaves this machine:",
    "      ollama serve && ollama pull qwen2.5-coder:14b",
    "",
    "    A CLI you are already logged into:",
    "      claude --version",
    "      codex --version",
    "",
    "    An Anthropic API key:",
    "      export ANTHROPIC_API_KEY=sk-ant-...",
    "",
    "  Narrow the set with --backend local,claude,codex,api.",
    "",
  ].join("\n"));
  process.exit(1);
}

const server = createServer((request, response) => {
  sweep();
  const url = new URL(request.url ?? "/", ROUTE_BASE);

  if (!allowedClient(request)) {
    console.warn(`[connector] refused ${clientAddress(request)} — not an allowed client address`);
    response.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    return response.end(JSON.stringify({ error: "forbidden" }));
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(request));
    return response.end();
  }

  route(request, response, url).catch((error) => {
    console.error("[connector]", error);
    if (!response.headersSent) sendJson(request, response, 500, { error: "connector_error" });
    else response.end();
  });
});

server.listen(PORT, HOST, async () => {
  const lines = await Promise.all(backends.map(async (backend) => {
    const { defaultModel } = await modelsFor(backend);
    return `    · ${backend.label} — ${defaultModel}`;
  }));
  console.log([
    "",
    `  Local AI Connector bound to ${HOST}:${PORT}, advertising ${ORIGIN}`,
    "",
    "  Available here:",
    ...lines,
    "",
    `  Editors: this machine${editorOrigins.length ? `, ${editorOrigins.join(", ")}` : " only — pass --editor https://… for a deployed editor"}`,
    `  Callers: ${LOOPBACK_ONLY ? "this machine only (loopback bind)" : allowedClients.length ? allowedClients.join(", ") : "private network addresses only"}`,
    "",
    LOOPBACK_ONLY
      ? "  Bound to the loopback interface only. The browser receives an opaque"
      : "  NOT loopback-only. Anyone who can reach this port and complete the",
    LOOPBACK_ONLY
      ? "  token that expires in 8 hours and never sees any credential."
      : "  pairing can spend the CLI login behind it — keep the port firewalled.",
    "",
    "  Next: open the editor, then Config → AI connections.",
    "",
  ].join("\n"));
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use — another connector is probably running.\n`);
    process.exit(1);
  }
  throw error;
});
