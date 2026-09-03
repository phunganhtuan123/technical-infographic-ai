import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiagramDocument } from "@/modules/diagram/schema";
import { digest, fingerprint } from "@/modules/projects/local-project-store";

// The client keeps the access token in module scope, so every test loads its
// own copy rather than inheriting the previous test's session.
async function freshClient() {
  vi.resetModules();
  return import("@/modules/projects/api-client");
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const session = {
  user: { id: "user-1", email: "a@example.com", displayName: "A", createdAt: "", updatedAt: "" },
  accessToken: "token-1",
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};

const document = { id: "workspace-1", nodes: [], edges: [] } as unknown as DiagramDocument;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("digest", () => {
  it("is stable for the same bytes and different for a small change", () => {
    const one = JSON.stringify({ nodes: [{ id: "a", label: "Gateway" }] });
    const two = JSON.stringify({ nodes: [{ id: "a", label: "Gateways" }] });
    expect(digest(one)).toBe(digest(one));
    expect(digest(one)).not.toBe(digest(two));
  });

  it("separates documents that differ only in length", () => {
    expect(digest("")).not.toBe(digest(" "));
  });
});

describe("fingerprint", () => {
  it("ignores key order, because jsonb and IndexedDB both reorder", () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("still notices a changed value", () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });

  it("keeps array order, which is meaningful in a diagram", () => {
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
  });

  it("treats an absent key and an undefined one as the same", () => {
    expect(fingerprint({ a: 1, b: undefined })).toBe(fingerprint({ a: 1 }));
  });
});

describe("saveDocument", () => {
  it("hands the server's copy back on a version conflict", async () => {
    const client = await freshClient();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/auth/login")) return jsonResponse(200, session);
      return jsonResponse(409, {
        error: { code: "version_conflict", message: "This project changed somewhere else." },
        current: { version: 9, document: { id: "workspace-1", nodes: [{ id: "n1" }], edges: [] } },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await client.signIn("a@example.com", "password-1234");
    const failure = await client.saveDocument("project-1", document, 7).catch((error) => error);

    expect(failure).toBeInstanceOf(client.ConflictError);
    expect(failure.current.version).toBe(9);
    expect(failure.current.document).toMatchObject({ id: "workspace-1" });
  });

  it("sends the version it started from as If-Match", async () => {
    const client = await freshClient();
    const seen: Array<Record<string, string>> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/v1/auth/login")) return jsonResponse(200, session);
      seen.push(Object.fromEntries(new Headers(init.headers).entries()));
      return jsonResponse(200, { id: "project-1", version: 8, title: "One" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await client.signIn("a@example.com", "password-1234");
    const saved = await client.saveDocument("project-1", document, 7);

    expect(saved.version).toBe(8);
    expect(seen[0]["if-match"]).toBe('"7"');
    expect(seen[0].authorization).toBe("Bearer token-1");
  });
});

describe("access tokens", () => {
  it("refreshes once and retries after a 401, rather than failing the save", async () => {
    const client = await freshClient();
    let saves = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/auth/login")) return jsonResponse(200, session);
      if (url.endsWith("/v1/auth/refresh")) {
        return jsonResponse(200, { ...session, accessToken: "token-2" });
      }
      saves += 1;
      if (saves === 1) return jsonResponse(401, { error: { code: "token_invalid", message: "expired" } });
      return jsonResponse(200, { id: "project-1", version: 2, title: "One" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await client.signIn("a@example.com", "password-1234");
    const saved = await client.saveDocument("project-1", document, 1);

    expect(saved.version).toBe(2);
    expect(saves).toBe(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/v1/auth/refresh"))).toBe(true);
  });

  it("refreshes only once when several requests race", async () => {
    const client = await freshClient();
    let refreshes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/v1/auth/refresh")) {
          refreshes += 1;
          // Answer slowly enough that all three callers are waiting on it.
          await new Promise((resolve) => setTimeout(resolve, 10));
          return jsonResponse(200, session);
        }
        return jsonResponse(200, { projects: [] });
      }),
    );

    await Promise.all([client.listProjects(), client.listProjects(), client.listProjects()]);
    expect(refreshes).toBe(1);
  });
});

describe("offline", () => {
  it("reports a failed request as offline rather than as an error to give up on", async () => {
    const client = await freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/v1/auth/login")) return jsonResponse(200, session);
        throw new TypeError("Failed to fetch");
      }),
    );

    await client.signIn("a@example.com", "password-1234");
    const failure = await client.listProjects().catch((error) => error);

    expect(failure).toBeInstanceOf(client.ApiError);
    expect(failure.isOffline).toBe(true);
  });

  it("keeps the session when a refresh cannot reach the server", async () => {
    const client = await freshClient();
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/v1/auth/login")) return jsonResponse(200, session);
        attempts += 1;
        throw new TypeError("Failed to fetch");
      }),
    );

    await client.signIn("a@example.com", "password-1234");
    await client.restoreSession();

    expect(attempts).toBe(1);
    // Offline is not signed out: losing the session here would throw away the
    // person's place for the length of a tunnel.
    expect(client.sessionSnapshot()).not.toBeNull();
  });

  it("does sign out when the refresh cookie is refused", async () => {
    const client = await freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/v1/auth/login")) return jsonResponse(200, session);
        return jsonResponse(401, { error: { code: "unauthorized", message: "Sign in to continue." } });
      }),
    );

    await client.signIn("a@example.com", "password-1234");
    await client.restoreSession();

    expect(client.sessionSnapshot()).toBeNull();
  });
});
