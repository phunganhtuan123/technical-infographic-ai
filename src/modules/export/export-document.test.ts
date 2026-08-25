import { describe, expect, it } from "vitest";
import { compilePlan } from "@/modules/compiler/compile-plan";
import { architecturePlan } from "@/modules/fixtures/architecture-plan";
import type { DiagramFormat } from "@/modules/diagram/schema";
import { renderDocumentSvg } from "./export-document";

describe("renderDocumentSvg formats", () => {
  const ratios: Record<Exclude<DiagramFormat, "full">, number> = { "16:9": 16 / 9, "1:1": 1, "4:5": 4 / 5, "9:16": 9 / 16 };

  for (const [format, ratio] of Object.entries(ratios) as Array<[DiagramFormat, number]>) {
    it(`renders ${format} with the requested aspect ratio`, () => {
      const document = compilePlan(architecturePlan);
      document.format = format;
      const svg = renderDocumentSvg(document);
      const match = svg.match(/<svg[^>]+width="([\d.]+)" height="([\d.]+)"/);

      expect(match).not.toBeNull();
      expect(Number(match![1]) / Number(match![2])).toBeCloseTo(ratio, 2);
    });
  }

  it("renders full format from the complete content bounds", () => {
    const document = compilePlan(architecturePlan);
    document.format = "full";
    const svg = renderDocumentSvg(document);
    const match = svg.match(/<svg[^>]+width="([\d.]+)" height="([\d.]+)"/);

    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(0);
    expect(Number(match![2])).toBeGreaterThan(0);
  });

  it("exports component backgrounds in z-index order", () => {
    const document = compilePlan(architecturePlan);
    document.nodes[0].backgroundImage = "data:image/svg+xml;base64,PHN2Zy8+";
    document.nodes[0].backgroundFit = "contain";
    document.nodes[0].zIndex = 9;
    document.nodes[1].zIndex = -4;
    const svg = renderDocumentSvg(document);

    expect(svg).toContain('href="data:image/svg+xml;base64,PHN2Zy8+"');
    expect(svg.indexOf(document.nodes[1].label)).toBeLessThan(svg.indexOf(document.nodes[0].label));
  });

  it("exports component typography", () => {
    const document = compilePlan(architecturePlan);
    document.nodes[0].textColor = "#63e6ff";
    document.nodes[0].fontFamily = "system-sans";
    document.nodes[0].fontSize = 22;
    document.nodes[0].fontWeight = 500;
    document.nodes[0].textAlign = "right";

    const svg = renderDocumentSvg(document);

    expect(svg).toContain('fill="#63e6ff" font-family="Inter,ui-sans-serif,sans-serif" font-size="22" font-weight="500"');
    expect(svg).toContain('text-anchor="end" fill="#63e6ff"');
  });

  it("embeds looping edge and component animations", () => {
    const document = compilePlan(architecturePlan);
    document.edges[0].animated = true;
    document.edges[0].effect = "pulse";
    document.nodes[0].effect = "scan";

    const animated = renderDocumentSvg(document);
    const frame = renderDocumentSvg(document, { animationTime: 1.2 });
    const staticSvg = renderDocumentSvg(document, { animate: false });

    expect(animated).toContain("<animateMotion");
    expect(animated).toContain('attributeName="y"');
    expect(frame).not.toContain("<animateMotion");
    expect(frame).toContain('style="filter:drop-shadow');
    expect(staticSvg).not.toContain("<animate");
  });
});
