# Client AI Gateway contract

Technical Infographic is a public browser client. It does not own model credentials or proxy AI traffic. A client-owned Gateway implements this contract and decides which providers, models, quotas and retention policy apply to its users.

## Discovery

The user enters the Gateway origin. The editor requests:

```http
GET /.well-known/technical-infographic-ai
Accept: application/json
```

Example response:

```json
{
  "organizationId": "customer-organization",
  "issuer": "https://login.customer.example/",
  "authorizationEndpoint": "https://login.customer.example/authorize",
  "tokenEndpoint": "https://login.customer.example/token",
  "apiBaseUrl": "https://ai.customer.example/v1",
  "clientId": "technical-infographic-web",
  "scopes": ["openid", "profile", "diagram.generate"],
  "capabilitiesEndpoint": "https://ai.customer.example/v1/capabilities",
  "policyVersion": "1",
  "mock": false
}
```

The OAuth client is public and must use Authorization Code with PKCE (`S256`). The identity provider must register the exact editor URL as an allowed redirect URI and allow browser token exchange from that origin.

## Capabilities

After login, the editor sends the access token to `capabilitiesEndpoint`:

```http
GET /v1/capabilities
Authorization: Bearer <client-access-token>
```

```json
{
  "capabilities": [
    "structured_output",
    "vision",
    "diagram_plan",
    "diagram_patch",
    "streaming"
  ],
  "providers": [
    {
      "id": "customer-model-router",
      "label": "Company AI",
      "models": ["fast", "quality"],
      "defaultModel": "quality"
    }
  ]
}
```

Provider and model identifiers are owned by the client Gateway. They do not need to expose the upstream vendor.

## Generate a proposal

The editor sends prompt, sanitized image and scoped diagram content directly to `{apiBaseUrl}/responses`:

```http
POST /v1/responses
Authorization: Bearer <client-access-token>
Content-Type: application/json
```

The body uses an OpenAI Responses-style envelope:

```json
{
  "input": {
    "requestId": "request-id",
    "prompt": "Create an event-driven payment flow",
    "intent": "new-scene",
    "mode": "auto",
    "format": "16:9",
    "document": {},
    "selectedNodeIds": [],
    "selectedEdgeIds": [],
    "providerId": "customer-model-router",
    "model": "quality"
  },
  "response_format": {
    "type": "json_schema",
    "name": "diagram_proposal"
  }
}
```

The response must satisfy the `DiagramProposal` schema in [`contracts.ts`](../src/modules/ai/contracts.ts). The editor validates scope and schema, creates a read-only preview and requires explicit acceptance before changing the diagram.

## Browser and security requirements

- Allow CORS only for approved Technical Infographic origins.
- Allow `Authorization` and `Content-Type` request headers.
- Never put upstream provider credentials in discovery or capability responses.
- Issue audience-bound, short-lived access tokens.
- Enforce user and organization authorization at the Gateway.
- Apply model allowlists, quota and audit policy at the Gateway.
- Return no executable JavaScript, CSS, SVG paths or coordinates.
