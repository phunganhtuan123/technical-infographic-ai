"use client";

import { useMemo } from "react";

/**
 * Lights the walk-through on the canvas.
 *
 * The highlight is applied as a generated stylesheet keyed on the ids React
 * Flow already puts in the DOM, rather than by pushing a class into every node
 * and edge. Playing a diagram changes the lit node several times a second;
 * routing that through React Flow's node state would re-render — and re-measure
 * — the whole graph on every tick, for something that is purely paint.
 */

export type FlowTraceHighlight = {
  active?: string;
  activeEdges: Set<string>;
  done: Set<string>;
  doneEdges: Set<string>;
};

const escapeId = (id: string) => id.replace(/["\\]/g, "\\$&");

export function FlowTraceStyles({ enabled, highlight }: { enabled: boolean; highlight: FlowTraceHighlight }) {
  const css = useMemo(() => {
    if (!enabled) return "";

    const nodeSelector = (id: string) => `.react-flow__node[data-id="${escapeId(id)}"]`;
    const edgeSelector = (id: string) => `.react-flow__edge[data-id="${escapeId(id)}"]`;

    const doneNodes = [...highlight.done].map(nodeSelector).join(",");
    const doneEdges = [...highlight.doneEdges].map(edgeSelector).join(",");
    const activeEdges = [...highlight.activeEdges].map(edgeSelector).join(",");
    const activeNode = highlight.active ? nodeSelector(highlight.active) : "";

    return [
      // Everything recedes, then what has been reached comes back.
      `.is-tracing .react-flow__node, .is-tracing .react-flow__edge { opacity: .18; transition: opacity 320ms var(--ease), filter 320ms var(--ease); }`,
      doneNodes ? `.is-tracing :is(${doneNodes}) { opacity: .92; }` : "",
      doneEdges ? `.is-tracing :is(${doneEdges}) { opacity: .8; }` : "",
      activeEdges ? `.is-tracing :is(${activeEdges}) { opacity: 1; filter: drop-shadow(0 0 5px var(--trace-glow)); }` : "",
      activeNode ? `.is-tracing ${activeNode} { opacity: 1; z-index: 60 !important; }` : "",
      activeNode ? `.is-tracing ${activeNode} .semantic-node { animation: trace-pulse 1.1s var(--ease) infinite; }` : "",
      activeNode ? `.is-tracing ${activeNode} .node-shape-fill { stroke-width: 2.4px; }` : "",
    ].filter(Boolean).join("\n");
  }, [enabled, highlight]);

  if (!css) return null;
  return <style>{css}</style>;
}
