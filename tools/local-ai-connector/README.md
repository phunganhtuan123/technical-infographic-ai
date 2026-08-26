# Local AI Connector

A client-owned AI Gateway that runs on your own machine. It exists so the editor
can generate diagrams without the Technical Infographic server ever seeing a
prompt, an image, or a diagram — the arrangement described in
[ADR-001](../../docs/adr-001-client-ai-gateway.md).

```
browser  ──PKCE──▶  connector (127.0.0.1:47821)  ──▶  Ollama | claude CLI | codex CLI | Anthropic
```

The browser never holds a credential. It receives an opaque token minted here,
valid for eight hours.

## Run it

From a clone of this repo:

```sh
npm run ai:local
```

Or, with nothing checked out — this is what to tell people using a deployed
editor:

```sh
npx technical-infographic-connector --editor https://infographic.company.com
```

Then in the editor: **Config → AI connections**, and pick Claude Local or Codex
Local. A pairing page opens, lists what the connector found on this machine, and
returns you to the editor holding a token.

## Backends

Everything this machine can reach is offered at once, so **Claude Local** and
**Codex Local** in the editor each land on the right one and the model dropdown
lists what that backend actually has. Narrow the set with
`--backend local,claude,codex,api`.

Discovery order is local, then `claude`, then `codex`, then an API key — cheapest
and most private first. Two backends never share a provider id, so a live
`claude` CLI wins over an API key.

### 1. `local` — a model running on your machine

No key, no cost, nothing leaves the machine. Ollama is detected automatically on
its default port:

```sh
ollama serve
ollama pull qwen2.5-coder:14b
npm run ai:local
```

With Ollama the connector uses constrained decoding (`format` set to the diagram
JSON Schema), which is the only dependable way to keep a smaller model inside the
contract. LM Studio, llama.cpp and anything else OpenAI-compatible work too —
point `AI_BASE_URL` at them and the connector asks for
`response_format: json_schema`, falling back to plain JSON mode if the server
does not recognise it.

Proposals from this backend carry a visible warning and a lower confidence
score, because small models get roles and lanes wrong more often than Claude
does. Read the preview before accepting.

### 2. `claude` — the `claude` CLI already logged in here

If `claude --version` works, the connector spawns `claude -p` and parses the
diagram back out of the reply. No key to manage, and the diagram quality is the
best on offer because it is still Claude. Two costs: each request is a process
spawn, so it is slower, and it draws on your Claude Code allowance rather than
API credit.

Appears in the editor as the provider behind **Claude Local**.

### 3. `codex` — the `codex` CLI already logged in here

Same idea with `codex exec`. Codex can constrain its answer to a JSON Schema on
disk (`--output-schema`), which the connector uses; on builds without that flag
it falls back to asking for JSON in the prompt and parsing the reply.

Appears in the editor as the provider behind **Codex Local**.

Neither CLI path reads attached images. The connector says so plainly instead of
dropping the image in silence, and only advertises the `vision` capability when
something present can actually use it.

### 4. `api` — an Anthropic API key

Used only when nothing above is available, or when `--backend api` is set.
Forces a tool call whose `input_schema` mirrors `diagramPlanSchema`.

## Configuration

Flags win over environment variables, so nothing has to be exported.

| Flag | Variable | Default | Purpose |
| --- | --- | --- | --- |
| `--editor` | `EDITOR_ORIGIN` | — | Deployed editor origins allowed to pair, comma separated |
| `--backend` | `AI_BACKEND` | all found | Narrow to `local`, `claude`, `codex`, `api` |
| `--base-url` | `AI_BASE_URL` | `http://127.0.0.1:11434` | Where the local model server listens |
| `--model` | `AI_MODEL` | first one found | Preferred default among the models a backend reports |
| `--claude-cli` | `CLAUDE_CLI` | `claude` | Path to the CLI, if it is not on `PATH` |
| `--codex-cli` | `CODEX_CLI` | `codex` | Path to the CLI, if it is not on `PATH` |
| `--port` | `AI_CONNECTOR_PORT` | `47821` | Must match the port the editor's Local buttons use |
| — | `ANTHROPIC_API_KEY` | — | Only needed for the `api` backend |

The model list shown in the editor comes from whichever backend is live —
`/api/tags` for Ollama, `/v1/models` for OpenAI-compatible servers and the
Anthropic API — so it reflects what you can actually reach rather than a list
frozen in this file.

## When the editor is deployed

The connector always runs on the *user's* machine, never on the server — that is
the whole point. `127.0.0.1` in the browser means the machine the browser is on.
So a deployed editor still talks to a connector each person started themselves.

Two things change once the page is not on `localhost`:

**Name the editor.** By default the connector pairs only with a page served from
this machine, so a random site cannot reach the AI running here. Point it at your
deployment explicitly:

```sh
npx technical-infographic-connector --editor https://infographic.company.com
```

Several are allowed, comma separated. Anything not listed is refused at both the
CORS layer and the PKCE `redirect_uri` check.

**Expect a browser permission prompt.** Chrome 142 and later ask the user before
a public page may reach a loopback address, under Local Network Access. The
connector answers the older preflight negotiation
(`Access-Control-Allow-Private-Network`) where a browser still uses it, but the
newer prompt is the user's decision and no header removes it. Safari is the
strictest of the three engines here — test the pairing flow there before telling
anyone it works.

This shape suits an internal engineering tool, where the people using it already
have `claude` or `codex` on their machine and one `npx` command is no burden. It
does not suit a general audience — they would have to install Node, run a
terminal command, and approve a local-network prompt before seeing anything.

For that audience, host this same contract as an Organization Gateway: the
endpoints below are unchanged, but real OIDC sits in front and the credential
lives on your server instead of on every laptop. Both can be offered at the same
time; they are three separate buttons in the editor's Config panel for exactly
that reason.

## What it implements

Everything in [the gateway contract](../../docs/client-ai-gateway-contract.md):

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/technical-infographic-ai` | Discovery document |
| `GET /authorize` | PKCE authorization with a human approval step |
| `POST /token` | Authorization code exchange, `S256` verifier check |
| `GET /v1/capabilities` | One provider entry per backend found here, with its models |
| `POST /v1/responses` | Prompt in, validated `DiagramProposal` out |

Edges pointing at components that do not exist are dropped and reported as
warnings instead of failing the whole proposal. For `modify-selection` the
connector filters the result down to the ids the browser captured, so a proposal
can never reach outside the selection. The browser re-validates everything with
zod before showing a preview, and nothing touches the canvas without an explicit
Accept.

## Security notes

- Binds to the loopback interface only. Nothing on your network can reach it.
- CORS and PKCE `redirect_uri` are granted only to `localhost` / `127.0.0.1`
  origins plus whatever `EDITOR_ORIGIN` names.
- Authorization codes live five minutes and are single use.
- Requests larger than 12 MB are refused.
- The connector never returns executable JavaScript, CSS, SVG paths, or
  coordinates — the contract forbids it and the compiler decides layout.
