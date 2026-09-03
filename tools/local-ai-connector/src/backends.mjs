// Backends
// ---------------------------------------------------------------------------
// The connector speaks one small interface to whatever is generating diagrams:
//
//   { id, label, listModels(), complete({ system, userText, image, schema,
//                                         schemaName, model }) -> object }
//
// Three implementations ship here. None of them is required to exist — the
// connector detects what this machine actually has at boot.
//
//   local   a model running on this machine (Ollama, LM Studio, llama.cpp).
//           No key, no network egress, no cost. Small models drift from a
//           schema more often, so this path leans on constrained decoding
//           where the server supports it.
//   claude  the `claude` CLI already logged in on this machine.
//   codex   the `codex` CLI already logged in on this machine.
//   gemini  a Google AI Studio key, held in memory only.
//   api     an Anthropic API key. Only used when explicitly configured.
//
// Every backend that this machine can actually reach is offered at once, so the
// editor's Claude Local and Codex Local buttons each land on the right one.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ANTHROPIC_API = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

// --------------------------------------------------------------------- utils

/** Pull the first balanced JSON object out of loose model output. */
export function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf("{");
  if (start === -1) throw new Error("The model returned no JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
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

function splitDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl ?? "");
  return match ? { mediaType: match[1], data: match[2] } : undefined;
}

async function reachable(url, timeoutMs = 900) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

function runCommand(command, args, { input, timeoutMs = 180_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${(stderr || stdout).slice(0, 400).trim()}`));
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** Read an NDJSON stream, concatenating whatever `pick` finds on each line. */
async function collectNdjson(response, pick) {
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try { text += pick(JSON.parse(line)) ?? ""; } catch { /* partial or non-JSON keepalive */ }
    }
  }
  if (buffer.trim()) { try { text += pick(JSON.parse(buffer)) ?? ""; } catch { /* trailing noise */ } }
  return text;
}

/** Read an SSE stream, concatenating whatever `pick` finds in each data frame. */
async function collectSse(response, pick) {
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try { text += pick(JSON.parse(payload)) ?? ""; } catch { /* partial frame */ }
    }
  }
  return text;
}

// ------------------------------------------------------------- local backend

function localBackend({ baseUrl, flavour, preferredModel }) {
  const ollama = flavour === "ollama";

  async function listModels() {
    try {
      if (ollama) {
        const body = await (await fetch(`${baseUrl}/api/tags`)).json();
        const models = (body.models ?? []).map((model) => model.name).filter(Boolean);
        if (models.length) return models;
      } else {
        const body = await (await fetch(`${baseUrl}/v1/models`)).json();
        const models = (body.data ?? []).map((model) => model.id).filter(Boolean);
        if (models.length) return models;
      }
    } catch {
      // fall through to whatever was configured
    }
    return preferredModel ? [preferredModel] : [];
  }

  async function complete({ system, userText, image, schema, schemaName, model }) {
    const picture = splitDataUrl(image?.dataUrl);

    if (ollama) {
      // Ollama constrains decoding to the schema, which is the only reliable
      // way to keep a small model inside the diagram contract.
      //
      // Streamed, not because the tokens are shown anywhere, but because a
      // non-streamed reply sends no headers until generation ends — and a large
      // model can take longer than the 300s header timeout in Node's fetch. With
      // streaming the headers land immediately and each token resets the clock.
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          format: schema,
          options: { temperature: 0.3 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userText, ...(picture ? { images: [picture.data] } : {}) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Ollama request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
      return extractJson(await collectNdjson(response, (event) => event.message?.content));
    }

    // LM Studio, llama.cpp and friends: OpenAI-compatible. Ask for a schema
    // first, drop to plain JSON mode if the server does not know that shape.
    const content = picture
      ? [{ type: "text", text: userText }, { type: "image_url", image_url: { url: image.dataUrl } }]
      : userText;
    const messages = [{ role: "system", content: system }, { role: "user", content }];

    const attempt = async (responseFormat) => fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, temperature: 0.3, stream: true, messages, response_format: responseFormat }),
    });

    let response = await attempt({ type: "json_schema", json_schema: { name: schemaName, schema, strict: true } });
    if (response.status === 400 || response.status === 422) {
      response = await attempt({ type: "json_object" });
    }
    if (!response.ok) throw new Error(`Local model request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    // Same reason as Ollama above: streamed so headers arrive before the model
    // has finished thinking. SSE frames rather than NDJSON here.
    return extractJson(await collectSse(response, (event) => event.choices?.[0]?.delta?.content));
  }

  return {
    id: "local",
    providerId: "local",
    label: ollama ? "Ollama (this machine)" : "Local model (this machine)",
    vision: true,
    listModels,
    complete,
  };
}

// --------------------------------------------------------------- cli backend

function cliBackend({ command, version, preferredModel }) {
  // Claude Code reads project instructions (CLAUDE.md, AGENTS.md) from its
  // working directory. Diagram generation wants none of that context, and
  // inheriting the connector's cwd would quietly bill every request for it, so
  // each run happens in an empty scratch directory.
  const scratch = mkdtemp(join(tmpdir(), "ti-claude-")).catch(() => undefined);

  // The CLI accepts an alias or a full model id. Offer the aliases so the
  // editor's model picker is useful; "default" means whatever the login prefers.
  const aliases = ["default", "sonnet", "opus", "haiku"];

  async function listModels() {
    const models = preferredModel && !aliases.includes(preferredModel) ? [preferredModel, ...aliases] : aliases;
    return models.map((model) => model);
  }

  async function complete({ system, userText, image, schema, schemaName, model }) {
    // Headless Claude Code has no structured-output switch, so the schema goes
    // in the prompt and the reply is parsed back out.
    const instructions = [
      system,
      "",
      `Reply with a single JSON object and nothing else — no prose, no explanation, no markdown fence.`,
      `It must validate against this JSON Schema (${schemaName}):`,
      JSON.stringify(schema),
      "",
      "Request:",
      userText,
    ].join("\n");

    const chosen = model && model !== "auto" && model !== "default" ? ["--model", model] : [];
    const cwd = await scratch;

    let stdout;
    try {
      stdout = await runCommand(command, ["-p", "--output-format", "json", ...chosen], { input: instructions, cwd });
    } catch {
      stdout = await runCommand(command, ["-p", ...chosen], { input: instructions, cwd });
    }

    // `--output-format json` wraps the answer; plain mode returns it directly.
    let text = stdout;
    try {
      const envelope = JSON.parse(stdout);
      if (typeof envelope?.result === "string") text = envelope.result;
      else if (typeof envelope?.content === "string") text = envelope.content;
      else if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) return envelope;
    } catch {
      // plain text output, parse it below
    }
    if (image) throw new Error("The Claude CLI backend cannot read attached images — remove the image or switch backends");
    return extractJson(text);
  }

  return { id: "claude", providerId: "anthropic", label: version ? `Claude CLI ${version}` : "Claude CLI", vision: false, listModels, complete };
}

// ------------------------------------------------------------- codex backend

function codexBackend({ command, version }) {
  async function listModels() {
    return ["default"];
  }

  async function complete({ system, userText, image, schema, schemaName }) {
    if (image) throw new Error("The Codex CLI backend cannot read attached images — remove the image or switch providers");

    const prompt = [system, "", "Request:", userText].join("\n");
    const directory = await mkdtemp(join(tmpdir(), "ti-connector-"));
    const schemaPath = join(directory, `${schemaName}.json`);
    const outputPath = join(directory, "result.json");

    try {
      // Codex can constrain the answer to a JSON Schema on disk, which is far
      // more dependable than asking for JSON in the prompt.
      await writeFile(schemaPath, JSON.stringify(schema), "utf8");
      try {
        await runCommand(command, ["exec", "--output-schema", schemaPath, "-o", outputPath, "-"], { input: prompt });
        return JSON.parse(await readFile(outputPath, "utf8"));
      } catch {
        // Older builds without --output-schema: ask in the prompt and parse.
        const stdout = await runCommand(command, ["exec", "-"], {
          input: [
            prompt,
            "",
            "Reply with a single JSON object and nothing else — no prose, no markdown fence.",
            `It must validate against this JSON Schema (${schemaName}):`,
            JSON.stringify(schema),
          ].join("\n"),
        });
        return extractJson(stdout);
      }
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return { id: "codex", providerId: "codex", label: version ? `Codex CLI ${version.replace(/^codex-cli\s*/, "")}`.trim() : "Codex CLI", vision: false, listModels, complete };
}

// ------------------------------------------------------------ gemini backend

/**
 * Gemini takes an OpenAPI subset, not full JSON Schema: `additionalProperties`
 * and `$schema` make it reject the request outright. Everything the diagram
 * schema actually relies on — type, enum, required, items, properties — survives.
 */
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties" || key === "$schema") continue;
    out[key] = toGeminiSchema(value);
  }
  return out;
}

function geminiBackend({ apiKey, preferredModel }) {
  async function listModels() {
    try {
      const response = await fetch(`${GEMINI_API}/models?key=${encodeURIComponent(apiKey)}&pageSize=100`);
      if (response.ok) {
        const body = await response.json();
        const models = (body.models ?? [])
          .filter((model) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
          .map((model) => String(model.name ?? "").replace(/^models\//, ""))
          .filter((name) => name.startsWith("gemini"));
        if (models.length) return models;
      }
    } catch {
      // fall through to whatever was configured
    }
    return preferredModel ? [preferredModel] : ["gemini-2.5-flash"];
  }

  async function complete({ system, userText, image, schema, model }) {
    const picture = splitDataUrl(image?.dataUrl);
    const parts = [];
    if (picture) parts.push({ inline_data: { mime_type: picture.mediaType, data: picture.data } });
    parts.push({ text: userText });

    const target = model && model !== "auto" ? model : preferredModel ?? "gemini-2.5-flash";
    const response = await fetch(`${GEMINI_API}/models/${encodeURIComponent(target)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", responseSchema: toGeminiSchema(schema), temperature: 0.2 },
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    const body = await response.json();
    const text = (body.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
    if (!text.trim()) throw new Error("Gemini returned no content");
    return extractJson(text);
  }

  return { id: "gemini", providerId: "gemini", label: "Gemini (API key)", vision: true, listModels, complete };
}

// --------------------------------------------------------------- api backend

function apiBackend({ apiKey, preferredModel }) {
  async function anthropic(path, init = {}) {
    const response = await fetch(`${ANTHROPIC_API}${path}`, {
      ...init,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Anthropic ${path} failed (${response.status}): ${detail.slice(0, 300)}`);
    }
    return response.json();
  }

  async function listModels() {
    try {
      const body = await anthropic("/models?limit=40", { method: "GET" });
      const models = (body.data ?? []).map((model) => model.id).filter((id) => typeof id === "string" && id.startsWith("claude"));
      if (models.length) return models;
    } catch {
      // fall through
    }
    return preferredModel ? [preferredModel] : [];
  }

  async function complete({ system, userText, image, schema, schemaName, model }) {
    const picture = splitDataUrl(image?.dataUrl);
    const content = [];
    if (picture) content.push({ type: "image", source: { type: "base64", media_type: picture.mediaType, data: picture.data } });
    content.push({ type: "text", text: userText });

    const body = await anthropic("/messages", {
      method: "POST",
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        system,
        tools: [{ name: schemaName, description: "Return the structured diagram data.", input_schema: schema }],
        tool_choice: { type: "tool", name: schemaName },
        messages: [{ role: "user", content }],
      }),
    });
    const call = (body.content ?? []).find((block) => block.type === "tool_use");
    if (!call) throw new Error("Claude returned no structured diagram");
    return call.input;
  }

  return { id: "api", providerId: "anthropic", label: "Claude (API key)", vision: true, listModels, complete };
}

/** Confirm a Gemini key actually authenticates before it is accepted. */
export async function validateGeminiKey(apiKey) {
  const response = await fetch(`${GEMINI_API}/models?key=${encodeURIComponent(apiKey)}&pageSize=1`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok) return true;
  const detail = await response.text().catch(() => "");
  throw new Error(response.status === 400 || response.status === 403
    ? "That Gemini key was rejected by Google."
    : `Gemini key check failed (${response.status}): ${detail.slice(0, 200)}`);
}

// ----------------------------------------------------------------- detection

async function detectLocal(baseUrl) {
  if (await reachable(`${baseUrl}/api/tags`)) return "ollama";
  if (await reachable(`${baseUrl}/v1/models`)) return "openai";
  return undefined;
}

async function detectCli(command) {
  try {
    const output = await runCommand(command, ["--version"], { timeoutMs: 8000 });
    return output.trim().split(/\s+/)[0] || "installed";
  } catch {
    return undefined;
  }
}

/**
 * Everything this machine can actually use, in preference order: a local model
 * first because it costs nothing and sends nothing anywhere, then the CLIs the
 * person is already logged into, then an API key.
 *
 * `wanted` narrows the set — "local", "claude", "codex", "api", or several
 * separated by commas. Two backends never share a provider id; the earlier one
 * wins, so a live `claude` CLI takes precedence over an API key.
 *
 * When `wanted` is given, its order is the preference order, because the first
 * backend is what "Auto" resolves to. `claude,local` therefore means "Claude
 * CLI by default, Ollama still offered in the picker" — the opposite of the
 * built-in order, and not something the caller should have to accept.
 */
export async function discoverBackends({ wanted, baseUrl, cliCommand, codexCommand, apiKey, geminiKey, preferredModel }) {
  const only = (wanted ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const allow = (id) => only.length === 0 || only.includes(id);
  const found = [];
  const tried = [];

  if (allow("local")) {
    const flavour = await detectLocal(baseUrl);
    if (flavour) found.push(localBackend({ baseUrl, flavour, preferredModel }));
    else tried.push(`local model at ${baseUrl}`);
  }

  if (allow("claude")) {
    const version = await detectCli(cliCommand);
    if (version) found.push(cliBackend({ command: cliCommand, version, preferredModel }));
    else tried.push(`\`${cliCommand}\` on PATH`);
  }

  if (allow("codex")) {
    const version = await detectCli(codexCommand);
    if (version) found.push(codexBackend({ command: codexCommand, version }));
    else tried.push(`\`${codexCommand}\` on PATH`);
  }

  if (allow("gemini")) {
    if (geminiKey) found.push(geminiBackend({ apiKey: geminiKey, preferredModel }));
    else tried.push("GEMINI_API_KEY");
  }

  if (allow("api")) {
    if (apiKey) found.push(apiBackend({ apiKey, preferredModel }));
    else tried.push("ANTHROPIC_API_KEY");
  }

  if (only.length) found.sort((left, right) => only.indexOf(left.id) - only.indexOf(right.id));

  const seen = new Set();
  const backends = found.filter((backend) => {
    if (seen.has(backend.providerId)) return false;
    seen.add(backend.providerId);
    return true;
  });

  if (!backends.length) {
    const error = new Error(only.length ? `None of the requested backends is available: ${only.join(", ")}` : "No AI backend available");
    error.tried = tried;
    throw error;
  }
  return backends;
}
