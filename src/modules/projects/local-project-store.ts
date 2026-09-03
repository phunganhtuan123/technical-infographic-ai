import type { DiagramDocument } from "@/modules/diagram/schema";

const databaseName = "technical-infographic";
const storeName = "projects";
const stateKey = "workspace-state";
const linkKey = "sync-links";

export type WorkspaceState = {
  activeWorkspaceId: string;
  workspaces: DiagramDocument[];
};

/**
 * SyncLink is what ties a workspace in this browser to a project on the server.
 *
 * `version` is the number the last successful save came back with — the value
 * that goes into If-Match on the next one. `digest` is a cheap fingerprint of
 * the document as it was pushed, so a reload can tell "unchanged since the last
 * sync" from "edited while offline" without keeping the whole JSON around.
 */
export type SyncLink = {
  projectId: string;
  version: number;
  title: string;
  digest: string;
  savedAt: number;
};

/**
 * Links are stored per account. Two people sharing a browser profile would
 * otherwise inherit each other's project ids and push into projects they cannot
 * read, which the server answers with a 404 that looks like data loss.
 */
export type SyncLinkRecord = {
  userId: string;
  links: Record<string, SyncLink>;
};

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readKey<T>(key: string): Promise<T | null> {
  return openDatabase().then(
    (database) =>
      new Promise<T | null>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).get(key);
        request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
      }),
  );
}

function writeKey(key: string, value: unknown): Promise<void> {
  return openDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(value, key);
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      }),
  );
}

export function loadWorkspaceState(): Promise<WorkspaceState | null> {
  return readKey<WorkspaceState>(stateKey);
}

export function saveWorkspaceState(state: WorkspaceState): Promise<void> {
  return writeKey(stateKey, state);
}

export async function loadSyncLinks(userId: string): Promise<Record<string, SyncLink>> {
  const record = await readKey<SyncLinkRecord>(linkKey);
  return record && record.userId === userId ? record.links : {};
}

export function saveSyncLinks(userId: string, links: Record<string, SyncLink>): Promise<void> {
  return writeKey(linkKey, { userId, links } satisfies SyncLinkRecord);
}

/**
 * fingerprint answers one question: is this document the same one that was last
 * pushed? It has to survive two round trips that both reorder object keys —
 * IndexedDB's structured clone, and Postgres jsonb, which stores keys in its own
 * order and hands them back that way. Comparing raw JSON.stringify output across
 * either of those reports a change on every reload and re-saves every project
 * for nothing. So the value is serialised with its keys sorted first.
 */
export function fingerprint(value: unknown): string {
  return digest(canonical(value));
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    // undefined disappears in JSON and must not count as a difference either.
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

/**
 * digest hashes a string. cyrb53 rather than a real hash: this only ever answers
 * "did this change", a cryptographic digest would cost an async call on every
 * autosave, and the length is folded in so two documents have to collide on both
 * to be mistaken for each other.
 */
export function digest(serialized: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${serialized.length.toString(36)}-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}
