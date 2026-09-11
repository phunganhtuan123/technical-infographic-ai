import type { DiagramDocument } from "@/modules/diagram/schema";

// Kept in its own module so the canvas can draw the export frame without
// importing the exporter — which would pull the GIF encoder onto the editing
// path for the sake of one rectangle.
const nodeWidth = 220;
const nodeHeight = 104;
const padding = 72;

const targets = {
  "1:1": { width: 960, height: 960 },
  "4:5": { width: 960, height: 1200 },
  "9:16": { width: 720, height: 1280 },
  "16:9": { width: 1280, height: 720 },
  full: { width: 1280, height: 720 },
} as const;

export type ExportBounds = { minX: number; minY: number; width: number; height: number };

/**
 * The area an export will actually cover, in diagram coordinates.
 *
 * It starts from the chosen format's size and grows to hold every node, then
 * expands the short side back out to the aspect ratio. Nothing is ever cropped:
 * a diagram wider than 16:9 makes the frame taller, it does not lose a column.
 * The canvas draws exactly this rectangle so the frame on screen is a promise
 * the exporter keeps, rather than a decorative letterbox.
 */
export function exportBounds(document: DiagramDocument): ExportBounds {
  const format = document.format ?? "16:9";
  const target = targets[format as keyof typeof targets] ?? targets["16:9"];
  if (document.nodes.length === 0) return { minX: 0, minY: 0, ...target };

  let minX = Math.min(...document.nodes.map((node) => node.position.x)) - padding;
  let minY = Math.min(...document.nodes.map((node) => node.position.y)) - padding - 68;
  const maxX = Math.max(...document.nodes.map((node) => node.position.x + (node.size?.width ?? nodeWidth))) + padding;
  const maxY = Math.max(...document.nodes.map((node) =>
    node.position.y + (node.size?.height ?? nodeHeight) + (node.caption ? 20 : 0) + (node.note ? 18 : 0))) + padding;

  let width = Math.max(target.width, maxX - minX);
  let height = Math.max(target.height, maxY - minY);
  if (format === "full") return { minX, minY, width, height };

  const aspect = target.width / target.height;
  if (width / height > aspect) {
    const nextHeight = width / aspect;
    minY -= (nextHeight - height) / 2;
    height = nextHeight;
  } else {
    const nextWidth = height * aspect;
    minX -= (nextWidth - width) / 2;
    width = nextWidth;
  }
  return { minX, minY, width, height };
}

/**
 * The frame whose shape best matches what was actually drawn.
 *
 * "Auto" used to mean "keep whatever the workspace already had", which for a
 * new workspace is 16:9 — so a tall flowchart was fitted into a wide frame by
 * growing the frame sideways, and twenty boxes ended up as a thin ribbon down
 * the middle of a mostly empty 3,925px canvas. Choosing by the content's own
 * aspect ratio is what the label promises.
 */
export function bestFitFormat(document: DiagramDocument): DiagramDocument["format"] {
  if (document.nodes.length === 0) return "16:9";
  const minX = Math.min(...document.nodes.map((node) => node.position.x));
  const minY = Math.min(...document.nodes.map((node) => node.position.y));
  const maxX = Math.max(...document.nodes.map((node) => node.position.x + (node.size?.width ?? nodeWidth)));
  const maxY = Math.max(...document.nodes.map((node) => node.position.y + (node.size?.height ?? nodeHeight)));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const aspect = width / height;

  const candidates: Array<[DiagramDocument["format"], number]> = [
    ["9:16", 720 / 1280],
    ["4:5", 960 / 1200],
    ["1:1", 1],
    ["16:9", 1280 / 720],
  ];
  // Compare in log space so "twice as tall" and "twice as wide" are the same
  // distance from square.
  return candidates.reduce((best, candidate) =>
    Math.abs(Math.log(aspect / candidate[1])) < Math.abs(Math.log(aspect / best[1])) ? candidate : best)[0];
}
