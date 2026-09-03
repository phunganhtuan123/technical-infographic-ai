import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The connector as one runnable file.
//
// It ships as two modules, which is right for the repo and wrong for someone
// who just wants to run it: a download has to be a single file, or the
// instruction stops being one line. The two sources are stitched here at
// request time rather than at build time so the file always matches the
// connector this deployment is actually running.
//
//   curl -fsSL https://<editor>/connector -o ti-connector.mjs
//   node ti-connector.mjs --editor https://<editor>

const root = join(process.cwd(), "tools", "local-ai-connector", "src");

export async function GET() {
  try {
    const [backends, server] = await Promise.all([
      readFile(join(root, "backends.mjs"), "utf8"),
      readFile(join(root, "server.mjs"), "utf8"),
    ]);

    // A shebang is only legal on the first line, and server.mjs carries one of
    // its own — left in place it would land mid-file and fail to parse.
    const stripShebang = (source: string) => source.replace(/^#![^\n]*\n/, "");

    // Function declarations hoist, so concatenating in this order is enough;
    // only the cross-module import has to go.
    const merged = [
      "#!/usr/bin/env node",
      "// Technical Infographic local AI connector — generated bundle, do not edit.",
      "// Source: tools/local-ai-connector in the editor repository.",
      "",
      stripShebang(backends),
      "",
      stripShebang(server).replace(/^import\s*\{[^}]*\}\s*from\s*["']\.\/backends\.mjs["'];?\s*$/m, ""),
    ].join("\n");

    return new Response(merged, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Content-Disposition": 'attachment; filename="ti-connector.mjs"',
        "Cache-Control": "no-cache, must-revalidate",
      },
    });
  } catch {
    return new Response("connector source unavailable\n", { status: 500 });
  }
}
