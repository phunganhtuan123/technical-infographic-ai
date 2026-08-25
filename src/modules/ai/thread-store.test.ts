import { describe, expect, it } from "vitest";
import { createThread, threadContext, updateThreadProposalStatus } from "./thread-store";

describe("AI thread helpers", () => {
  it("builds bounded conversational context and tracks proposal status", () => {
    const thread = {
      ...createThread("workspace-1", ["workspace"], "workspace"),
      summary: "Login flow is the current working chart.",
      entries: [
        { id: "u1", role: "user" as const, body: "Add MFA", createdAt: "2026-08-24T00:00:00.000Z" },
        { id: "a1", role: "assistant" as const, body: "MFA proposal ready", createdAt: "2026-08-24T00:00:01.000Z", proposalId: "p1", proposalStatus: "pending" as const },
      ],
    };
    expect(threadContext(thread)).toContain("User: Add MFA");
    expect(updateThreadProposalStatus(thread, "p1", "accepted").entries[1].proposalStatus).toBe("accepted");
  });
});
