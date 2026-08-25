import { describe, expect, it } from "vitest";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { architecturePlan } from "@/modules/fixtures/architecture-plan";
import { buildProposalDocument, createProposalRevealFrames, decorateProposalDocument, validateProposal } from "./proposal-engine";

function proposal(patches: unknown[], intent: "new-scene" | "modify-current" | "modify-selection" = "modify-selection") {
  return { id: "proposal-1", requestId: "request-1", intent, summary: "Update selected item", explanation: "", threadSummary: "", confidence: 1, warnings: [], patches };
}

describe("proposal engine", () => {
  it("rejects a selection patch outside strict scope", () => {
    const document = compilePlan(architecturePlan);
    const target = document.nodes[0].id;
    const outside = document.nodes[1].id;
    expect(() => validateProposal(proposal([{ op: "update-node", id: outside, changes: { label: "No" } }]), document, { intent: "modify-selection", nodeIds: [target], edgeIds: [] })).toThrow(/outside scope/);
  });

  it("applies a valid scoped patch without changing neighbors", async () => {
    const document = compilePlan(architecturePlan);
    const target = document.nodes[0];
    const valid = validateProposal(proposal([{ op: "update-node", id: target.id, changes: { label: "Updated", effect: "glow" } }]), document, { intent: "modify-selection", nodeIds: [target.id], edgeIds: [] });
    const next = await buildProposalDocument(document, valid);
    expect(next.nodes.find((node) => node.id === target.id)?.label).toBe("Updated");
    expect(next.nodes[1]).toEqual(document.nodes[1]);
  });

  it("keeps deleted items visible as red preview ghosts", async () => {
    const document = compilePlan(architecturePlan);
    const target = document.nodes[0];
    const valid = validateProposal(proposal([{ op: "delete-node", id: target.id }]), document, { intent: "modify-selection", nodeIds: [target.id], edgeIds: [] });
    const applied = await buildProposalDocument(document, valid);
    const decorated = decorateProposalDocument(document, applied, valid);
    expect(decorated.nodes.find((node) => node.id === target.id)?.previewStatus).toBe("deleted");
  });

  it("reveals proposal nodes before connections without dangling paths", () => {
    const document = compilePlan(architecturePlan);
    const frames = createProposalRevealFrames(document, 2);
    expect(frames[0].nodes).toHaveLength(2);
    expect(frames[0].edges).toHaveLength(0);
    for (const frame of frames) {
      const ids = new Set(frame.nodes.map((node) => node.id));
      expect(frame.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
    }
    expect(frames.at(-1)).toBe(document);
  });
});
