"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiagramDocument } from "@/modules/diagram/schema";
import { traceStateAt, traceSteps } from "./flow-trace";

/**
 * Playback for the walk-through.
 *
 * One step at a time, at a pace slow enough to read the node you have just
 * arrived at. Playing stops at the end rather than looping: a loop makes it
 * impossible to tell the finish from the start, and someone presenting wants to
 * land on the last box and talk.
 */

const DEFAULT_INTERVAL = 900;

export function useFlowTrace(document: DiagramDocument, options: { interval?: number } = {}) {
  const steps = useMemo(() => traceSteps(document), [document]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const interval = options.interval ?? DEFAULT_INTERVAL;

  // A rebuilt diagram invalidates the walk; drop back to the start rather than
  // lighting a node that may no longer exist.
  const signature = steps.map((step) => step.node).join("|");
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    setIndex(-1);
    setPlaying(false);
  }, [signature]);

  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setIndex((current) => current + 1), index < 0 ? 220 : interval);
    return () => window.clearTimeout(timer);
  }, [index, interval, playing, steps.length]);

  const state = useMemo(() => traceStateAt(steps, index), [index, steps]);

  const play = useCallback(() => {
    setIndex((current) => (current >= steps.length - 1 ? -1 : current));
    setPlaying(true);
  }, [steps.length]);
  const pause = useCallback(() => setPlaying(false), []);
  const stop = useCallback(() => { setPlaying(false); setIndex(-1); }, []);
  const stepForward = useCallback(() => { setPlaying(false); setIndex((current) => Math.min(current + 1, steps.length - 1)); }, [steps.length]);
  const stepBack = useCallback(() => { setPlaying(false); setIndex((current) => Math.max(current - 1, -1)); }, []);

  return {
    steps,
    /** -1 before the walk starts. */
    index: state.index,
    playing,
    active: index >= 0,
    highlight: {
      active: state.activeNode,
      activeEdges: state.activeEdges,
      done: state.done,
      doneEdges: state.doneEdges,
    },
    play,
    pause,
    stop,
    stepForward,
    stepBack,
  };
}
