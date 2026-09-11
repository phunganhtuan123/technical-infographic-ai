import { mathToPlainText } from "./math-text";

/**
 * How wide a node label is, and how much of it fits.
 *
 * Both questions have to be answered with the same numbers. They were not: the
 * compiler sized a node at one advance and the exporter decided how much to
 * print at another, so a formula that the box had been widened for was still
 * drawn past its own edge.
 *
 * The advance is measured from rendered output and then rounded up, not assumed
 * from the nominal 0.6em of a monospace face. Labels here carry ², ³, ₁, Δ, θ, π
 * and Vietnamese diacritics; those run wider, by different amounts in whatever
 * font an export lands on. Erring high costs a little empty space inside a box.
 * Erring low puts the formula outside it, which is the failure that matters.
 */

/** Horizontal space one character takes, as a fraction of the font size. */
export const LABEL_ADVANCE = 0.86;
/** Space the node's shape needs beside the text: diamond points, slanted sides. */
export const LABEL_PADDING = 104;

export const MIN_NODE_WIDTH = 220;
export const MAX_NODE_WIDTH = 560;

/** Where a long label would break, used both for sizing and for drawing. */
function splitPoints(text: string): string[] {
  const middle = text.length / 2;
  let best = -1;
  for (const match of text.matchAll(/,\s|\s/g)) {
    const at = match.index + match[0].length;
    if (best === -1 || Math.abs(at - middle) < Math.abs(best - middle)) best = at;
  }
  if (best <= 0 || best >= text.length) return [text];
  return [text.slice(0, best).trimEnd(), text.slice(best).trimStart()];
}

export function textWidth(text: string, fontSize: number) {
  return mathToPlainText(text).length * fontSize * LABEL_ADVANCE;
}

/** The width a node needs to show its label and detail without clipping. */
export function widthForLabel(label: string, detail: string | undefined, fontSize = 14) {
  // A label that will be wrapped only needs room for its longer half.
  const plain = mathToPlainText(label);
  const longestLine = plain.length > 30
    ? Math.max(...splitPoints(plain).map((line) => line.length))
    : plain.length;
  const ink = Math.max(longestLine * fontSize * LABEL_ADVANCE, textWidth(detail ?? "", fontSize * 0.62));
  // Round the ink up before padding: rounding the total down left the box one
  // character short of the text it had just been sized for.
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, Math.ceil(ink) + LABEL_PADDING));
}

/** How many characters of `text` a box of `boxWidth` can actually show. */
export function charactersThatFit(boxWidth: number, fontSize: number) {
  const usable = Math.max(40, boxWidth - LABEL_PADDING);
  return Math.max(6, Math.floor(usable / (fontSize * LABEL_ADVANCE)));
}

/** Trim to what the box can show, with an ellipsis when something was dropped. */
export function fitLabel(text: string, boxWidth: number, fontSize: number) {
  const limit = charactersThatFit(boxWidth, fontSize);
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * Break a long label across two lines instead of letting it run wide.
 *
 * Character-width estimation can only get so close: a subscript or a Greek
 * letter is wider than a Latin one, by an amount that depends on whichever font
 * the export lands on. Rather than keep widening the box for
 * "x₁ = 3q/p - A/3, x₂ = -3q/(2p) - A/3", it is split at the comma — which is
 * where a reader would break it anyway.
 *
 * The split point is the separator nearest the middle, so neither line is left
 * carrying almost the whole formula.
 */
export function wrapLabel(text: string, boxWidth: number, fontSize: number): string[] {
  const limit = charactersThatFit(boxWidth, fontSize);
  if (text.length <= limit) return [text];

  const parts = splitPoints(text);
  if (parts.length === 1) return [fitLabel(text, boxWidth, fontSize)];
  return parts.map((line) => fitLabel(line, boxWidth, fontSize));
}
