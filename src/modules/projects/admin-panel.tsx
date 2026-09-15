"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteUser,
  listUsers,
  setUserDisabled,
  setUserRole,
  type ManagedUser,
  type UserFilter,
} from "./api-client";

/**
 * Who has signed up, and the three things an operator does about it.
 *
 * Suspend rather than delete is the default action and is listed first: it is
 * reversible, it signs the person out of every open tab immediately, and it
 * keeps their projects intact — which is what "this account is a problem" needs
 * nine times out of ten. Delete is kept to the end of the row, behind a
 * confirmation that names the account, because a misclick there is not
 * something this screen can undo.
 *
 * The buttons that would fail are disabled rather than hidden, with the reason
 * on the tooltip: a control that vanishes reads as a bug, one that explains
 * itself reads as a rule.
 */

export type AdminPanelProps = {
  open: boolean;
  /** The signed-in administrator, so the screen can refuse to lock them out. */
  currentUserId: string | undefined;
  onClose(): void;
};

const statuses: Array<NonNullable<UserFilter["status"]>> = ["all", "active", "disabled"];

function joined(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function AdminPanel({ open, currentUserId, onClose }: AdminPanelProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<NonNullable<UserFilter["status"]>>("all");
  const [message, setMessage] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const page = await listUsers({ query: query.trim() || undefined, status, limit: 200 });
      setUsers(page.users);
      setTotal(page.total);
      setMessage(page.users.length ? undefined : "No accounts match that.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the account list");
    } finally {
      setLoading(false);
    }
  }, [query, status]);

  useEffect(() => {
    if (!open) return;
    // Typing straight into the search box would otherwise send a request per
    // keystroke against a list that is not paginated on the client.
    const timer = window.setTimeout(() => void reload(), 220);
    return () => window.clearTimeout(timer);
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const act = useCallback(async (user: ManagedUser, run: () => Promise<unknown>, done: string) => {
    setBusyId(user.id);
    setMessage(undefined);
    try {
      await run();
      setMessage(done);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work");
    } finally {
      setBusyId(undefined);
    }
  }, [reload]);

  const remove = useCallback((user: ManagedUser) => {
    const name = user.email ?? user.displayName;
    if (!window.confirm(`Delete ${name}? Their projects stop being reachable and they can sign up again with the same email.`)) return;
    void act(user, () => deleteUser(user.id), `Deleted ${name}`);
  }, [act]);

  if (!open) return null;

  return (
    <div className="config-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label="User administration" aria-modal="true" className="config-dialog admin-panel" role="dialog">
        <header>
          <div>
            <span>ADMIN</span>
            <h2>Accounts</h2>
            <p>Everyone who has registered. Suspending signs them out everywhere at once.</p>
          </div>
          <button aria-label="Close user administration" onClick={onClose}>×</button>
        </header>

        <div className="admin-panel-filters">
          <input
            aria-label="Search accounts by email or name"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search email or name…"
            type="search"
            value={query}
          />
          <div className="segmented">
            {statuses.map((option) => (
              <button
                aria-label={`Show ${option} accounts`}
                className={status === option ? "active" : ""}
                key={option}
                onClick={() => setStatus(option)}
                type="button"
              >{option}</button>
            ))}
          </div>
          <small>{loading ? "Loading…" : `${users.length} of ${total}`}</small>
        </div>

        <div className="admin-panel-table" role="table">
          <div className="admin-panel-row is-head" role="row">
            <span role="columnheader">Account</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">Projects</span>
            <span role="columnheader">Joined</span>
            <span role="columnheader">Actions</span>
          </div>
          {users.map((user) => {
            const self = user.id === currentUserId;
            const busy = busyId === user.id;
            const suspended = Boolean(user.disabledAt);
            return (
              <div className={`admin-panel-row${suspended ? " is-suspended" : ""}`} key={user.id} role="row">
                <span role="cell">
                  <b>{user.email ?? "no email"}</b>
                  <small>{user.displayName}{self ? " · you" : ""}{suspended ? " · suspended" : ""}</small>
                </span>
                <span role="cell"><i className={`admin-role admin-role--${user.role}`}>{user.role}</i></span>
                <span role="cell">{user.projectCount}</span>
                <span role="cell">{joined(user.createdAt)}</span>
                <span className="admin-panel-actions" role="cell">
                  <button
                    disabled={busy || (self && !suspended)}
                    onClick={() => void act(user, () => setUserDisabled(user.id, !suspended),
                      suspended ? `Restored ${user.email ?? user.displayName}` : `Suspended ${user.email ?? user.displayName}`)}
                    title={self && !suspended ? "You cannot suspend your own account" : suspended ? "Let this account sign in again" : "Sign this account out everywhere and block sign-in"}
                    type="button"
                  >{suspended ? "Restore" : "Suspend"}</button>
                  <button
                    disabled={busy || self}
                    onClick={() => void act(user, () => setUserRole(user.id, user.role === "admin" ? "user" : "admin"),
                      user.role === "admin" ? `${user.email ?? user.displayName} is no longer an administrator` : `${user.email ?? user.displayName} is now an administrator`)}
                    title={self ? "You cannot change your own role" : user.role === "admin" ? "Remove administrator access" : "Give administrator access"}
                    type="button"
                  >{user.role === "admin" ? "Demote" : "Make admin"}</button>
                  <button
                    className="admin-panel-delete"
                    disabled={busy || self}
                    onClick={() => remove(user)}
                    title={self ? "You cannot delete your own account from here" : "Delete this account"}
                    type="button"
                  >Delete</button>
                </span>
              </div>
            );
          })}
          {users.length === 0 && !loading ? <p className="admin-panel-empty">Nothing to show.</p> : null}
        </div>

        {message ? <p className="admin-panel-status">{message}</p> : null}
      </section>
    </div>
  );
}
