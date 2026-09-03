"use client";

// Version history.
//
// Undo inside the canvas lives in memory and dies with the tab. This is the
// other kind: the server keeps the last fifty saves of every project, and a
// labelled one is never trimmed. Restoring writes the old document forward as a
// new version rather than rewinding the counter, so changing your mind again
// costs nothing.

import { useCallback, useEffect, useState } from "react";

import { ApiError, listVersions, type ProjectVersion } from "@/modules/projects/api-client";

function when(iso: string) {
  const at = new Date(iso);
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return at.toLocaleDateString();
}

export function HistoryDialog({
  open,
  projectId,
  currentVersion,
  onClose,
  onRestore,
}: {
  open: boolean;
  projectId: string | null;
  currentVersion: number | null;
  onClose: () => void;
  onRestore: (version: number) => Promise<void>;
}) {
  const [versions, setVersions] = useState<ProjectVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      setVersions(await listVersions(projectId));
    } catch (caught) {
      setVersions([]);
      setError(caught instanceof ApiError ? caught.message : "Could not load the history.");
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    void load();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [load, onClose, open]);

  if (!open) return null;

  const restore = async (version: number) => {
    if (busy) return;
    setBusy(version);
    setError(null);
    try {
      await onRestore(version);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not restore that version.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="account-backdrop" onClick={onClose} role="presentation">
      <section aria-label="Version history" className="history-dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Version history</h2>
          <button aria-label="Close version history" onClick={onClose} type="button">
            ✕
          </button>
        </header>

        {!projectId ? (
          <p className="history-empty">
            This workspace has not been synced yet. Sign in, and every save from then on is kept here.
          </p>
        ) : versions === null ? (
          <p className="history-empty">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="history-empty">No saved versions yet.</p>
        ) : (
          <ol className="history-list">
            {versions.map((entry) => {
              const isCurrent = entry.version === currentVersion;
              return (
                <li className={isCurrent ? "is-current" : ""} key={entry.version}>
                  <span className="history-version">v{entry.version}</span>
                  <span className="history-when">
                    {when(entry.createdAt)}
                    {entry.label ? <b>{entry.label}</b> : null}
                  </span>
                  {isCurrent ? (
                    <span className="history-current">current</span>
                  ) : (
                    <button disabled={busy !== null} onClick={() => void restore(entry.version)} type="button">
                      {busy === entry.version ? "Restoring…" : "Restore"}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {error ? <p className="account-error history-error">{error}</p> : null}
        <p className="account-note">
          Restoring does not erase anything: the old document is saved forward as a new version, so you can come back to
          where you are now. The server keeps the last fifty, and a labelled one is never trimmed.
        </p>
      </section>
    </div>
  );
}
