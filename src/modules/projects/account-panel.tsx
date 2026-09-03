"use client";

// The account surface: a status chip in the top bar, a sign-in dialog behind
// it, and the conflict dialog that appears when the same project was edited in
// two places.

import { useEffect, useMemo, useState } from "react";

import type { DiagramDocument } from "@/modules/diagram/schema";
import { ApiError, updateProfile, type Session } from "@/modules/projects/api-client";
import type { ConflictResolution, SyncConflict, SyncState } from "@/modules/projects/cloud-sync";

// The server refuses anything shorter, and saying so before the round trip is
// kinder than a red box after it.
const minimumPasswordLength = 10;

const phaseLabels: Record<SyncState["phase"], string> = {
  "signed-out": "Local",
  restoring: "…",
  pulling: "Syncing",
  saving: "Saving",
  synced: "Synced",
  offline: "Offline",
  conflict: "Conflict",
  error: "Error",
};

/** Two letters from a name or an email, which is what an avatar is when there is no picture. */
function initials(session: Session) {
  const source = session.user.displayName?.trim() || session.user.email || "?";
  const words = source.split(/[\s.@_-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}

/**
 * The account control.
 *
 * Signed out it is a labelled button, because signing in is an invitation and
 * an invitation needs a word. Signed in it is an avatar, and the sync state
 * rides on it as a ring: a settled editor shows one quiet circle and spends no
 * words at all. Only an unsettled one — unsaved work, offline, a conflict —
 * puts a word beside it, which is precisely when you want to be told.
 */
export function AccountControl({
  session,
  state,
  onOpen,
}: {
  session: Session | null;
  state: SyncState;
  onOpen: () => void;
}) {
  // data-sync is the one stable hook for tests and for anything that needs to
  // know the state without parsing a sentence meant for a person.
  if (!session) {
    return (
      <button className="signin-button" data-sync="signed-out" onClick={onOpen} type="button">
        Sign in
      </button>
    );
  }

  const unsettled =
    state.phase === "offline" || state.phase === "conflict" || state.phase === "error"
      ? phaseLabels[state.phase]
      : state.pending > 0
        ? `${state.pending} unsaved`
        : state.phase === "saving" || state.phase === "pulling"
          ? phaseLabels[state.phase]
          : null;

  const tone = state.phase === "conflict" || state.phase === "error" ? "bad" : unsettled ? "warn" : "good";
  const who = session.user.email ?? session.user.displayName;

  return (
    <span className="account-control" data-pending={state.pending} data-sync={state.phase}>
      {unsettled ? <span className={`account-state tone-${tone}`}>{unsettled}</span> : null}
      <button
        aria-label={`Account — ${who} — ${state.message}`}
        className={`avatar tone-${tone}`}
        onClick={onOpen}
        title={`${who} · ${state.message}`}
        type="button"
      >
        {initials(session)}
        <i />
      </button>
    </span>
  );
}

/**
 * The AI gateway chip.
 *
 * A button labelled "Config" could not tell you whether anything was connected.
 * This answers that question in the same shape as the account control, and it
 * sits next to the prompt field because that is where you notice it matters.
 */
export function AiGatewayChip({
  connected,
  provider,
  model,
  onOpen,
}: {
  connected: boolean;
  provider?: string;
  model?: string;
  onOpen: () => void;
}) {
  return (
    <button
      className={`ai-chip${connected ? " is-connected" : ""}`}
      onClick={onOpen}
      title={connected ? `${provider ?? "Connected"}${model ? ` · ${model}` : ""} · click to change` : "No model connected — click to set one up"}
      type="button"
    >
      <i />
      <span>{connected ? provider ?? "Connected" : "Connect AI"}</span>
      {connected && model ? <em>{model}</em> : null}
    </button>
  );
}

type AccountDialogProps = {
  open: boolean;
  session: Session | null;
  state: SyncState;
  onClose: () => void;
  onSignIn: (email: string, password: string) => Promise<void>;
  onCreateAccount: (email: string, password: string, displayName: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  onSyncNow: () => Promise<void>;
};

export function AccountDialog({
  open,
  session,
  state,
  onClose,
  onSignIn,
  onCreateAccount,
  onSignOut,
  onSyncNow,
}: AccountDialogProps) {
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  // A successful sign-in changes the session underneath this dialog; clearing
  // the password field means it is not sitting in the DOM afterwards.
  useEffect(() => {
    if (session) setPassword("");
  }, [session]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === "register" && password.length < minimumPasswordLength) {
      setError(`Use a password of at least ${minimumPasswordLength} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") await onCreateAccount(email.trim(), password, displayName.trim() || email.split("@")[0]);
      else await onSignIn(email.trim(), password);
      setPassword("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not sign in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-backdrop" onClick={onClose} role="presentation">
      <section aria-label="Account" className="account-dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>{session ? "Account" : mode === "register" ? "Create an account" : "Sign in"}</h2>
          <button aria-label="Close account panel" onClick={onClose} type="button">
            ✕
          </button>
        </header>

        {session ? (
          <>
            <dl className="account-summary">
              <div>
                <dt>Signed in as</dt>
                <dd>{session.user.email ?? session.user.displayName}</dd>
              </div>
              <div>
                <dt>Name</dt>
                <dd>
                  <input
                    aria-label="Display name"
                    className="account-inline-input"
                    defaultValue={session.user.displayName}
                    // Saved when the field loses focus rather than on every
                    // keystroke: a name is finished being typed before it is
                    // worth a request.
                    onBlur={async (event) => {
                      const name = event.target.value.trim();
                      if (!name || name === session.user.displayName) return;
                      try {
                        await updateProfile({ displayName: name });
                      } catch (caught) {
                        setError(caught instanceof ApiError ? caught.message : "Could not save that name.");
                        event.target.value = session.user.displayName;
                      }
                    }}
                  />
                </dd>
              </div>
              <div>
                <dt>Sync</dt>
                <dd>{state.message}</dd>
              </div>
              {state.lastSyncedAt ? (
                <div>
                  <dt>Last saved</dt>
                  <dd>{new Date(state.lastSyncedAt).toLocaleTimeString()}</dd>
                </div>
              ) : null}
            </dl>
            {error ? <p className="account-error account-inline-error">{error}</p> : null}
            <p className="account-note">
              Projects sync to the server a moment after you stop editing. This browser keeps its own copy, so the
              editor still works with no connection.
            </p>
            <div className="account-actions">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onSyncNow();
                  } finally {
                    setBusy(false);
                  }
                }}
                type="button"
              >
                Sync now
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onSignOut();
                  } finally {
                    setBusy(false);
                  }
                }}
                type="button"
              >
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            <form className="account-form" onSubmit={submit}>
              {mode === "register" ? (
                <label>
                  <span>Name</span>
                  <input
                    autoComplete="name"
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="How you want to be shown"
                    value={displayName}
                  />
                </label>
              ) : null}
              <label>
                <span>Email</span>
                <input
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={email}
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  minLength={mode === "register" ? minimumPasswordLength : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "register" ? `At least ${minimumPasswordLength} characters` : "Your password"}
                  required
                  type="password"
                  value={password}
                />
              </label>
              {error ? <p className="account-error">{error}</p> : null}
              <button className="primary" disabled={busy} type="submit">
                {busy ? "Working…" : mode === "register" ? "Create account" : "Sign in"}
              </button>
            </form>
            <p className="account-note">
              Signing in copies your workspaces to the server so they open on another machine. Without an account the
              editor is unchanged — everything stays in this browser.
            </p>
            <button
              className="account-switch"
              onClick={() => {
                setMode(mode === "register" ? "sign-in" : "register");
                setError(null);
              }}
              type="button"
            >
              {mode === "register" ? "I already have an account" : "Create an account instead"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function countNodes(document: DiagramDocument) {
  if (document.scenes?.length) {
    return document.scenes.reduce((total, scene) => total + scene.nodes.length, 0);
  }
  return document.nodes.length;
}

/**
 * The conflict dialog. Both sides are described rather than merged: diagrams do
 * not merge, and the third option exists so that "I do not want to choose" is a
 * real answer instead of a coin toss.
 */
export function ConflictDialog({
  conflict,
  onResolve,
}: {
  conflict: SyncConflict | null;
  onResolve: (choice: ConflictResolution) => Promise<void>;
}) {
  const [busy, setBusy] = useState<ConflictResolution | null>(null);

  const summary = useMemo(() => {
    if (!conflict) return null;
    return {
      mine: { nodes: countNodes(conflict.mine), scenes: conflict.mine.scenes?.length ?? 1 },
      theirs: { nodes: countNodes(conflict.theirs), scenes: conflict.theirs.scenes?.length ?? 1 },
    };
  }, [conflict]);

  if (!conflict || !summary) return null;

  const choose = async (choice: ConflictResolution) => {
    if (busy) return;
    setBusy(choice);
    try {
      await onResolve(choice);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="account-backdrop" role="presentation">
      <section aria-label="Resolve sync conflict" className="conflict-dialog">
        <header>
          <h2>“{conflict.title}” changed in two places</h2>
        </header>
        <p>
          This browser and the server both hold a newer version of this project. Nothing has been overwritten. Pick the
          one to keep — or keep both, which loses nothing.
        </p>
        <div className="conflict-columns">
          <article>
            <h3>This browser</h3>
            <p>
              {summary.mine.nodes} component{summary.mine.nodes === 1 ? "" : "s"} · {summary.mine.scenes} scene
              {summary.mine.scenes === 1 ? "" : "s"}
            </p>
          </article>
          <article>
            <h3>The server</h3>
            <p>
              {summary.theirs.nodes} component{summary.theirs.nodes === 1 ? "" : "s"} · {summary.theirs.scenes} scene
              {summary.theirs.scenes === 1 ? "" : "s"}
            </p>
            <small>version {conflict.serverVersion}</small>
          </article>
        </div>
        <div className="conflict-actions">
          <button className="primary" disabled={Boolean(busy)} onClick={() => void choose("keep-both")} type="button">
            {busy === "keep-both" ? "Working…" : "Keep both"}
          </button>
          <button disabled={Boolean(busy)} onClick={() => void choose("keep-mine")} type="button">
            {busy === "keep-mine" ? "Working…" : "Keep this browser's"}
          </button>
          <button disabled={Boolean(busy)} onClick={() => void choose("take-theirs")} type="button">
            {busy === "take-theirs" ? "Working…" : "Take the server's"}
          </button>
        </div>
        <p className="conflict-note">
          Keep both puts the server&apos;s version in this project and saves yours alongside it as a copy.
        </p>
      </section>
    </div>
  );
}
