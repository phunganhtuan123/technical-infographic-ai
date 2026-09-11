import { describe, expect, it } from "vitest";
import { createSession, isWorkspaceSession, sessionTitle, threadId, type AiThread } from "./thread-store";

const entry = (role: AiThreadEntryRole, body: string) => ({ id: `${role}-${body}`, role, body, createdAt: new Date().toISOString() });
type AiThreadEntryRole = "user" | "assistant" | "system";

describe("AI sessions", () => {
  it("gives each new session its own id so the previous one survives", () => {
    const first = createSession("workspace-1");
    const second = createSession("workspace-1");
    expect(first.id).not.toBe(second.id);
    // Both are still addressed to the same workspace, which is how they are listed.
    expect(first.workspaceId).toBe("workspace-1");
    expect(second.workspaceId).toBe("workspace-1");
  });

  it("no longer collides with the single id the old build wrote", () => {
    expect(createSession("workspace-1").id).not.toBe(threadId("workspace-1", ["workspace"]));
  });

  it("is recognisable as a workspace conversation", () => {
    expect(isWorkspaceSession(createSession("w"))).toBe(true);
    expect(isWorkspaceSession({ ...createSession("w"), targetKind: "node" })).toBe(false);
  });

  it("labels a session by what was asked in it", () => {
    const thread = { ...createSession("w"), entries: [entry("user", "Draw the checkout flow"), entry("assistant", "Done")] };
    expect(sessionTitle(thread)).toBe("Draw the checkout flow");
  });

  it("prefers the working summary when there is one", () => {
    const thread = { ...createSession("w"), summary: "Checkout with retries", entries: [entry("user", "something else")] };
    expect(sessionTitle(thread)).toBe("Checkout with retries");
  });

  it("says so when a session holds nothing yet", () => {
    expect(sessionTitle(createSession("w"))).toBe("Empty session");
  });
});
