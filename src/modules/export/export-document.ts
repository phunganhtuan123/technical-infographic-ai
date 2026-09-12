import type { DiagramDocument, DiagramNode, DiagramPort } from "@/modules/diagram/schema";
import { diagramTheme, inkFor, resolveEdgeColor, resolveNodeColor, resolveNodeInk, technologyDetails } from "@/modules/catalog/catalog";
import { routeOrthogonal } from "@/modules/canvas/orthogonal-router";
import { mathToPlainText } from "@/modules/diagram/math-text";
import { fitLabel, wrapLabel } from "@/modules/diagram/label-metrics";
import { Position } from "@xyflow/react";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { serializeWorkspaceFile } from "@/modules/projects/workspace-file";
import { inlineAssets } from "@/modules/projects/asset-urls";
// The canvas draws this same rectangle, so the frame on screen and the file
// that comes out are the same thing by construction.
import { exportBounds as dimensions } from "@/modules/diagram/bounds";
import { planLanes } from "@/modules/layout/lane-plan";

const nodeWidth = 220;
const nodeHeight = 104;
const padding = 72;
const animationDuration = 4.8;
const gifFramesPerSecond = 12;
const videoFramesPerSecond = 24;

type SvgRenderOptions = {
  animate?: boolean;
  animationTime?: number;
};
const flowShapePaths: Partial<Record<DiagramNode["role"], string>> = {
  start: "M43 8H177a42 42 0 0 1 0 84H43a42 42 0 0 1 0-84Z",
  process: "M2 2H218V102H2Z",
  decision: "M110 2 218 52 110 102 2 52Z",
  "input-output": "M28 2H218L192 102H2Z",
  end: "M43 8H177a42 42 0 0 1 0 84H43a42 42 0 0 1 0-84Z",
  document: "M2 2H218V88C184 74 148 104 110 88C72 72 36 104 2 88Z",
  subprocess: "M2 2H218V102H2ZM18 2V102M202 2V102",
  "manual-input": "M28 12 218 2V102H2Z",
  preparation: "M28 2H192L218 52 192 102H28L2 52Z",
  delay: "M2 2H160C237 2 237 102 160 102H2Z",
  connector: "M110 2A50 50 0 1 1 110 102A50 50 0 1 1 110 2Z",
  "off-page": "M30 2H190V76L110 102 30 76Z",
  merge: "M110 102 28 2H192Z",
  "stored-data": "M28 2H198C176 24 176 80 198 102H28C6 80 6 24 28 2Z",
};

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;",
  }[character] ?? character));
}


function portPosition(port: DiagramPort["id"]) {
  if (port === "input") return Position.Left;
  if (port === "output") return Position.Right;
  if (port === "top-center" || port === "event-input" || port === "data-input") return Position.Top;
  return Position.Bottom;
}

function anchor(node: DiagramNode, port: DiagramPort["id"]) {
  const width = node.size?.width ?? nodeWidth;
  const height = node.size?.height ?? nodeHeight;
  if (port === "input") return { x: node.position.x, y: node.position.y + height / 2 };
  if (port === "output") return { x: node.position.x + width, y: node.position.y + height / 2 };
  if (port === "top-center") return { x: node.position.x + width * 0.5, y: node.position.y };
  if (port === "event-input") return { x: node.position.x + width * 0.34, y: node.position.y };
  if (port === "data-input") return { x: node.position.x + width * 0.66, y: node.position.y };
  if (port === "event-input-bottom") return { x: node.position.x + width * 0.34, y: node.position.y + height };
  if (port === "event-output") return { x: node.position.x + width * 0.5, y: node.position.y + height };
  return { x: node.position.x + width * 0.66, y: node.position.y + height };
}

function containerLabelCoordinates(node: DiagramNode, width: number, height: number) {
  const position = node.labelPosition ?? { side: "top" as const, offset: 0.16 };
  const offset = Math.min(0.94, Math.max(0.06, position.offset));
  if (position.side === "right") return { x: width, y: height * offset, anchor: "middle", rotate: 90 };
  if (position.side === "bottom") return { x: width * offset, y: height, anchor: "middle", rotate: 0 };
  if (position.side === "left") return { x: 0, y: height * offset, anchor: "middle", rotate: -90 };
  return { x: width * offset, y: 0, anchor: "middle", rotate: 0 };
}



/** A node label as <tspan> lines, centred on the first baseline. */
function labelLines(text: string, boxWidth: number, fontSize: number, x: number, y: number, anchor: string, extra: string) {
  const lines = wrapLabel(text, boxWidth, fontSize);
  if (lines.length === 1) {
    return `<text x="${x}" y="${y}" text-anchor="${anchor}"${extra}>${escapeXml(lines[0])}</text>`;
  }
  // Lift the block so a two-line label stays centred where one line sat.
  const step = Math.round(fontSize * 1.15);
  const top = y - Math.round(step / 2);
  return `<text x="${x}" y="${top}" text-anchor="${anchor}"${extra}>${lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : step}">${escapeXml(line)}</tspan>`)
    .join("")}</text>`;
}

function nodeTypography(node: DiagramNode, width: number, sheetInk: string) {
  const family = node.fontFamily === "system-sans" ? "Inter,ui-sans-serif,sans-serif"
    : node.fontFamily === "jetbrains-mono" ? "JetBrains Mono,ui-monospace,monospace"
      : node.fontFamily === "ibm-plex-mono" ? "IBM Plex Mono,ui-monospace,monospace"
        : "Geist Mono,ui-monospace,monospace";
  const align = node.textAlign ?? (flowShapePaths[node.role] ? "center" : "left");
  const inset = node.role === "note" ? 18 : 16;
  return {
    family,
    size: node.fontSize ?? (node.role === "text" ? 18 : node.role === "note" ? 13 : 14),
    weight: node.fontWeight ?? 700,
    color: resolveNodeInk(node.textColor, sheetInk),
    anchor: align === "center" ? "middle" : align === "right" ? "end" : "start",
    x: align === "center" ? width / 2 : align === "right" ? width - inset : inset,
  };
}

function animationPhase(time: number, speed: number, offset = 0) {
  return ((time / Math.max(0.4, speed) + offset) % 1 + 1) % 1;
}

function pointAlongRoute(points: Array<{ x: number; y: number }>, progress: number) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = total * progress;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index]) {
      const ratio = lengths[index] ? remaining / lengths[index] : 0;
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      };
    }
    remaining -= lengths[index];
  }
  return points.at(-1) ?? { x: 0, y: 0 };
}

function edgeAnimation(
  edge: DiagramDocument["edges"][number],
  route: { path: string; points: Array<{ x: number; y: number }> },
  options: SvgRenderOptions,
) {
  if (!options.animate || !edge.animated) return "";
  const speed = Math.max(0.4, edge.speed);
  const controlled = options.animationTime !== undefined;
  const phase = animationPhase(options.animationTime ?? 0, speed);
  const movingDot = (offset = 0, opacity = 1) => {
    if (controlled) {
      const point = pointAlongRoute(route.points, (phase + offset) % 1);
      return `<circle cx="${point.x}" cy="${point.y}" r="3.2" fill="${edge.color}" fill-opacity="${opacity}" style="filter:drop-shadow(0 0 5px ${edge.color})"/>`;
    }
    return `<circle r="3.2" fill="${edge.color}" fill-opacity="${opacity}" style="filter:drop-shadow(0 0 5px ${edge.color})"><animateMotion dur="${speed}s" begin="${-offset * speed}s" repeatCount="indefinite" path="${route.path}"/></circle>`;
  };

  if (edge.effect === "signal") return movingDot(0) + movingDot(0.5, 0.64);
  if (edge.effect === "trail") {
    const offset = -248 * phase;
    return `<path d="${route.path}" fill="none" stroke="${edge.color}" stroke-width="${edge.thickness + 1.4}" stroke-linecap="round" stroke-dasharray="28 220" stroke-dashoffset="${offset}" style="filter:drop-shadow(0 0 4px ${edge.color})">${controlled ? "" : `<animate attributeName="stroke-dashoffset" from="0" to="-248" dur="${speed}s" repeatCount="indefinite"/>`}</path>`;
  }
  if (edge.effect === "dash") {
    const offset = -52 * phase;
    return `<path d="${route.path}" fill="none" stroke="${edge.color}" stroke-width="${edge.thickness}" stroke-linecap="round" stroke-dasharray="5 8" stroke-dashoffset="${offset}">${controlled ? "" : `<animate attributeName="stroke-dashoffset" from="0" to="-52" dur="${speed}s" repeatCount="indefinite"/>`}</path>`;
  }
  if (edge.effect === "glow") {
    const opacity = 0.25 + Math.sin(phase * Math.PI) * 0.75;
    return `<path d="${route.path}" fill="none" stroke="${edge.color}" stroke-width="${edge.thickness + 2}" stroke-linecap="round" stroke-opacity="${opacity}" style="filter:drop-shadow(0 0 6px ${edge.color})">${controlled ? "" : `<animate attributeName="stroke-opacity" values=".25;1;.25" dur="${speed}s" repeatCount="indefinite"/>`}</path>`;
  }
  return movingDot();
}

function nodeAnimation(node: DiagramNode, width: number, height: number, options: SvgRenderOptions, shape?: string) {
  if (!options.animate || node.effect === "none") return "";
  const speed = Math.max(0.4, node.speed);
  const controlled = options.animationTime !== undefined;
  const phase = animationPhase(options.animationTime ?? 0, speed);
  const outline = (opacity: number, strokeWidth: number, content = "") => shape
    ? `<path d="${shape}" fill="none" stroke="${node.color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" style="filter:drop-shadow(0 0 6px ${node.color})">${content}</path>`
    : `<rect x="2" y="2" width="${Math.max(1, width - 4)}" height="${Math.max(1, height - 4)}" rx="10" fill="none" stroke="${node.color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}" style="filter:drop-shadow(0 0 6px ${node.color})">${content}</rect>`;

  if (node.effect === "trail") {
    const x = (width - width * 0.28) * phase;
    return `<rect x="${x}" y="0" width="${width * 0.28}" height="2.4" rx="1.2" fill="${node.color}" style="filter:drop-shadow(0 0 5px ${node.color})">${controlled ? "" : `<animate attributeName="x" from="0" to="${width - width * 0.28}" dur="${speed}s" repeatCount="indefinite"/>`}</rect>`;
  }
  if (node.effect === "scan") {
    const y = height * phase;
    return `<rect x="4" y="${y}" width="${Math.max(1, width - 8)}" height="2" rx="1" fill="${node.color}" fill-opacity=".65" style="filter:drop-shadow(0 0 6px ${node.color})">${controlled ? "" : `<animate attributeName="y" from="0" to="${height}" dur="${speed}s" repeatCount="indefinite"/>`}</rect>`;
  }
  const opacity = node.effect === "pulse" ? Math.max(0, Math.sin(phase * Math.PI)) * 0.82 : 0.2 + Math.sin(phase * Math.PI) * 0.68;
  return outline(opacity, node.effect === "pulse" ? 1.4 : 2, controlled ? "" : `<animate attributeName="stroke-opacity" values=".18;.9;.18" dur="${speed}s" repeatCount="indefinite"/>`);
}

export function renderDocumentSvg(document: DiagramDocument, options: SvgRenderOptions = { animate: true }) {
  const renderOptions = { animate: options.animate ?? true, animationTime: options.animationTime };
  const bounds = dimensions(document);
  // The export follows the document's own theme rather than assuming the black
  // canvas this used to ship with, so a light diagram exports light.
  const canvas = document.theme?.background ?? diagramTheme.background;
  const ink = inkFor(canvas);
  // Resolve legacy palette entries once, up front, so every one of the drawing
  // branches below reads an already-current colour.
  document = {
    ...document,
    nodes: document.nodes.map((node) => ({ ...node, color: resolveNodeColor(node.color, node.role) })),
    edges: document.edges.map((edge) => ({ ...edge, color: resolveEdgeColor(edge.color, edge.semantics) })),
  };
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  // The same corridors the canvas routes along, so an export is the drawing the
  // user approved rather than a second, differently tangled one.
  const routeLanes = planLanes(
    document.nodes.filter((node) => node.role !== "zone" && node.role !== "group"),
    document.edges,
  ).lanes;
  const edges = document.edges.map((edge, edgeIndex) => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) return "";
    const start = anchor(from, edge.sourcePort);
    const end = anchor(to, edge.targetPort);
    const obstacles = document.nodes
      .filter((node) => node.id !== from.id && node.id !== to.id && node.role !== "zone" && node.role !== "group")
      .map((node) => ({
        x: node.position.x,
        y: node.position.y,
        width: node.size?.width ?? nodeWidth,
        height: node.size?.height ?? nodeHeight,
      }));
    const route = routeOrthogonal({
      source: start,
      target: end,
      sourcePosition: portPosition(edge.sourcePort),
      targetPosition: portPosition(edge.targetPort),
      obstacles,
      protectedObstacles: [from, to].map((node) => ({
        x: node.position.x + 3,
        y: node.position.y + 3,
        width: Math.max(1, (node.size?.width ?? nodeWidth) - 6),
        height: Math.max(1, (node.size?.height ?? nodeHeight) - 6),
      })),
      waypoints: edge.routeWaypoints ?? (edge.routeWaypoint ? [edge.routeWaypoint] : undefined),
      offset: 12 + (edgeIndex % 4) * 6,
      laneY: routeLanes.get(edge.id)?.laneY,
      laneX: routeLanes.get(edge.id)?.laneX,
    });
    const color = edge.color;
    const marker = `arrow-${edge.id.replace(/[^a-z0-9_-]/gi, "-")}`;
    const markerStart = edge.direction === "reverse" || edge.direction === "both" ? ` marker-start="url(#${marker})"` : "";
    const markerEnd = edge.direction === "forward" || edge.direction === "both" ? ` marker-end="url(#${marker})"` : "";
    const captionWidth = Math.max(42, (edge.label?.length ?? 0) * 5.2 + 16);
    const caption = edge.label ? `<g transform="translate(${route.labelX + (edge.labelOffset?.x ?? 0)} ${route.labelY + (edge.labelOffset?.y ?? 0)})"><rect x="${-captionWidth / 2}" y="-11" width="${captionWidth}" height="22" rx="11" fill="${canvas}" stroke="${color}"/><text y="3" text-anchor="middle" fill="${color}" font-size="8">${escapeXml(edge.label)}</text></g>` : "";
    const dash = edge.strokeStyle === "dashed" ? ` stroke-dasharray="8 7"` : edge.strokeStyle === "dotted" ? ` stroke-dasharray="1 7" stroke-linecap="round"` : "";
    const animation = edgeAnimation(edge, route, renderOptions);
    return `<defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" fill="${color}"/></marker></defs><path d="${route.path}" fill="none" stroke="${canvas}" stroke-width="${edge.thickness + 8}" stroke-linecap="round" stroke-linejoin="round"/><path d="${route.path}" fill="none" stroke="${color}" stroke-width="${edge.thickness}" stroke-opacity=".72" stroke-linecap="round" stroke-linejoin="round"${dash}${markerStart}${markerEnd}/>${animation}${caption}`;
  }).join("");
  const cards = [...document.nodes].sort((left, right) => {
    const layer = (node: DiagramNode) => node.zIndex ?? (node.role === "zone" ? -2 : node.role === "group" ? -1 : 1);
    return layer(left) - layer(right);
  }).map((node) => {
    const width = node.size?.width ?? nodeWidth;
    const height = node.size?.height ?? nodeHeight;
    const scaleX = width / nodeWidth;
    const scaleY = height / nodeHeight;
    const technology = technologyDetails(node.technology);
    const shape = flowShapePaths[node.role];
    const typography = nodeTypography(node, node.role === "text" || node.role === "note" || node.role === "zone" || node.role === "group" ? width : nodeWidth, ink.strong);
    const secondarySize = Math.max(8, Math.round(typography.size * 0.62));
    const dash = node.borderStyle === "dashed" ? ` stroke-dasharray="8 6"` : node.borderStyle === "dotted" ? ` stroke-dasharray="1 7" stroke-linecap="round"` : "";
    if (node.role === "zone" || node.role === "group") {
      const label = containerLabelCoordinates(node, width, height);
      return `<g transform="translate(${node.position.x} ${node.position.y})"><rect width="${width}" height="${height}" rx="14" fill="${node.color}" fill-opacity=".025" stroke="${node.color}" stroke-opacity=".48" stroke-width="${node.borderWidth}" stroke-dasharray="8 7"/>${nodeAnimation(node, width, height, renderOptions)}<g transform="translate(${label.x} ${label.y}) rotate(${label.rotate})"><rect x="-52" y="-12" width="104" height="24" rx="6" fill="${canvas}" stroke="${node.color}" stroke-opacity=".54"/><text y="4" text-anchor="${label.anchor}" fill="${typography.color}" font-family="${typography.family}" font-size="${typography.size}" font-weight="${typography.weight}">${escapeXml(fitLabel(mathToPlainText(node.label), width, typography.size))}</text></g></g>`;
    }
    if (node.role === "text") {
      return `<g transform="translate(${node.position.x} ${node.position.y})" font-family="${typography.family}"><text x="${typography.x}" y="${typography.size + 4}" text-anchor="${typography.anchor}" fill="${typography.color}" font-size="${typography.size}" font-weight="${typography.weight}">${escapeXml(fitLabel(mathToPlainText(node.label), width, typography.size))}</text>${node.detail ? `<text x="${typography.x}" y="${typography.size + 28}" text-anchor="${typography.anchor}" fill="${typography.color}" fill-opacity=".62" font-size="${secondarySize}">${escapeXml(fitLabel(mathToPlainText(node.detail), width, secondarySize))}</text>` : ""}${nodeAnimation(node, width, height, renderOptions)}</g>`;
    }
    if (node.role === "note") {
      return `<g transform="translate(${node.position.x} ${node.position.y})" font-family="${typography.family}"><rect width="${width}" height="${height}" rx="10" fill="${node.color}" fill-opacity=".07" stroke="${node.color}" stroke-opacity=".46" stroke-width="${node.borderWidth}"${dash}/><rect x="0" y="0" width="3" height="${height}" rx="1.5" fill="${node.color}"/><text x="18" y="25" fill="${node.color}" font-size="9" letter-spacing="1">NOTE</text><text x="${typography.x}" y="58" text-anchor="${typography.anchor}" fill="${typography.color}" font-size="${typography.size}" font-weight="${typography.weight}">${escapeXml(fitLabel(mathToPlainText(node.label), width, typography.size))}</text>${node.detail ? `<text x="${typography.x}" y="82" text-anchor="${typography.anchor}" fill="${typography.color}" fill-opacity=".62" font-size="${secondarySize}">${escapeXml(fitLabel(mathToPlainText(node.detail), width, secondarySize))}</text>` : ""}${nodeAnimation(node, width, height, renderOptions)}</g>`;
    }
    const cardShape = shape
      ? `<path d="${shape}" fill="${node.color}" fill-opacity=".08" stroke="${node.color}" stroke-opacity=".58" stroke-width="${node.borderWidth}"${dash}/>`
      : `<rect width="${nodeWidth}" height="${nodeHeight}" rx="12" fill="${node.color}" fill-opacity=".08" stroke="${node.color}" stroke-opacity=".48" stroke-width="${node.borderWidth}"${dash}/>`;
    const clipId = `node-clip-${node.id.replace(/[^a-z0-9_-]/gi, "-")}`;
    const clipShape = shape ? `<path d="${shape}"/>` : `<rect width="${nodeWidth}" height="${nodeHeight}" rx="12"/>`;
    const background = node.backgroundImage ? `<defs><clipPath id="${clipId}">${clipShape}</clipPath></defs><image href="${escapeXml(node.backgroundImage)}" width="${nodeWidth}" height="${nodeHeight}" opacity="${node.backgroundOpacity ?? 0.28}" preserveAspectRatio="xMidYMid ${node.backgroundFit === "contain" ? "meet" : "slice"}" clip-path="url(#${clipId})"/>` : "";
    const technologyMark = technology ? `<g transform="translate(184 10)"><rect width="26" height="26" rx="7" fill="${technology.color}" fill-opacity=".08" stroke="${technology.color}" stroke-opacity=".48"/><text x="13" y="17" text-anchor="middle" fill="${technology.color}" font-size="7" font-weight="700">${technology.badge}</text></g>` : "";
    const content = shape ? `
      <text x="110" y="31" text-anchor="middle" fill="${node.color}" fill-opacity=".82" font-size="8" letter-spacing="1">${escapeXml(node.role.toUpperCase())}</text>
      ${labelLines(mathToPlainText(node.label), width, typography.size, typography.x, 57, typography.anchor, ` fill="${typography.color}" font-family="${typography.family}" font-size="${typography.size}" font-weight="${typography.weight}"`)}
      <text x="${typography.x}" y="78" text-anchor="${typography.anchor}" fill="${typography.color}" fill-opacity=".58" font-family="${typography.family}" font-size="${secondarySize}">${escapeXml(fitLabel(mathToPlainText(node.detail ?? "flow step"), nodeWidth, secondarySize))}</text>` : `
      <rect x="15" width="44" height="2" rx="1" fill="${node.color}" fill-opacity=".7"/>
      <text x="16" y="24" fill="${node.color}" fill-opacity=".8" font-size="9" letter-spacing="1.2">${escapeXml(node.role.toUpperCase())}</text>
      ${technologyMark || `<circle cx="202" cy="20" r="3" fill="${node.color}"/>`}
      ${labelLines(mathToPlainText(node.label), nodeWidth, typography.size, typography.x, 60, typography.anchor, ` fill="${typography.color}" font-family="${typography.family}" font-size="${typography.size}" font-weight="${typography.weight}"`)}
      <text x="${typography.x}" y="85" text-anchor="${typography.anchor}" fill="${typography.color}" fill-opacity=".58" font-family="${typography.family}" font-size="${secondarySize}">${escapeXml(fitLabel(mathToPlainText(node.detail ?? node.technology ?? "system component"), nodeWidth, secondarySize))}</text>`;
    return `
    <g transform="translate(${node.position.x} ${node.position.y})">
      <g transform="scale(${scaleX} ${scaleY})">
      ${cardShape}
      ${background}
      ${content}
      ${nodeAnimation(node, nodeWidth, nodeHeight, renderOptions, shape)}
      </g>
      ${node.caption ? `<text x="${typography.x / nodeWidth * width}" y="${height + 16}" text-anchor="${typography.anchor}" fill="${typography.color}" fill-opacity=".48" font-family="${typography.family}" font-size="${secondarySize}">${escapeXml(mathToPlainText(node.caption).slice(0, 42))}</text>` : ""}
      ${node.note ? `<text x="${typography.x / nodeWidth * width}" y="${height + (node.caption ? 32 : 16)}" text-anchor="${typography.anchor}" fill="${typography.color}" fill-opacity=".42" font-family="${typography.family}" font-size="${Math.max(8, secondarySize - 1)}">${escapeXml(mathToPlainText(node.note).slice(0, 48))}</text>` : ""}
    </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(bounds.width)}" height="${Math.round(bounds.height)}" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}">
  <rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="${canvas}"/>
  <text x="${bounds.minX + padding}" y="${bounds.minY + 34}" fill="${ink.strong}" font-family="ui-monospace,monospace" font-size="22" font-weight="650">${escapeXml(mathToPlainText(document.title))}</text>
  <text x="${bounds.minX + padding}" y="${bounds.minY + 54}" fill="${ink.muted}" font-family="ui-monospace,monospace" font-size="10">${escapeXml(mathToPlainText(document.purpose).slice(0, 120))}</text>
  <g font-family="ui-monospace,monospace">${edges}${cards}</g>
  </svg>`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Every export inlines its images first. A signed asset URL expires within the
// hour, so a file that merely points at one is broken before anybody opens it —
// and for PNG it is worse than broken: an SVG referencing another origin taints
// the canvas, and toBlob throws instead of saving.
export async function exportSvg(document: DiagramDocument) {
  const ready = await inlineAssets(document);
  download(new Blob([renderDocumentSvg(ready)], { type: "image/svg+xml" }), `${ready.id}.svg`);
}

export async function exportHtml(document: DiagramDocument) {
  const ready = await inlineAssets(document);
  const svg = renderDocumentSvg(ready);
  const canvas = ready.theme?.background ?? diagramTheme.background;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeXml(ready.title)}</title><style>html,body{margin:0;background:${canvas};display:grid;place-items:center;min-height:100%;overflow:hidden}svg{width:100%;height:100%;max-width:100vw;max-height:100vh}</style></head><body>${svg}</body></html>`;
  download(new Blob([html], { type: "text/html" }), `${ready.id}.html`);
}

// The workspace file is inlined too. An asset reference means nothing to
// somebody opening this on another account, and a portable file is the whole
// point of an export.
export async function exportWorkspaceJson(document: DiagramDocument) {
  const ready = await inlineAssets(document);
  download(new Blob([serializeWorkspaceFile(ready)], { type: "application/json" }), `${ready.id}.technical-infographic.json`);
}

export async function exportPng(document: DiagramDocument) {
  const ready = await inlineAssets(document);
  const svg = renderDocumentSvg(ready, { animate: false });
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  image.onload = () => {
    const canvas = window.document.createElement("canvas");
    canvas.width = image.naturalWidth * 2;
    canvas.height = image.naturalHeight * 2;
    const context = canvas.getContext("2d");
    context?.scale(2, 2);
    context?.drawImage(image, 0, 0);
    canvas.toBlob((blob) => { if (blob) download(blob, `${ready.id}.png`); }, "image/png");
    URL.revokeObjectURL(url);
  };
  image.src = url;
}

function rasterDimensions(document: DiagramDocument, maxDimension: number) {
  const bounds = dimensions(document);
  const scale = Math.min(1, maxDimension / Math.max(bounds.width, bounds.height));
  return { width: Math.max(1, Math.round(bounds.width * scale)), height: Math.max(1, Math.round(bounds.height * scale)) };
}

function loadSvgImage(svg: string) {
  return new Promise<{ image: HTMLImageElement; url: string }>((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not render animation frame")); };
    image.src = url;
  });
}

async function drawAnimationFrame(document: DiagramDocument, canvas: HTMLCanvasElement, time: number) {
  const { image, url } = await loadSvgImage(renderDocumentSvg(document, { animate: true, animationTime: time }));
  try {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas rendering is unavailable");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportGif(document: DiagramDocument) {
  // Same reason as the still exports, and one more: every frame is drawn onto a
  // canvas, which an image from another origin would taint.
  const ready = await inlineAssets(document);
  const size = rasterDimensions(ready, 960);
  const canvas = window.document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("Canvas rendering is unavailable");
  const encoder = GIFEncoder();
  const frameCount = Math.round(animationDuration * gifFramesPerSecond);
  const delay = Math.round(1000 / gifFramesPerSecond);

  for (let frame = 0; frame < frameCount; frame += 1) {
    await drawAnimationFrame(ready, canvas, frame / gifFramesPerSecond);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const palette = quantize(rgba, 128, { format: "rgb565" });
    encoder.writeFrame(applyPalette(rgba, palette, "rgb565"), canvas.width, canvas.height, { palette, delay, repeat: 0 });
    if (frame % 4 === 3) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  encoder.finish();
  const bytes = encoder.bytes();
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  download(new Blob([payload], { type: "image/gif" }), `${ready.id}.gif`);
}

export type VideoFormat = "webm" | "mp4";

/**
 * Codecs to try for each container, best first.
 *
 * MP4 recording is browser-side and recent: Safari has had it for a while,
 * Chrome only since 126, and Firefox does not do it at all. There is no
 * transcoding fallback here — re-encoding VP9 to H.264 in the page would cost
 * more than the export is worth — so a browser that cannot record MP4 is told
 * so plainly rather than handed a file with the wrong contents.
 */
const videoCandidates: Record<VideoFormat, string[]> = {
  webm: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
  mp4: ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4;codecs=h264", "video/mp4"],
};

function supportedVideoMimeType(format: VideoFormat) {
  if (typeof MediaRecorder === "undefined") return undefined;
  return videoCandidates[format].find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

/** Which of the offered formats this browser can actually record. */
export function videoFormatSupport(): Record<VideoFormat, boolean> {
  return {
    webm: Boolean(supportedVideoMimeType("webm")),
    mp4: Boolean(supportedVideoMimeType("mp4")),
  };
}

export async function exportVideo(document: DiagramDocument, format: VideoFormat = "webm") {
  if (typeof MediaRecorder === "undefined") throw new Error("Video export is not supported by this browser");
  const mimeType = supportedVideoMimeType(format);
  if (!mimeType) {
    throw new Error(format === "mp4"
      ? "This browser cannot record MP4. Chrome 126+ or Safari can; otherwise export WebM."
      : "This browser cannot encode WebM video");
  }
  const ready = await inlineAssets(document);
  const size = rasterDimensions(ready, 1920);
  const canvas = window.document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const stream = canvas.captureStream(videoFramesPerSecond);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("Video encoding failed"));
  });
  recorder.start(250);
  const startedAt = performance.now();
  const frameCount = Math.round(animationDuration * videoFramesPerSecond);

  try {
    for (let frame = 0; frame < frameCount; frame += 1) {
      await drawAnimationFrame(ready, canvas, frame / videoFramesPerSecond);
      const wait = (frame + 1) * (1000 / videoFramesPerSecond) - (performance.now() - startedAt);
      if (wait > 0) await new Promise((resolve) => window.setTimeout(resolve, wait));
    }
    recorder.stop();
    await stopped;
    download(new Blob(chunks, { type: mimeType }), `${ready.id}.${format}`);
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    if (recorder.state !== "inactive") recorder.stop();
  }
}
