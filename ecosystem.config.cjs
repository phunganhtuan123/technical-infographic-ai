// pm2 deployment for this machine.
//
//   pm2 start ecosystem.config.cjs
//   pm2 restart technical-infographic-connector --update-env   # after an edit
//
// Which AI answers is decided in .env.local, not here, so switching between the
// Claude CLI and a local Ollama model is an edit and a restart rather than a
// change to the deployment. See AI_BACKEND in .env.example.
//
// The connector fronts a CLI that is already logged in, so it is bound past
// loopback deliberately: the editor is served to other machines on the LAN and
// their browsers are what has to reach it. Callers are restricted to private
// addresses by the connector itself; keep 47821 closed at the network edge.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const HOST_IP = "192.168.1.250";
const APP_PORT = 8095;
const CONNECTOR_PORT = 47821;
// The editor is served over HTTPS through a Cloudflare tunnel. The connector is
// reached by proxying it under that same origin (next.config.ts rewrites), so
// it can stay bound to loopback and never needs a port of its own exposed.
const PUBLIC_EDITOR = process.env.PUBLIC_EDITOR_ORIGIN || "https://infographic.flytory.com";

/** Read .env.local so one file configures both processes. Real env wins. */
function fileEnv() {
  try {
    return Object.fromEntries(
      readFileSync(join(__dirname, ".env.local"), "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
        })
        .filter(([key]) => key),
    );
  } catch {
    return {};
  }
}

const settings = { ...fileEnv(), ...process.env };
const editorOrigins = [PUBLIC_EDITOR, `http://${HOST_IP}:${APP_PORT}`, `http://192.168.1.249:${APP_PORT}`, `http://10.0.0.3:${APP_PORT}`].join(",");

module.exports = {
  apps: [
    {
      name: "technical-infographic",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: ["start", "-H", "0.0.0.0", "-p", String(APP_PORT)],
      env: { NODE_ENV: "production" },
    },
    {
      name: "technical-infographic-connector",
      cwd: __dirname,
      script: "tools/local-ai-connector/src/server.mjs",
      args: [
        // Loopback only: the Next server is the only thing that talks to it.
        "--host", "127.0.0.1",
        "--port", String(CONNECTOR_PORT),
        "--public-origin", `${PUBLIC_EDITOR}/ai-connector`,
        "--editor", editorOrigins,
      ],
      env: {
        HOME: "/home/anthu",
        PATH: `/home/anthu/.local/bin:${process.env.PATH}`,
        // The connector reads these itself; flags are left out on purpose so
        // .env.local stays the single place these are decided.
        AI_BACKEND: settings.AI_BACKEND || "local",
        AI_BASE_URL: settings.AI_BASE_URL || "http://127.0.0.1:11434",
        CLAUDE_CLI: settings.CLAUDE_CLI || "/home/anthu/.local/bin/claude",
        ...(settings.AI_MODEL ? { AI_MODEL: settings.AI_MODEL } : {}),
        ...(settings.GEMINI_API_KEY ? { GEMINI_API_KEY: settings.GEMINI_API_KEY } : {}),
      },
    },
  ],
};
