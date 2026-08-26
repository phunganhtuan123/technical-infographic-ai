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

function runCommand(command, args, { input, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
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
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          format: schema,
          options: { temperature: 0.3 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userText, ...(picture ? { images: [picture.data] } : {}) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Ollama request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
      const body = await response.json();
      return extractJson(body.message?.content ?? "");
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
      body: JSON.stringify({ model, temperature: 0.3, messages, response_format: responseFormat }),
    });

    let response = await attempt({ type: "json_schema", json_schema: { name: schemaName, schema, strict: true } });
    if (response.status === 400 || response.status === 422) {
      response = await attempt({ type: "json_object" });
    }
    if (!response.ok) throw new Error(`Local model request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const body = await response.json();
    return extractJson(body.choices?.[0]?.message?.content ?? "");
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

function cliBackend({ command, version }) {
  async function listModels() {
    return [version ? `claude-cli ${version}` : "claude-cli"];
  }

  async function complete({ system, userText, image, schema, schemaName }) {
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

    let stdout;
    try {
      stdout = await runCommand(command, ["-p", "--output-format", "json"], { input: instructions });
    } catch {
      stdout = await runCommand(command, ["-p"], { input: instructions });
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

  return { id: "claude", providerId: "anthropic", label: "Claude CLI (this machine)", vision: false, listModels, complete };
}

// ------------------------------------------------------------- codex backend

function codexBackend({ command, version }) {
  async function listModels() {
    return [version ? `codex-cli ${version}` : "codex-cli"];
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

  return { id: "codex", providerId: "codex", label: "Codex CLI (this machine)", vision: false, listModels, complete };
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
 */
export async function discoverBackends({ wanted, baseUrl, cliCommand, codexCommand, apiKey, preferredModel }) {
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
    if (version) found.push(cliBackend({ command: cliCommand, version }));
    else tried.push(`\`${cliCommand}\` on PATH`);
  }

  if (allow("codex")) {
    const version = await detectCli(codexCommand);
    if (version) found.push(codexBackend({ command: codexCommand, version }));
    else tried.push(`\`${codexCommand}\` on PATH`);
  }

  if (allow("api")) {
    if (apiKey) found.push(apiBackend({ apiKey, preferredModel }));
    else tried.push("ANTHROPIC_API_KEY");
  }

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
