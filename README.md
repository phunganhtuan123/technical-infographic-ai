# Technical Infographic Web

Local-first MVP of the AI technical visual editor. It converts typed `DiagramPlan` data into a validated `DiagramDocument`, lays it out by semantic lane, and renders an editable canvas with custom nodes and edges.

## Run locally

```sh
npm install
npm run dev
```

Open `http://localhost:3000`.

Development can use a client-side mock AI Gateway:

```sh
cp .env.example .env.local
# Keep NEXT_PUBLIC_AI_GATEWAY_MOCK=true.
```

The application server does not configure AI providers or expose Gateway metadata. In production, the user connects a client-owned Gateway from the editor. Prompt, image, comment, model response and proposal payloads go directly between the browser and that Gateway. See [the AI MVP PRD](docs/ai-mvp-prd.md) and [the client-Gateway ADR](docs/adr-001-client-ai-gateway.md).

## Connect client-owned AI

Open **Config → AI connections** in the editor. Three connection modes are available:

- **Codex Local** uses the existing `codex login` session on the machine.
- **Claude Local** uses the existing `ant auth login` session on the machine.
- **Organization Gateway** connects to a client-owned Gateway through SSO.

For either local option, start the loopback connector in a second terminal:

```sh
npm run ai:local
```

People using a deployed editor do not need a clone at all:

```sh
npx technical-infographic-connector --editor https://your-editor.example
```

The connector lives in [`tools/local-ai-connector`](tools/local-ai-connector) and listens only on `127.0.0.1:47821`. It offers everything this machine can reach — a model served by Ollama or any OpenAI-compatible server, the `claude` CLI, the `codex` CLI, or an `ANTHROPIC_API_KEY` — so Claude Local and Codex Local each land on the right one. Only the last needs a key. The browser performs an explicit PKCE pairing flow and receives an opaque token that expires in eight hours; no credential ever reaches the page.

For an organization connection, set `NEXT_PUBLIC_AI_GATEWAY_MOCK=false` and enter the Gateway URL in Config. The Gateway must publish:

```txt
GET /.well-known/technical-infographic-ai
GET /v1/capabilities
POST /v1/responses
```

The discovery document supplies the OIDC Authorization Code with PKCE endpoints, public client ID, API URL and capability URL. Only the Gateway origin is persisted locally; the access token remains in memory. Technical Infographic never receives or stores the client provider credentials. After connecting, users can leave routing on Auto or choose a model exposed by their Gateway.

See the complete [Client AI Gateway contract](docs/client-ai-gateway-contract.md).

## Implemented in this slice

- `DiagramPlan` and `DiagramDocument` schemas
- deterministic semantic compiler
- role-based colors and technology badges
- stable semantic ordering with lane-aware placement
- exact named ports and orthogonal connectors
- fan-out routing that avoids intermediate consumers
- draggable and resizable nodes, reconnectable edges, layered 8 px grid, alignment hints, fit view, and balanced auto-layout
- workspace create, rename, duplicate, Save as, delete, JSON import/export, and local persistence in IndexedDB
- nine numbered, collapsible example diagrams: one canonical sample for each supported diagram mode
- click insertion and drag/drop from the primitive library
- free-grid placement for click-inserted nodes
- single and multi-item selection with Shift, Control, or Command; Inspector style edits apply to every selected component
- internal component copy/paste with `Command/Ctrl+C` and `Command/Ctrl+V`, including nested container membership and connections whose endpoints are both copied
- inline name and description editing on the selected component
- direct item editing from the Inspector: type, name, description, supporting caption, separate note, size, custom color, technology icon, background image, image fit/opacity, and z-index
- shared type icons across the component library and canvas, with technology marks kept as secondary badges
- resizable left library and right Inspector panels
- higher-contrast side-panel typography sized for sustained editing
- component categories that expand/collapse in Grid and Tree views, with a short description on every primitive
- resizable Zone and Group containers that own and move nested components; their only content is a draggable border label
- free Text and technical Note annotations
- canvas context menu for selection-aware copy/paste, Auto-fit selected layout, Text, Note, Group, Ungroup, and multi-selection style matching
- keyboard and Inspector deletion for selected components and connections
- selectable connections with a stable axis-constrained control on every editable path segment, multi-waypoint persistence, auto-route reset, double-click caption editing, path-constrained caption placement, direction, semantic type, color, solid/dashed/dotted stroke, thickness, pulse/trail/glow/dash/signal effect, and speed
- common flowchart primitives: Start, Process, Decision, Input / Output, End, Document, Subprocess, Manual Input, Preparation, Delay, Connector, Off-page, Merge, and Stored Data
- shape-specific SVG geometry shared by the library, canvas, and exports
- component border controls for solid/dashed/dotted style and width, with pulse/trail/glow/scan/breathe effects and speed
- on-canvas horizontal and vertical alignment guides while dragging near another component
- eight connection ports per component, including edge-center targets, large invisible hit areas, 56 px connection snapping, straight connection previews, compact arrow markers outside component bodies, and obstacle-aware orthogonal routes with straight rounded endpoint leads
- deterministic, format-aware Auto-layout preserves configured component sizes, separates semantic lanes, keeps async clusters outside owned data columns, clears stale manual routes, and selects valid directional ports
- working Full, 16:9, 1:1, 4:5, and 9:16 canvas formats, carried through workspace JSON and SVG export
- persisted Scenes with add, switch, rename, duplicate, and delete operations
- deterministic edge layering plus opaque casing and color halos, so the upper line visibly bridges across the lower line at crossings
- 44 draggable technology components with shared brand SVGs across the library, canvas, and Inspector; coverage includes AWS, GCP, databases, streams, runtimes, auth, infrastructure, and observability
- client-connected AI Gateway with PKCE, capability discovery and memory-only access tokens
- prompt/image generation with a preflight clarification dialog, progressive live-build preview, persistent per-workspace AI sessions, and local comment threads for nodes, edges and multi-selection
- strict structured proposals with read-only preview, Accept/Reject, Regenerate, Cancel and stale-snapshot protection
- animated SVG and self-contained HTML export, static 2× PNG, looping GIF, WebM video, and editable workspace JSON
- exported edge pulse/trail/glow/dash/signal motion and component pulse/glow/trail/scan/breathe effects
- architecture fixture derived from the original skill acceptance test
- compiler, layout, factory, and AI contract tests

Cloud sharing and collaborative projects are not connected in this MVP.
