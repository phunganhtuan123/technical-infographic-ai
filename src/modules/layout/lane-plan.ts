/**
 * Where each connector is allowed to run, decided for the whole drawing at once.
 *
 * The router only ever sees one connector. Two connectors that need the same
 * corridor — the gap between two rows, or the margin down the side of the
 * sheet — both pick the middle of it and are drawn as one line. Nothing the
 * router can do about that on its own: the choice has to be made once, with
 * every connector in view, and handed to it.
 *
 * A corridor is divided into channels, handed out by greedy interval colouring:
 * a connector takes the innermost channel whose span it does not share with a
 * connector already on it. Two connectors only end up on the same channel when
 * their spans do not touch, which is exactly when sharing it is invisible.
 */

import type { DiagramEdge } from "@/modules/diagram/schema";

export type LaneBox = {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
};

/** The corridor a connector was given. Absent means "straight there". */
export type RouteLane = { laneY?: number; laneX?: number };

export type LaneRow = { top: number; bottom: number; ids: string[] };

export type LanePlan = {
  lanes: Map<string, RouteLane>;
  /** Channels claimed in the gap below row `index`, so the layout can widen it. */
  demand: Map<number, number>;
  rows: LaneRow[];
};

/** Distance between two horizontal corridors in the same gap. */
export const CHANNEL_SPACING = 26;
/** Distance between two vertical corridors running down the same margin. */
export const SIDE_SPACING = 34;
/** How far the first side corridor sits outside the drawing. */
const SIDE_MARGIN = 52;
/** First horizontal corridor, measured down from the row above it. */
const BAND_INSET = 30;
/** Tops within this distance of each other are the same row. */
const ROW_TOLERANCE = 32;
/** A sideways hop shorter than this is not worth a corridor. */
const STRAIGHT_ENOUGH = 18;
const MAX_CHANNELS = 6;

type Claim = { from: number; to: number };
type Claims = Claim[][];

/** Group nodes into rows by their top edge. */
export function laneRows(nodes: LaneBox[]): LaneRow[] {
  const rows: LaneRow[] = [];
  for (const node of [...nodes].sort((left, right) => left.position.y - right.position.y)) {
    const top = node.position.y;
    const bottom = top + node.size.height;
    const row = rows.find((candidate) => Math.abs(candidate.top - top) <= ROW_TOLERANCE);
    if (row) {
      row.top = Math.min(row.top, top);
      row.bottom = Math.max(row.bottom, bottom);
      row.ids.push(node.id);
    } else {
      rows.push({ top, bottom, ids: [node.id] });
    }
  }
  return rows.sort((left, right) => left.top - right.top);
}

/** Lowest channel whose claims do not overlap this span. */
function claimChannel(claims: Claims, from: number, to: number) {
  const span = { from: Math.min(from, to) - 14, to: Math.max(from, to) + 14 };
  for (let channel = 0; channel < MAX_CHANNELS; channel += 1) {
    const taken = claims[channel] ?? (claims[channel] = []);
    if (!taken.some((claim) => claim.from < span.to && span.from < claim.to)) {
      taken.push(span);
      return channel;
    }
  }
  claims[MAX_CHANNELS - 1].push(span);
  return MAX_CHANNELS - 1;
}

/**
 * Hand every connector a corridor.
 *
 * Short hops straight down get nothing — they are already clear. Anything that
 * has to move sideways gets a horizontal channel in the gap below the row it
 * leaves; anything that has to pass a row, or climb back up the drawing, also
 * gets a vertical channel in the margin on whichever side it is nearer.
 */
export function planLanes(
  nodes: LaneBox[],
  edges: Pick<DiagramEdge, "id" | "from" | "to">[],
): LanePlan {
  const lanes = new Map<string, RouteLane>();
  const demand = new Map<number, number>();
  const rows = laneRows(nodes);
  if (!rows.length) return { lanes, demand, rows };

  const box = new Map(nodes.map((node) => [node.id, {
    centreX: node.position.x + node.size.width / 2,
    centreY: node.position.y + node.size.height / 2,
  }]));
  const rowOf = new Map<string, number>();
  rows.forEach((row, index) => { for (const id of row.ids) rowOf.set(id, index); });

  const sheetLeft = Math.min(...nodes.map((node) => node.position.x));
  const sheetRight = Math.max(...nodes.map((node) => node.position.x + node.size.width));
  const sheetMiddle = (sheetLeft + sheetRight) / 2;

  const bandClaims = new Map<number, Claims>();
  const sideClaims: Record<"left" | "right", Claims> = { left: [], right: [] };
  // A connector climbing back up out of the bottom row has no gap below it to
  // turn in, so it turns under the drawing instead.
  const belowClaims: Claims = [];
  const sheetBottom = Math.max(...nodes.map((node) => node.position.y + node.size.height));

  const routable = edges
    .filter((edge) => edge.from !== edge.to && box.has(edge.from) && box.has(edge.to))
    .map((edge) => {
      const from = box.get(edge.from)!;
      const to = box.get(edge.to)!;
      return { edge, from, to, span: Math.abs(to.centreX - from.centreX) + Math.abs(to.centreY - from.centreY) };
    })
    // Short connectors first, so they take the channels nearest the boxes and
    // the long ones are pushed out where they have room to run.
    .sort((left, right) => left.span - right.span || left.edge.id.localeCompare(right.edge.id));

  for (const { edge, from, to } of routable) {
    const fromRow = rowOf.get(edge.from) ?? 0;
    const toRow = rowOf.get(edge.to) ?? 0;
    const forward = toRow > fromRow;
    const sideways = Math.abs(to.centreX - from.centreX) > STRAIGHT_ENOUGH;
    const spansRows = toRow - fromRow > 1;
    const lane: RouteLane = {};

    // Adjacent rows, straight down: already in a lane of its own.
    if (forward && !spansRows && !sideways) continue;

    // The horizontal run happens in the gap below the row the connector leaves,
    // which is the one it is turning in. Picking any other gap puts the turn
    // above the box the connector starts at, and the route doubles back.
    const above = rows[fromRow];
    const below = rows[fromRow + 1];
    if (above && below) {
      const claims = bandClaims.get(fromRow) ?? [];
      bandClaims.set(fromRow, claims);
      const channel = claimChannel(claims, from.centreX, to.centreX);
      const gap = below.top - above.bottom;
      lane.laneY = Math.round(above.bottom + Math.min(BAND_INSET + channel * CHANNEL_SPACING, Math.max(16, gap - 16)));
      demand.set(fromRow, Math.max(demand.get(fromRow) ?? 0, channel + 1));
    } else if (!forward) {
      const channel = claimChannel(belowClaims, from.centreX, to.centreX);
      lane.laneY = Math.round(sheetBottom + BAND_INSET + channel * CHANNEL_SPACING);
    }

    // Passing a whole row, or climbing back up, means leaving the columns
    // entirely — otherwise the connector is drawn straight over whatever
    // happens to sit between the two ends.
    if (spansRows || !forward) {
      // The side is picked by where the connector has to *arrive*, not by the
      // midpoint of the two ends. A connector that swings out to the right and
      // then comes back into a left-facing port has to pass the box to reach
      // it, and the route doubles back on itself.
      const side = to.centreX <= sheetMiddle ? "left" : "right";
      const channel = claimChannel(sideClaims[side], from.centreY, to.centreY);
      lane.laneX = Math.round(side === "left"
        ? sheetLeft - SIDE_MARGIN - channel * SIDE_SPACING
        : sheetRight + SIDE_MARGIN + channel * SIDE_SPACING);
    }

    if (lane.laneX !== undefined || lane.laneY !== undefined) lanes.set(edge.id, lane);
  }

  return { lanes, demand, rows };
}

/** Height a gap needs to hold the channels claimed in it. */
export function gapForChannels(channels: number) {
  return channels ? BAND_INSET * 2 + (channels - 1) * CHANNEL_SPACING : 0;
}
