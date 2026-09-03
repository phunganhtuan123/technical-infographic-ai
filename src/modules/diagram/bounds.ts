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
