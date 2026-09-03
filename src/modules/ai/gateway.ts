import { diagramProposalSchema, gatewayCapabilitiesSchema, gatewayMetadataSchema, type AiCapability, type AiProvider, type AiRequest, type DiagramProposal, type GatewayMetadata } from "./contracts";
import { runLocalCompiler } from "./diagram-ai";

export type AiProgress = "Connecting" | "Understanding input" | "Structuring diagram" | "Planning animation" | "Validating proposal" | "Building preview";

export interface AiConnector {
  capabilities: Set<AiCapability>;
  providers: AiProvider[];
  generate(request: AiRequest, signal: AbortSignal, onProgress: (progress: AiProgress) => void): Promise<DiagramProposal>;
}

const savedGatewayKey = "technical-infographic-client-ai-gateway";
const pendingProviderKey = "technical-infographic-pending-ai-provider";
const pendingModelKey = "technical-infographic-pending-ai-model";
// Pairing is a full-page redirect, so a key typed before it has to survive the
// round trip. sessionStorage keeps it to this tab, and it is taken (not read)
// on the way back, then handed straight to the connector and dropped.
const pendingKeyKey = "technical-infographic-pending-provider-key";

// A Gateway reached over plain HTTP is only acceptable when it cannot leave the
// operator's own network: loopback, or an RFC1918/link-local address on the LAN.
// The local connector is deployed that way when the CLI it fronts lives on a
// machine other than the one running the browser.
export function isPrivateGatewayHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    const [a, b] = parts.map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export function normalizeClientGatewayUrl(input: string) {
  const candidate = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  const url = new URL(candidate);
  if (url.username || url.password) throw new Error("Gateway URL cannot contain credentials");
  const local = isPrivateGatewayHost(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("Client AI Gateway must use HTTPS unless it is on a private network");
  return url.origin;
}

export async function discoverClientGateway(input: string) {
  const origin = normalizeClientGatewayUrl(input);
  const response = await fetch(new URL("/.well-known/technical-infographic-ai", origin), { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Client AI Gateway discovery failed (${response.status})`);
  const metadata = gatewayMetadataSchema.parse(await response.json());
  if (metadata.mock || !metadata.issuer || !metadata.authorizationEndpoint || !metadata.tokenEndpoint || !metadata.apiBaseUrl || !metadata.capabilitiesEndpoint || !metadata.scopes.includes("openid")) throw new Error("Client AI Gateway discovery document is incomplete");
  for (const endpoint of [metadata.issuer, metadata.authorizationEndpoint, metadata.tokenEndpoint, metadata.apiBaseUrl, metadata.capabilitiesEndpoint]) normalizeClientGatewayUrl(endpoint);
  return { origin, metadata };
}

export function savedClientGatewayUrl() {
  return typeof window === "undefined" ? undefined : localStorage.getItem(savedGatewayKey) ?? undefined;
}

export function saveClientGatewayUrl(origin: string) {
  localStorage.setItem(savedGatewayKey, origin);
}

export function clearClientGatewayUrl() {
  localStorage.removeItem(savedGatewayKey);
}

export function savePendingProvider(providerId?: string) {
  if (providerId) sessionStorage.setItem(pendingProviderKey, providerId);
  else sessionStorage.removeItem(pendingProviderKey);
}

export function takePendingProvider() {
  const providerId = sessionStorage.getItem(pendingProviderKey) ?? undefined;
  sessionStorage.removeItem(pendingProviderKey);
  return providerId;
}

export function savePendingModel(model?: string) {
  if (model) sessionStorage.setItem(pendingModelKey, model);
  else sessionStorage.removeItem(pendingModelKey);
}

export function takePendingModel() {
  const model = sessionStorage.getItem(pendingModelKey) ?? undefined;
  sessionStorage.removeItem(pendingModelKey);
  return model;
}

export function savePendingProviderKey(apiKey?: string) {
  if (apiKey) sessionStorage.setItem(pendingKeyKey, apiKey);
  else sessionStorage.removeItem(pendingKeyKey);
}

export function takePendingProviderKey() {
  const apiKey = sessionStorage.getItem(pendingKeyKey) ?? undefined;
  sessionStorage.removeItem(pendingKeyKey);
  return apiKey;
}

/** Hand a provider key to the connector. It is held in that process's memory only. */
export async function setGatewayProviderKey(metadata: GatewayMetadata, token: string, provider: "gemini", apiKey: string) {
  if (!metadata.apiBaseUrl) throw new Error("AI Gateway API URL is unavailable");
  const response = await fetch(new URL(`providers/${provider}`, `${metadata.apiBaseUrl.replace(/\/$/, "")}/`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(typeof detail.error === "string" ? detail.error : `Could not set the ${provider} key (${response.status})`);
  }
}

export async function discoverCapabilities(metadata: GatewayMetadata, token?: string) {
  if (metadata.mock) return {
    capabilities: new Set<AiCapability>(["structured_output", "vision", "diagram_plan", "diagram_patch", "streaming"]),
    providers: [
      { id: "openai" as const, label: "OpenAI", models: ["mock-openai"], defaultModel: "mock-openai" },
      { id: "anthropic" as const, label: "Claude", models: ["mock-claude"], defaultModel: "mock-claude" },
      { id: "gemini" as const, label: "Gemini", models: ["mock-gemini"], defaultModel: "mock-gemini" },
    ],
  };
  if (!metadata.capabilitiesEndpoint || !token) throw new Error("AI Gateway capability discovery is unavailable");
  const response = await fetch(metadata.capabilitiesEndpoint, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("Could not discover AI Gateway capabilities");
  const body = gatewayCapabilitiesSchema.parse(await response.json());
  return { capabilities: new Set(body.capabilities), providers: body.providers };
}

export class DirectGatewayConnector implements AiConnector {
  capabilities: Set<AiCapability>;
  providers: AiProvider[];
  constructor(readonly metadata: GatewayMetadata, private token: string, discovered: Awaited<ReturnType<typeof discoverCapabilities>>) {
    this.capabilities = discovered.capabilities;
    this.providers = discovered.providers;
  }

  /** Add a provider key to the live connection, then pick the change up. */
  async setProviderKey(provider: "gemini", apiKey: string) {
    await setGatewayProviderKey(this.metadata, this.token, provider, apiKey);
    const discovered = await discoverCapabilities(this.metadata, this.token);
    this.capabilities = discovered.capabilities;
    this.providers = discovered.providers;
    return discovered.providers;
  }

  async generate(request: AiRequest, signal: AbortSignal, onProgress: (progress: AiProgress) => void) {
    if (!this.metadata.apiBaseUrl) throw new Error("AI Gateway API URL is unavailable");
    onProgress("Understanding input");
    const response = await fetch(new URL("responses", `${this.metadata.apiBaseUrl.replace(/\/$/, "")}/`), {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: request, response_format: { type: "json_schema", name: "diagram_proposal" } }),
    });
    if (!response.ok) throw new Error(`AI Gateway request failed (${response.status})`);
    onProgress("Validating proposal");
    const body: unknown = await response.json();
    // A generation that runs long has its headers sent before the outcome is
    // known, so a failure arrives as a 200 carrying an error instead. Surface
    // the gateway's own message rather than a schema complaint about it.
    if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
      throw new Error((body as { error: string }).error);
    }
    const correlated = body && typeof body === "object" ? { ...body, requestId: request.requestId } : body;
    return diagramProposalSchema.parse(correlated);
  }
}

export class MockGatewayConnector implements AiConnector {
  capabilities = new Set<AiCapability>(["structured_output", "vision", "diagram_plan", "diagram_patch", "streaming"]);
  providers: AiProvider[] = [
    { id: "openai", label: "OpenAI", models: ["mock-openai"], defaultModel: "mock-openai" },
    { id: "anthropic", label: "Claude", models: ["mock-claude"], defaultModel: "mock-claude" },
    { id: "gemini", label: "Gemini", models: ["mock-gemini"], defaultModel: "mock-gemini" },
  ];
  async generate(request: AiRequest, signal: AbortSignal, onProgress: (progress: AiProgress) => void) {
    for (const progress of ["Understanding input", "Structuring diagram", "Planning animation"] as const) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      onProgress(progress);
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    const selected = request.selectedNodeIds;
    const plan = request.intent === "modify-selection" ? undefined : runLocalCompiler({
      operation: request.intent === "new-scene" ? "generate" : "regenerate",
      scope: "document",
      prompt: request.prompt,
      document: request.document as Parameters<typeof runLocalCompiler>[0]["document"],
      selectedNodeIds: selected,
    }).plan;
    const patches = request.intent === "modify-selection"
      ? selected.map((id) => ({ op: "update-node" as const, id, changes: { detail: request.prompt, effect: "glow" as const } }))
      : [{ op: "replace-document" as const, plan: plan! }];
    return diagramProposalSchema.parse({ id: `proposal-${crypto.randomUUID()}`, requestId: request.requestId, intent: request.intent, summary: request.intent === "new-scene" ? "New technical story ready" : "Diagram changes ready", explanation: "The proposal simplifies the requested technical story and maps it to editable primitives.", threadSummary: request.prompt.slice(0, 240), confidence: 0.91, warnings: request.image ? ["Image interpretation should be reviewed before accepting."] : [], patches });
  }
}
