export type AiThreadEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  body: string;
  createdAt: string;
  proposalId?: string;
  proposalStatus?: "pending" | "accepted" | "rejected" | "superseded";
};

export type AiThread = {
  id: string;
  workspaceId: string;
  targetIds: string[];
  targetKind: "node" | "edge" | "selection" | "workspace";
  status: "open" | "resolved";
  summary: string;
  entries: AiThreadEntry[];
  updatedAt: string;
};

const databaseName = "technical-infographic-ai";
const storeName = "threads";

function openThreadDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        const store = database.createObjectStore(storeName, { keyPath: "id" });
        store.createIndex("workspaceId", "workspaceId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open AI thread storage"));
  });
}

export function threadId(workspaceId: string, targetIds: string[]) {
  return `${workspaceId}:${[...targetIds].sort().join(",")}`;
}

export async function loadThread(workspaceId: string, targetIds: string[]) {
  if (typeof indexedDB === "undefined") return undefined;
  const database = await openThreadDatabase();
  return new Promise<AiThread | undefined>((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).get(threadId(workspaceId, targetIds));
    request.onsuccess = () => resolve(request.result as AiThread | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not load comment thread"));
  });
}

export async function saveThread(thread: AiThread) {
  if (typeof indexedDB === "undefined") return;
  const database = await openThreadDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(storeName, "readwrite").objectStore(storeName).put(thread);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not save comment thread"));
  });
}

export function createThread(workspaceId: string, targetIds: string[], targetKind: AiThread["targetKind"]): AiThread {
  return { id: threadId(workspaceId, targetIds), workspaceId, targetIds: [...targetIds], targetKind, status: "open", summary: "", entries: [], updatedAt: new Date().toISOString() };
}

/**
 * A fresh workspace conversation that does not stand on top of the last one.
 *
 * The plain workspace thread id is derived from the workspace alone, so
 * starting a new session used to overwrite the previous one and the history was
 * gone for good. Giving each session its own suffix keeps every one of them,
 * and listSessions brings them back.
 */
export function createSession(workspaceId: string): AiThread {
  const stamp = new Date();
  return {
    id: `${workspaceId}:workspace:${stamp.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    targetIds: ["workspace"],
    targetKind: "workspace",
    status: "open",
    summary: "",
    entries: [],
    updatedAt: stamp.toISOString(),
  };
}

/** Is this thread one of the workspace conversations, rather than a node comment? */
export function isWorkspaceSession(thread: AiThread) {
  return thread.targetKind === "workspace";
}

/** Every workspace conversation for a document, most recently touched first. */
export async function listSessions(workspaceId: string) {
  if (typeof indexedDB === "undefined") return [];
  const database = await openThreadDatabase();
  return new Promise<AiThread[]>((resolve, reject) => {
    const request = database
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .index("workspaceId")
      .getAll(workspaceId);
    request.onsuccess = () => resolve(
      (request.result as AiThread[])
        .filter(isWorkspaceSession)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
    request.onerror = () => reject(request.error ?? new Error("Could not list AI sessions"));
  });
}

export async function deleteThread(id: string) {
  if (typeof indexedDB === "undefined") return;
  const database = await openThreadDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(storeName, "readwrite").objectStore(storeName).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not delete the session"));
  });
}

/** A short label for a session, taken from what was actually asked in it. */
export function sessionTitle(thread: AiThread) {
  if (thread.summary.trim()) return thread.summary.trim().slice(0, 60);
  const firstAsk = thread.entries.find((entry) => entry.role === "user");
  if (firstAsk) return firstAsk.body.trim().replace(/\s+/g, " ").slice(0, 60);
  return "Empty session";
}

export function threadContext(thread: AiThread, entryLimit = 10) {
  const history = thread.entries.slice(-entryLimit).map((entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.body}`);
  return [thread.summary ? `Working summary: ${thread.summary}` : "", ...history].filter(Boolean).join("\n").slice(-6000);
}

export function updateThreadProposalStatus(thread: AiThread, proposalId: string, status: NonNullable<AiThreadEntry["proposalStatus"]>) {
  return {
    ...thread,
    entries: thread.entries.map((entry) => entry.proposalId === proposalId ? { ...entry, proposalStatus: status } : entry),
    updatedAt: new Date().toISOString(),
  };
}
