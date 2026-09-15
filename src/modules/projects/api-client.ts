// Everything this editor says to the Technical Infographic API.
//
// Two decisions shape the file. The access token lives in a module variable and
// never reaches localStorage — anything that can read localStorage can read the
// token, and fifteen minutes in memory dies with the tab. The refresh token is
// never seen here at all: it is an HttpOnly cookie scoped to /v1/auth that the
// browser attaches on its own, which is why the auth calls send credentials and
// nothing else does.

import type { DiagramDocument } from "@/modules/diagram/schema";

const fallbackOrigin = "https://infographic-api.flytory.com";

// Next inlines this at build time, so the ?? runs against a literal.
export const apiOrigin = (process.env.NEXT_PUBLIC_API_ORIGIN || fallbackOrigin).replace(/\/+$/, "");

export type UserRole = "user" | "admin";

export type AccountUser = {
  id: string;
  email?: string;
  displayName: string;
  avatarUrl?: string;
  role: UserRole;
  /** Set while an administrator has the account suspended. */
  disabledAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** One account as the administration screen lists it. */
export type ManagedUser = AccountUser & { projectCount: number };

export const isAdmin = (user: AccountUser | undefined | null) => user?.role === "admin";

export type Session = {
  user: AccountUser;
  accessToken: string;
  expiresAt: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  purpose: string;
  format: string;
  mode: string;
  version: number;
  sceneCount: number;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
};

export type StoredDocument = { version: number; document: unknown };

/** One saved snapshot. The document is omitted from the list — 50 of them would be megabytes. */
export type ProjectVersion = {
  projectId: string;
  version: number;
  label?: string;
  createdBy?: string;
  createdAt: string;
};

/**
 * Per-user editor state. There is deliberately no field for a key or a token:
 * the editor talks to its AI gateway directly and the server never holds that
 * credential — only the origin, so nobody retypes it on a second machine.
 */
export type UserSettings = {
  aiGatewayOrigin?: string;
  aiProvider?: string;
  aiModel?: string;
  editor: Record<string, unknown>;
};

export type UploadedAsset = { id: string; url: string; mime: string; bytes: number };

/** ApiError carries the API's own error shape: a stable code plus a sentence. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, fields?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** Status 0 means the request never arrived — offline, DNS, a blocked CORS preflight. */
  get isOffline() {
    return this.status === 0;
  }
}

/**
 * ConflictError is the one error the sync layer must not treat as a failure.
 * The API answers a stale save with 409 *and the document it actually holds*,
 * which is what makes "keep mine / take theirs" possible instead of a dead end.
 */
export class ConflictError extends ApiError {
  readonly current: StoredDocument;

  constructor(message: string, current: StoredDocument) {
    super(409, "version_conflict", message);
    this.name = "ConflictError";
    this.current = current;
  }
}

// ---------------------------------------------------------------------------
// Session state. Kept in module scope so every caller shares one token, and
// exposed through subscribe/snapshot so React can read it with
// useSyncExternalStore rather than a second copy in component state.
// ---------------------------------------------------------------------------

let session: Session | null = null;
let expiresAt = 0;
const listeners = new Set<() => void>();

function setSession(next: Session | null) {
  session = next;
  expiresAt = next ? Date.parse(next.expiresAt) : 0;
  for (const listener of listeners) listener();
}

export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function sessionSnapshot(): Session | null {
  return session;
}

/** The server has no session during rendering, and pretending otherwise hydrates wrong. */
export function serverSessionSnapshot(): Session | null {
  return null;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

type ErrorEnvelope = { error?: { code?: string; message?: string; fields?: Record<string, unknown> } };

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${apiOrigin}${path}`, init);
  } catch {
    // fetch only rejects when the request never completed. Saying "offline" is
    // honest and, unlike a generic failure, tells the sync layer to retry later
    // rather than to give up on this document.
    throw new ApiError(0, "offline", "Cannot reach the server. Your work is still saved in this browser.");
  }
}

async function decode<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  if (response.ok) return (await response.json()) as T;

  let body: ErrorEnvelope = {};
  try {
    body = (await response.json()) as ErrorEnvelope;
  } catch {
    // An error page that is not JSON — a proxy timeout, usually.
  }
  throw new ApiError(
    response.status,
    body.error?.code ?? "http_error",
    body.error?.message ?? `The server answered ${response.status}.`,
    body.error?.fields,
  );
}

function jsonHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json");
  return headers;
}

// One refresh at a time. Three tabs waking up together would otherwise each
// rotate the cookie, and the family-reuse detector reads two rotations of the
// same token as theft and signs the person out of everything.
let refreshing: Promise<Session | null> | null = null;

async function refresh(): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      const response = await fetch(`${apiOrigin}/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        // 401 here means the cookie is gone or worthless: really signed out.
        if (response.status === 401 || response.status === 403) setSession(null);
        return session;
      }
      setSession((await response.json()) as Session);
      return session;
    } catch {
      // Offline is not signed out. Keep whatever token we have and let the
      // caller fail the individual request.
      return session;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Ask the refresh cookie whether this browser is still signed in. */
export async function restoreSession(): Promise<Session | null> {
  return refresh();
}

async function authorized(path: string, init: RequestInit = {}, allowRetry = true): Promise<Response> {
  // Refresh a minute early rather than after a 401: it saves the round trip
  // and, more importantly, it keeps a long autosave from failing mid-flight.
  if (!session || Date.now() > expiresAt - 60_000) await refresh();
  if (!session) throw new ApiError(401, "unauthorized", "Sign in to sync your projects.");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  const response = await send(path, { ...init, headers });

  if (response.status === 401 && allowRetry) {
    await refresh();
    if (session) return authorized(path, init, false);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

async function startSession(path: string, body: unknown): Promise<Session> {
  const response = await send(path, {
    method: "POST",
    credentials: "include",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  const next = await decode<Session>(response);
  setSession(next);
  return next;
}

export function register(email: string, password: string, displayName: string) {
  return startSession("/v1/auth/register", { email, password, displayName });
}

export function signIn(email: string, password: string) {
  return startSession("/v1/auth/login", { email, password });
}

export async function signOut(): Promise<void> {
  try {
    await send("/v1/auth/logout", { method: "POST", credentials: "include" });
  } finally {
    // Whether or not the server heard us, this browser is done with the token.
    setSession(null);
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectSummary[]> {
  const response = await authorized("/v1/projects?limit=100");
  const body = await decode<{ projects: ProjectSummary[] | null }>(response);
  return body.projects ?? [];
}

export async function createProject(input: {
  title: string;
  purpose?: string;
  format?: string;
  mode?: string;
  document: DiagramDocument;
}): Promise<ProjectSummary> {
  const response = await authorized("/v1/projects", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      title: input.title,
      purpose: input.purpose ?? "",
      format: input.format ?? "16:9",
      mode: input.mode ?? "architecture",
      document: input.document,
    }),
  });
  return decode<ProjectSummary>(response);
}

export async function patchProject(
  id: string,
  input: { title?: string; purpose?: string; format?: string; mode?: string },
): Promise<ProjectSummary> {
  const response = await authorized(`/v1/projects/${id}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
  return decode<ProjectSummary>(response);
}

export async function deleteProject(id: string): Promise<void> {
  const response = await authorized(`/v1/projects/${id}`, { method: "DELETE" });
  if (response.status === 404) return; // Already gone is the outcome we wanted.
  await decode<void>(response);
}

export async function fetchDocument(id: string): Promise<StoredDocument> {
  const response = await authorized(`/v1/projects/${id}/document`);
  return decode<StoredDocument>(response);
}

/**
 * saveDocument sends the version this edit started from. The server refuses the
 * write if the stored version moved on, so two tabs cannot quietly overwrite
 * each other — the loser gets a ConflictError holding the winner's document.
 */
export async function saveDocument(
  id: string,
  document: DiagramDocument,
  version: number,
  label?: string,
): Promise<ProjectSummary> {
  const headers = jsonHeaders();
  headers.set("If-Match", `"${version}"`);
  const response = await authorized(`/v1/projects/${id}/document`, {
    method: "PUT",
    headers,
    body: JSON.stringify(label ? { document, label } : { document }),
  });

  if (response.status === 409) {
    const body = (await response.json()) as ErrorEnvelope & { current?: StoredDocument };
    if (body.current) {
      throw new ConflictError(
        body.error?.message ?? "This project changed somewhere else.",
        body.current,
      );
    }
  }
  return decode<ProjectSummary>(response);
}

export async function duplicateProject(id: string): Promise<ProjectSummary> {
  // The server copies the document in place. Doing it here would mean pulling
  // the whole diagram down and pushing an identical copy straight back up.
  const response = await authorized(`/v1/projects/${id}/duplicate`, { method: "POST" });
  return decode<ProjectSummary>(response);
}

export async function listVersions(id: string): Promise<ProjectVersion[]> {
  const response = await authorized(`/v1/projects/${id}/versions`);
  const body = await decode<{ versions: ProjectVersion[] | null }>(response);
  return body.versions ?? [];
}

/**
 * restoreVersion writes an old document forward as a new version rather than
 * rewinding the counter, so the restore is itself undoable.
 */
export async function restoreVersion(id: string, version: number): Promise<ProjectSummary> {
  const response = await authorized(`/v1/projects/${id}/versions/${version}/restore`, { method: "POST" });
  return decode<ProjectSummary>(response);
}

// ---------------------------------------------------------------------------
// The account itself
// ---------------------------------------------------------------------------

export async function fetchProfile(): Promise<AccountUser> {
  const response = await authorized("/v1/me");
  return decode<AccountUser>(response);
}

export async function updateProfile(input: { displayName?: string; avatarUrl?: string }): Promise<AccountUser> {
  const response = await authorized("/v1/me", {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
  const updated = await decode<AccountUser>(response);
  // The dialog reads the user off the session, so keep the two in step.
  if (session) setSession({ ...session, user: updated });
  return updated;
}

export async function fetchSettings(): Promise<UserSettings> {
  const response = await authorized("/v1/me/settings");
  return decode<UserSettings>(response);
}

export async function saveSettings(input: Partial<UserSettings>): Promise<UserSettings> {
  const response = await authorized("/v1/me/settings", {
    method: "PUT",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
  return decode<UserSettings>(response);
}

// ---------------------------------------------------------------------------
// Assets
//
// The URL that comes back carries its own short-lived signature, because an
// <img> tag cannot send an Authorization header. It is relative to the API, so
// make it absolute here rather than in every component that renders one.
// ---------------------------------------------------------------------------

export async function uploadAsset(projectId: string, file: File): Promise<UploadedAsset> {
  const form = new FormData();
  form.append("file", file);
  const response = await authorized(`/v1/projects/${projectId}/assets`, { method: "POST", body: form });
  const asset = await decode<UploadedAsset>(response);
  return { ...asset, url: absoluteAssetUrl(asset.url) };
}

export async function listAssets(projectId: string): Promise<UploadedAsset[]> {
  const response = await authorized(`/v1/projects/${projectId}/assets`);
  const body = await decode<{ assets: UploadedAsset[] | null }>(response);
  return (body.assets ?? []).map((asset) => ({ ...asset, url: absoluteAssetUrl(asset.url) }));
}

export async function deleteAsset(id: string): Promise<void> {
  const response = await authorized(`/v1/assets/${id}`, { method: "DELETE" });
  if (response.status === 404) return; // Already gone is the outcome we wanted.
  await decode<void>(response);
}

export function absoluteAssetUrl(url: string) {
  return url.startsWith("http") ? url : `${apiOrigin}${url}`;
}


// ---------------------------------------------------------------------------
// Administration
//
// Every call here is refused with 403 for an ordinary account — the server is
// the boundary, and the editor only hides the screen so nobody is offered a
// button that would fail.
// ---------------------------------------------------------------------------

export type UserFilter = { query?: string; status?: "all" | "active" | "disabled"; limit?: number; offset?: number };

export async function listUsers(filter: UserFilter = {}): Promise<{ users: ManagedUser[]; total: number }> {
  const params = new URLSearchParams();
  if (filter.query) params.set("query", filter.query);
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.offset) params.set("offset", String(filter.offset));
  const suffix = params.size ? `?${params}` : "";
  const response = await authorized(`/v1/admin/users${suffix}`);
  const body = await decode<{ users: ManagedUser[] | null; total: number }>(response);
  return { users: body.users ?? [], total: body.total ?? 0 };
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<AccountUser> {
  const response = await authorized(`/v1/admin/users/${id}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ disabled }),
  });
  return decode<AccountUser>(response);
}

export async function setUserRole(id: string, role: UserRole): Promise<AccountUser> {
  const response = await authorized(`/v1/admin/users/${id}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ role }),
  });
  return decode<AccountUser>(response);
}

export async function deleteUser(id: string): Promise<void> {
  const response = await authorized(`/v1/admin/users/${id}`, { method: "DELETE" });
  if (response.status === 404) return; // Already gone is the outcome we wanted.
  await decode<void>(response);
}
