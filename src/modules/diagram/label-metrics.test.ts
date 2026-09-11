import { describe, expect, it } from "vitest";
import { LABEL_PADDING, MAX_NODE_WIDTH, charactersThatFit, fitLabel, widthForLabel, wrapLabel } from "./label-metrics";
import { mathToPlainText } from "./math-text";

describe("label metrics", () => {
  it("sizes a node so the label it was widened for actually fits", () => {
    // The bug this guards: the compiler widened the box with one advance and
    // the exporter printed with another, so text ran past its own border.
    for (const label of [
      "$p = B - A^2/3$, $q = 2A^3/27 - AB/3 + C$",
      "$x_1 = 3q/p - A/3$, $x_2 = -3q/(2p) - A/3$",
      "$x_k = r\\cos((\\theta + 2k\\pi)/3) - A/3$",
      "$A = b/a$, $B = c/a$, $C = d/a$",
    ]) {
      const width = widthForLabel(label, undefined);
      // The exporter prints the transliterated form, wrapped, so measure that.
      const lines = wrapLabel(mathToPlainText(label), width, 14);
      // Whatever the box was sized for must survive the exporter's trim.
      expect(lines.some((line) => line.endsWith("…"))).toBe(false);
    }
  });

  it("does trim once the label passes the widest a node may get", () => {
    // No separator to break on, so it can only be trimmed.
    const long = "x".repeat(400);
    const width = widthForLabel(long, undefined);
    expect(width).toBe(MAX_NODE_WIDTH);
    expect(fitLabel(long, width, 14).endsWith("…")).toBe(true);
    expect(wrapLabel(long, width, 14)).toHaveLength(1);
  });

  it("never returns a width below the base node size", () => {
    expect(widthForLabel("ok", undefined)).toBe(220);
  });

  it("keeps the character budget inside the drawable area", () => {
    const width = 400;
    expect(charactersThatFit(width, 14) * 14 * 0.66).toBeLessThanOrEqual(width - LABEL_PADDING);
  });
});
