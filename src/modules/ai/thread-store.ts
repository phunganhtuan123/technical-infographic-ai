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
