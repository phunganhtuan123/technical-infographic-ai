"use client";

// The layer that keeps this browser and the server holding the same diagrams.
//
// The shape is deliberately one-directional in the common case: the editor owns
// the document while you are editing it, and pushes. The server only wins when
// it is genuinely ahead — a save from another machine — and even then it never
// overwrites unsaved work silently. Anything the two cannot agree on becomes a
// conflict the person resolves, because two diagrams do not merge and
// pretending otherwise loses somebody's afternoon.
//
// Signed out, none of this runs and the editor behaves exactly as it did
// before: IndexedDB is the whole story.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { DiagramDocument } from "@/modules/diagram/schema";
import {
  ApiError,
  ConflictError,
  createProject,
  deleteAsset,
  deleteProject,
  fetchDocument,
  listAssets,
  listProjects,
  patchProject,
  register as registerAccount,
  restoreSession,
  restoreVersion,
  saveDocument,
  serverSessionSnapshot,
  sessionSnapshot,
  signIn as signInWithPassword,
  signOut as endSession,
  subscribeSession,
  type ProjectSummary,
} from "@/modules/projects/api-client";
import { refreshProjectAssets } from "@/modules/projects/asset-urls";
import { fingerprint, loadSyncLinks, saveSyncLinks, type SyncLink } from "@/modules/projects/local-project-store";
import { reconcileSettings } from "@/modules/projects/user-settings";

export type SyncPhase =
  | "signed-out"
  | "restoring"
  | "pulling"
  | "saving"
  | "synced"
  | "offline"
  | "conflict"
  | "error";

export type SyncState = {
  phase: SyncPhase;
  message: string;
  pending: number;
  lastSyncedAt: number | null;
};

export type SyncConflict = {
  workspaceId: string;
  projectId: string;
  title: string;
  mine: DiagramDocument;
  theirs: DiagramDocument;
  serverVersion: number;
};

export type ConflictResolution = "keep-mine" | "take-theirs" | "keep-both";

type Options = {
  /** Every workspace the editor currently holds. */
  workspaces: DiagramDocument[];
  /** The one on screen. Its images are the ones worth having a fresh URL for. */
  activeWorkspaceId: string;
  /** False until IndexedDB has been read, so a pull cannot race the local load. */
  ready: boolean;
  /** Turns a stored document back into a workspace, or null if it is unreadable. */
  hydrate: (raw: unknown) => DiagramDocument | null;
  /** Projects that exist on the server but not yet in this browser. */
  onAdopt: (documents: DiagramDocument[]) => void;
  /** One workspace replaced wholesale by the server's copy. */
  onReplace: (document: DiagramDocument) => void;
};

// Wait this long after the last edit before saving. Long enough that typing a
// title is one request rather than thirty; short enough that closing the tab a
// couple of seconds later has still saved.
const quietPeriod = 1_500;
// A safety net: a long editing session never goes quiet, and offline pushes
// need something to retry them.
const sweepInterval = 20_000;
// Signed image URLs last an hour. Renew with room to spare.
const assetRenewalInterval = 45 * 60_000;

const signedOut: SyncState = { phase: "signed-out", message: "Saved in this browser", pending: 0, lastSyncedAt: null };

export function useCloudSync({ workspaces, activeWorkspaceId, ready, hydrate, onAdopt, onReplace }: Options) {
  const session = useSyncExternalStore(subscribeSession, sessionSnapshot, serverSessionSnapshot);
  const userId = session?.user.id ?? null;

  const [state, setState] = useState<SyncState>(signedOut);
  const [conflict, setConflict] = useState<SyncConflict | null>(null);

  const linksRef = useRef<Record<string, SyncLink>>({});
  // Object identity is the cheap "has this changed" test: the editor replaces a
  // workspace object on every edit, so an unchanged one is still the very same
  // reference and never gets serialised at all.
  const pushedRef = useRef(new Map<string, DiagramDocument>());
  const workspacesRef = useRef(workspaces);
  const conflictRef = useRef<SyncConflict | null>(null);
  const busyRef = useRef(false);
  const pulledForRef = useRef<string | null>(null);

  const hydrateRef = useRef(hydrate);
  const adoptRef = useRef(onAdopt);
  const replaceRef = useRef(onReplace);
  useEffect(() => {
    hydrateRef.current = hydrate;
    adoptRef.current = onAdopt;
    replaceRef.current = onReplace;
  }, [hydrate, onAdopt, onReplace]);

  // Runs before the effects below, so they always read the current list.
  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const report = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.isOffline) {
      setState((current) => ({ ...current, phase: "offline", message: "Offline — saved in this browser" }));
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      setState({ ...signedOut, message: "Signed out — saved in this browser" });
      return;
    }
    setState((current) => ({
      ...current,
      phase: "error",
      message: error instanceof Error ? error.message : fallback,
    }));
  }, []);

  const raiseConflict = useCallback((next: SyncConflict) => {
    conflictRef.current = next;
    setConflict(next);
    setState((current) => ({
      ...current,
      phase: "conflict",
      message: `“${next.title}” changed somewhere else`,
    }));
  }, []);

  const remember = useCallback((workspace: DiagramDocument, project: { id: string; version: number; title: string }) => {
    linksRef.current[workspace.id] = {
      projectId: project.id,
      version: project.version,
      title: project.title,
      digest: fingerprint(workspace),
      savedAt: Date.now(),
    };
    pushedRef.current.set(workspace.id, workspace);
  }, []);

  // -------------------------------------------------------------------------
  // Sign-in
  // -------------------------------------------------------------------------

  useEffect(() => {
    setState((current) => (current.phase === "signed-out" ? { ...current, phase: "restoring", message: "Checking sign-in…" } : current));
    void restoreSession().then((restored) => {
      if (!restored) setState(signedOut);
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithPassword(email, password);
  }, []);

  const createAccount = useCallback(async (email: string, password: string, displayName: string) => {
    await registerAccount(email, password, displayName);
  }, []);

  // Signing out leaves every workspace where it is. They stop syncing; nothing
  // is deleted, because the person asked to sign out, not to lose their work.
  const signOut = useCallback(async () => {
    await endSession();
    linksRef.current = {};
    pushedRef.current.clear();
    pulledForRef.current = null;
    conflictRef.current = null;
    setConflict(null);
    setState(signedOut);
  }, []);

  // -------------------------------------------------------------------------
  // Pull — once per account, when the local store is ready
  // -------------------------------------------------------------------------

  const pull = useCallback(async (account: string) => {
    setState((current) => ({ ...current, phase: "pulling", message: "Loading your projects…" }));
    const links = await loadSyncLinks(account);
    linksRef.current = links;

    let projects: ProjectSummary[];
    try {
      projects = await listProjects();
    } catch (error) {
      report(error, "Could not load your projects.");
      return;
    }

    const byProject = new Map<string, string>();
    for (const [workspaceId, link] of Object.entries(links)) byProject.set(link.projectId, workspaceId);
    const known = new Map(workspacesRef.current.map((workspace) => [workspace.id, workspace]));
    const adopted: DiagramDocument[] = [];

    for (const project of projects) {
      const workspaceId = byProject.get(project.id);
      const local = workspaceId ? known.get(workspaceId) : undefined;

      try {
        if (local && workspaceId) {
          const link = links[workspaceId];
          // Nothing new upstream. Anything edited here is the push loop's job.
          if (project.version <= link.version) {
            if (fingerprint(local) === link.digest) pushedRef.current.set(local.id, local);
            continue;
          }

          const stored = await fetchDocument(project.id);
          const hydrated = hydrateRef.current(stored.document);
          if (!hydrated) continue;
          const theirs = { ...hydrated, id: local.id };

          // Edited here as well as there: nobody but the person can decide.
          if (fingerprint(local) !== link.digest) {
            raiseConflict({
              workspaceId: local.id,
              projectId: project.id,
              title: local.workspaceTitle ?? local.title,
              mine: local,
              theirs,
              serverVersion: stored.version,
            });
            continue;
          }

          replaceRef.current(theirs);
          remember(theirs, { id: project.id, version: stored.version, title: project.title });
          continue;
        }

        // A project this browser has never seen — another machine, or a fresh
        // profile after signing in.
        const stored = await fetchDocument(project.id);
        const hydrated = hydrateRef.current(stored.document);
        if (!hydrated) continue;
        const id = known.has(hydrated.id) ? `workspace-${crypto.randomUUID()}` : hydrated.id;
        const arrival = { ...hydrated, id };
        adopted.push(arrival);
        known.set(id, arrival);
        remember(arrival, { id: project.id, version: stored.version, title: project.title });
      } catch (error) {
        report(error, "Could not load one of your projects.");
      }
    }

    // A link whose project is gone was deleted from another machine. Drop the
    // link rather than the workspace: the diagram stays here, unsynced, and a
    // later push offers to create it again.
    const live = new Set(projects.map((project) => project.id));
    for (const [workspaceId, link] of Object.entries(links)) {
      if (!live.has(link.projectId)) delete links[workspaceId];
    }

    if (adopted.length) adoptRef.current(adopted);
    await saveSyncLinks(account, links);
    // Best-effort, and deliberately not awaited into the status: nobody should
    // watch a spinner because a preference was slow.
    void reconcileSettings();
    setState((current) =>
      current.phase === "conflict"
        ? current
        : { phase: "synced", message: projects.length ? `${projects.length} project${projects.length === 1 ? "" : "s"} in sync` : "Signed in", pending: 0, lastSyncedAt: Date.now() },
    );
  }, [raiseConflict, remember, report]);

  useEffect(() => {
    if (!ready) return;
    if (!userId) {
      pulledForRef.current = null;
      setState((current) => (current.phase === "restoring" ? signedOut : current));
      return;
    }
    if (pulledForRef.current === userId) return;
    pulledForRef.current = userId;
    void pull(userId);
  }, [pull, ready, userId]);

  // -------------------------------------------------------------------------
  // Push
  // -------------------------------------------------------------------------

  // settle reconciles the badge with what is actually still waiting. It runs on
  // every exit from push, including the ones that wrote nothing: an earlier
  // version only updated the count after a successful write, so a workspace that
  // turned out to be clean left the badge reading "1 unsaved" until the next
  // edit happened to recompute it.
  const settle = useCallback((wrote: boolean) => {
    const pending = workspacesRef.current.reduce(
      (total, workspace) => total + (pushedRef.current.get(workspace.id) === workspace ? 0 : 1),
      0,
    );
    setState((current) => {
      if (current.phase === "conflict" || current.phase === "error" || current.phase === "offline") {
        return current.pending === pending ? current : { ...current, pending };
      }
      return {
        phase: "synced",
        message: pending === 0 ? "All changes saved" : `${pending} waiting to save`,
        pending,
        lastSyncedAt: wrote ? Date.now() : current.lastSyncedAt,
      };
    });
  }, []);

  const push = useCallback(async () => {
    const account = sessionSnapshot()?.user.id;
    if (!account || busyRef.current || conflictRef.current) return;

    const outstanding = workspacesRef.current.filter((workspace) => pushedRef.current.get(workspace.id) !== workspace);
    if (outstanding.length === 0) {
      settle(false);
      return;
    }

    busyRef.current = true;
    let wrote = false;
    try {
      for (const workspace of outstanding) {
        const title = workspace.workspaceTitle ?? workspace.title;
        const mark = fingerprint(workspace);
        const link = linksRef.current[workspace.id];

        // Reloaded, not edited: the content matches what was last pushed.
        if (link && link.digest === mark) {
          pushedRef.current.set(workspace.id, workspace);
          continue;
        }

        setState((current) => ({ ...current, phase: "saving", message: `Saving ${title}…` }));

        try {
          if (!link) {
            const created = await createProject({
              title,
              purpose: workspace.purpose,
              format: workspace.format,
              mode: workspace.mode,
              document: workspace,
            });
            remember(workspace, created);
          } else {
            const saved = await saveDocument(link.projectId, workspace, link.version);
            remember(workspace, saved);
            // The document carries the name, but the project row does not, and
            // that row is what the project list shows.
            if (link.title !== title) {
              const renamed = await patchProject(link.projectId, { title });
              linksRef.current[workspace.id].title = renamed.title;
            }
          }
          wrote = true;
        } catch (error) {
          if (error instanceof ConflictError) {
            const hydrated = hydrateRef.current(error.current.document);
            if (hydrated) {
              raiseConflict({
                workspaceId: workspace.id,
                projectId: link!.projectId,
                title,
                mine: workspace,
                theirs: { ...hydrated, id: workspace.id },
                serverVersion: error.current.version,
              });
              break;
            }
          }
          report(error, `Could not save ${title}.`);
          // Offline or signed out: stop here and let the sweep retry. Any other
          // failure is likely to repeat for the rest of the list too.
          break;
        }
      }

      if (wrote) await saveSyncLinks(account, linksRef.current);
      settle(wrote);
    } finally {
      busyRef.current = false;
    }
  }, [raiseConflict, remember, report, settle]);

  // Save shortly after typing stops.
  useEffect(() => {
    if (!ready || !userId || conflict) return;
    const timer = window.setTimeout(() => void push(), quietPeriod);
    return () => window.clearTimeout(timer);
  }, [conflict, push, ready, userId, workspaces]);

  // …and regardless, on a timer, so a session that never goes quiet still saves
  // and an offline push gets another try.
  useEffect(() => {
    if (!ready || !userId) return;
    const timer = window.setInterval(() => void push(), sweepInterval);
    return () => window.clearInterval(timer);
  }, [push, ready, userId]);

  // Keep the badge's pending count honest without re-serialising anything.
  useEffect(() => {
    if (!userId) return;
    const pending = workspaces.reduce(
      (total, workspace) => total + (pushedRef.current.get(workspace.id) === workspace ? 0 : 1),
      0,
    );
    setState((current) => (current.pending === pending ? current : { ...current, pending }));
  }, [userId, workspaces]);

  // A browser going back online has usually missed at least one push.
  useEffect(() => {
    const onOnline = () => void push();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [push]);

  // Closing the tab mid-edit: ask, rather than lose the last few seconds.
  useEffect(() => {
    if (!userId) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const dirty = workspacesRef.current.some((workspace) => pushedRef.current.get(workspace.id) !== workspace);
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [userId]);

  // -------------------------------------------------------------------------
  // Conflicts
  // -------------------------------------------------------------------------

  const resolveConflict = useCallback(async (choice: ConflictResolution) => {
    const active = conflictRef.current;
    const account = sessionSnapshot()?.user.id;
    if (!active || !account) return;

    try {
      if (choice === "take-theirs" || choice === "keep-both") {
        if (choice === "keep-both") {
          // Mine becomes a project of its own before theirs takes this slot, so
          // the option that keeps everything is one click rather than a rescue.
          const copy: DiagramDocument = {
            ...active.mine,
            id: `workspace-${crypto.randomUUID()}`,
            workspaceTitle: `${active.title} · mine`,
          };
          const created = await createProject({
            title: copy.workspaceTitle!,
            purpose: copy.purpose,
            format: copy.format,
            mode: copy.mode,
            document: copy,
          });
          remember(copy, created);
          adoptRef.current([copy]);
        }
        replaceRef.current(active.theirs);
        remember(active.theirs, { id: active.projectId, version: active.serverVersion, title: active.title });
      } else {
        const saved = await saveDocument(active.projectId, active.mine, active.serverVersion, "Kept this browser's version");
        remember(active.mine, saved);
      }

      await saveSyncLinks(account, linksRef.current);
      conflictRef.current = null;
      setConflict(null);
      setState({ phase: "synced", message: "All changes saved", pending: 0, lastSyncedAt: Date.now() });
      void push();
    } catch (error) {
      report(error, "Could not resolve that conflict.");
    }
  }, [push, remember, report]);

  // -------------------------------------------------------------------------
  // Deleting
  // -------------------------------------------------------------------------

  /** Called when a workspace is deleted here, so it does not come back on the next pull. */
  const forget = useCallback(async (workspaceId: string) => {
    pushedRef.current.delete(workspaceId);
    const link = linksRef.current[workspaceId];
    if (!link) return;
    delete linksRef.current[workspaceId];
    const account = sessionSnapshot()?.user.id;
    try {
      // The images go too. This is the one moment it is safe to delete them:
      // nothing can point at them any more, and there is no undo to betray.
      // "Remove background" deliberately does not, because undo would then
      // restore a node pointing at bytes that no longer exist.
      const images = await listAssets(link.projectId).catch(() => []);
      await Promise.all(images.map((image) => deleteAsset(image.id).catch(() => undefined)));
      await deleteProject(link.projectId);
    } catch {
      // The local link is gone either way; a stale project is visible in the
      // account and can be removed there.
    }
    if (account) await saveSyncLinks(account, linksRef.current);
  }, []);

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  /** Which server project a workspace belongs to, or null if it has never synced. */
  const projectIdFor = useCallback((workspaceId: string) => linksRef.current[workspaceId]?.projectId ?? null, []);

  /** The version the next save will build on — what the history marks as current. */
  const versionOf = useCallback((workspaceId: string) => linksRef.current[workspaceId]?.version ?? null, []);

  /**
   * Roll a workspace back to an older save. The server writes that document
   * forward as a new version, so this is itself undoable, and the editor then
   * reloads it rather than guessing what it now holds.
   */
  const restoreTo = useCallback(async (workspaceId: string, version: number) => {
    const link = linksRef.current[workspaceId];
    const account = sessionSnapshot()?.user.id;
    if (!link || !account) return;
    const restored = await restoreVersion(link.projectId, version);
    const stored = await fetchDocument(link.projectId);
    const hydrated = hydrateRef.current(stored.document);
    if (!hydrated) throw new Error("This editor cannot open that version.");
    const next = { ...hydrated, id: workspaceId };
    replaceRef.current(next);
    remember(next, { id: link.projectId, version: stored.version, title: restored.title });
    await saveSyncLinks(account, linksRef.current);
    settle(false);
  }, [remember, settle]);

  // Asset URLs carry a signature that expires within the hour, so they are
  // fetched for whichever workspace is open and renewed well before that — a
  // diagram left on screen over lunch should not come back with holes in it.
  useEffect(() => {
    if (!ready || !userId) return;
    let cancelled = false;
    const renew = () => {
      const projectId = linksRef.current[activeWorkspaceId]?.projectId;
      if (!projectId || cancelled) return;
      void refreshProjectAssets(projectId).catch(() => undefined);
    };
    renew();
    const timer = window.setInterval(renew, assetRenewalInterval);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeWorkspaceId, ready, state.lastSyncedAt, userId]);

  const syncNow = useCallback(async () => {
    const account = sessionSnapshot()?.user.id;
    if (!account) return;
    pulledForRef.current = account;
    await pull(account);
    await push();
  }, [pull, push]);

  return { session, state, conflict, signIn, createAccount, signOut, resolveConflict, forget, syncNow, projectIdFor, versionOf, restoreTo };
}
