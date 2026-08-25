# ADR-001: Connect the browser directly to a client-owned AI Gateway

Status: accepted

## Decision

The client supplies its AI Gateway URL. The browser loads `/.well-known/technical-infographic-ai`, obtains an AI access token through Authorization Code with PKCE, and sends prompt, image and diagram context directly to that client-owned Gateway. The access token is held in memory. Only the previously verified Gateway origin is stored locally.

The Gateway exposes an OpenAI Responses-style endpoint and returns a typed `DiagramProposal`. Generate requests return a `replace-document` plan. Selection comments return strict `DiagramPatch` operations. The client validates scope and schema, computes layout and routing, and renders a read-only preview before any mutation.

## Boundaries

- Application server: no AI provider configuration, credentials, model calls or Gateway metadata.
- Browser: prompt/image preparation, PKCE, token memory, context selection, validation, preview and acceptance.
- AI Gateway: authentication, model routing, capability discovery, vision and structured proposal generation.
- Diagram engine: coordinates, handles, route waypoints, semantic animation mapping and export.

The AI cannot control access tokens, workspace permissions, arbitrary SVG paths, JavaScript or CSS.

## Consequences

The client-owned Gateway must support browser CORS for discovery, authorization-code exchange, capability discovery and response requests. Reloading the page removes the AI token and requires reconnection. Switching Gateway aborts the request and clears the AI session. Local mock mode exercises the client contract but is not evidence that a client Gateway is compatible.
