import { describe, expect, it } from "vitest";
import { nodeInk } from "@/modules/catalog/catalog";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { architecturePlan } from "@/modules/fixtures/architecture-plan";
import { parseWorkspaceFile, serializeWorkspaceFile } from "./workspace-file";

describe("workspace file", () => {
  it("round-trips visual geometry, format, scenes, and manual edge routing", () => {
    const document = compilePlan(architecturePlan);
    document.format = "full";
    document.nodes[0].position = { x: 144, y: 288 };
    document.nodes[0].effect = "scan";
    document.nodes[0].backgroundImage = "data:image/svg+xml;base64,PHN2Zy8+";
    document.nodes[0].backgroundOpacity = 0.4;
    document.nodes[0].backgroundFit = "contain";
    document.nodes[0].zIndex = 7;
    document.nodes[0].textColor = "#63e6ff";
    document.nodes[0].fontFamily = "system-sans";
    document.nodes[0].fontSize = 22;
    document.nodes[0].fontWeight = 500;
    document.nodes[0].textAlign = "right";
    document.edges[0].effect = "signal";
    document.edges[0].routeWaypoints = [{ x: 360, y: 240 }, { x: 520, y: 420 }];
    document.scenes = [{ id: "scene-1", name: "Main", mode: document.mode, title: document.title, purpose: document.purpose, nodes: document.nodes, edges: document.edges }];
    document.activeSceneId = "scene-1";

    const imported = parseWorkspaceFile(serializeWorkspaceFile(document));

    expect(imported.format).toBe("full");
    expect(imported.nodes[0].position).toEqual({ x: 144, y: 288 });
    expect(imported.nodes[0].effect).toBe("scan");
    expect(imported.nodes[0].backgroundImage).toBe("data:image/svg+xml;base64,PHN2Zy8+");
    expect(imported.nodes[0].backgroundOpacity).toBe(0.4);
    expect(imported.nodes[0].backgroundFit).toBe("contain");
    expect(imported.nodes[0].zIndex).toBe(7);
    expect(imported.nodes[0]).toMatchObject({ textColor: "#63e6ff", fontFamily: "system-sans", fontSize: 22, fontWeight: 500, textAlign: "right" });
    expect(imported.edges[0].effect).toBe("signal");
    expect(imported.edges[0].routeWaypoints).toEqual([{ x: 360, y: 240 }, { x: 520, y: 420 }]);
    expect(imported.scenes?.[0].name).toBe("Main");
    expect(imported.activeSceneId).toBe("scene-1");
  });

  it("rejects a JSON file that is not a valid diagram", () => {
    expect(() => parseWorkspaceFile('{"hello":"world"}')).toThrow();
  });

  it("hydrates typography defaults for older workspace files", () => {
    const document = compilePlan(architecturePlan);
    const legacyNode = document.nodes[0] as Partial<typeof document.nodes[number]>;
    delete legacyNode.textColor;
    delete legacyNode.fontFamily;
    delete legacyNode.fontSize;
    delete legacyNode.fontWeight;
    delete legacyNode.textAlign;

    const imported = parseWorkspaceFile(serializeWorkspaceFile(document));

    expect(imported.nodes[0]).toMatchObject({ textColor: nodeInk, fontFamily: "geist-mono", fontSize: 14, fontWeight: 700, textAlign: "left" });
  });
});
