import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectGatewayConnector, discoverCapabilities, discoverClientGateway, normalizeClientGatewayUrl } from "./gateway";
import type { GatewayMetadata } from "./contracts";

afterEach(() => vi.unstubAllGlobals());

describe("AI Gateway discovery", () => {
  it("normalizes a client-owned HTTPS Gateway", () => {
    expect(normalizeClientGatewayUrl("ai.customer.example/path")).toBe("https://ai.customer.example");
    expect(normalizeClientGatewayUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(() => normalizeClientGatewayUrl("http://ai.customer.example")).toThrow(/HTTPS/);
    expect(() => normalizeClientGatewayUrl("https://user:secret@ai.customer.example")).toThrow(/credentials/);
  });

  it("discovers connection metadata from the client Gateway well-known endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      organizationId: "customer-org",
      issuer: "https://login.customer.example/",
      authorizationEndpoint: "https://login.customer.example/authorize",
      tokenEndpoint: "https://login.customer.example/token",
      apiBaseUrl: "https://ai.customer.example/v1",
      clientId: "technical-infographic-web",
      scopes: ["openid", "diagram.generate"],
      capabilitiesEndpoint: "https://ai.customer.example/v1/capabilities",
      policyVersion: "1",
      mock: false,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await discoverClientGateway("https://ai.customer.example/v1");
    expect(result.metadata.organizationId).toBe("customer-org");
    expect(fetchMock.mock.calls[0][0].toString()).toBe("https://ai.customer.example/.well-known/technical-infographic-ai");
  });

  it("rejects discovery metadata with an insecure endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      organizationId: "customer-org", issuer: "https://login.customer.example/",
      authorizationEndpoint: "https://login.customer.example/authorize", tokenEndpoint: "http://login.customer.example/token",
      apiBaseUrl: "https://ai.customer.example/v1", clientId: "web", scopes: ["openid"],
      capabilitiesEndpoint: "https://ai.customer.example/v1/capabilities", policyVersion: "1", mock: false,
    }), { status: 200 })));
    await expect(discoverClientGateway("https://ai.customer.example")).rejects.toThrow(/HTTPS/);
  });

  it("parses provider and model allowlists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      capabilities: ["structured_output", "vision", "diagram_plan", "diagram_patch"],
      providers: [{ id: "anthropic", label: "Claude", models: ["enabled-model"], defaultModel: "enabled-model" }],
    }), { status: 200 })));
    const metadata = { organizationId: "org", clientId: "web", scopes: [], mock: false, policyVersion: "1", capabilitiesEndpoint: "https://gateway.test/v1/capabilities" } satisfies GatewayMetadata;
    const result = await discoverCapabilities(metadata, "access-token");
    expect(result.capabilities.has("vision")).toBe(true);
    expect(result.providers[0]).toMatchObject({ id: "anthropic", defaultModel: "enabled-model" });
  });

  it("rejects malformed provider discovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ capabilities: ["vision"], providers: [{ id: "unknown" }] }), { status: 200 })));
    const metadata = { organizationId: "org", clientId: "web", scopes: [], mock: false, policyVersion: "1", capabilitiesEndpoint: "https://gateway.test/v1/capabilities" } satisfies GatewayMetadata;
    await expect(discoverCapabilities(metadata, "access-token")).rejects.toThrow();
  });

  it("routes a selected Claude model through the client Gateway contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "proposal-claude", requestId: "request-claude", intent: "new-scene", summary: "Claude proposal",
      patches: [{ op: "replace-document", plan: { id: "claude-flow", mode: "flow", title: "Claude flow", purpose: "Contract test", nodes: [], edges: [] } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const metadata = { organizationId: "org", clientId: "web", scopes: ["openid"], mock: false, policyVersion: "1", apiBaseUrl: "https://gateway.test/v1" } satisfies GatewayMetadata;
    const connector = new DirectGatewayConnector(metadata, "client-token", {
      capabilities: new Set(["structured_output", "diagram_plan"]),
      providers: [{ id: "anthropic", label: "Claude", models: ["claude-quality"], defaultModel: "claude-quality" }],
    });
    await connector.generate({ requestId: "request-claude", prompt: "Create a flow", intent: "new-scene", mode: "auto", format: "auto", document: {}, selectedNodeIds: [], selectedEdgeIds: [], providerId: "anthropic", model: "claude-quality" }, AbortSignal.timeout(1000), () => undefined);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).input).toMatchObject({ providerId: "anthropic", model: "claude-quality" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer client-token");
  });

  it("attaches the trusted client request ID when the model omits it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "proposal-codex", intent: "new-scene", summary: "Login proposal",
      patches: [{ op: "replace-document", plan: { id: "login-flow", mode: "flow", title: "Login flow", purpose: "Explain login", nodes: [], edges: [] } }],
    }), { status: 200 })));
    const metadata = { organizationId: "org", clientId: "web", scopes: ["openid"], mock: false, policyVersion: "1", apiBaseUrl: "https://gateway.test/v1" } satisfies GatewayMetadata;
    const connector = new DirectGatewayConnector(metadata, "client-token", {
      capabilities: new Set(["structured_output", "diagram_plan"]),
      providers: [{ id: "codex", label: "Codex Local", models: ["codex-default"], defaultModel: "codex-default" }],
    });
    const proposal = await connector.generate({ requestId: "trusted-request-id", prompt: "Create login flow", intent: "new-scene", mode: "flow", format: "16:9", document: {}, selectedNodeIds: [], selectedEdgeIds: [], providerId: "codex", model: "codex-default" }, AbortSignal.timeout(1000), () => undefined);
    expect(proposal.requestId).toBe("trusted-request-id");
  });
});
