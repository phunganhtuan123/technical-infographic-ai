"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Where the chat launcher sits, and where its panel opens from.
 *
 * The launcher is draggable, so the panel cannot have one fixed corner: it has
 * to open into whichever side of the launcher has room. Positions are stored in
 * the corner-relative form the CSS uses, so the launcher stays put across a
 * resize instead of drifting off-screen with an absolute left/top.
 */

export const BUBBLE_STORAGE_KEY = "technical-infographic:chat-bubble";

export const BUBBLE_SIZE = 52;
/** Closed it is a labelled pill; open it collapses to a round dismiss button. */
export const BUBBLE_WIDTH_CLOSED = 138;
export const BUBBLE_WIDTH_OPEN = BUBBLE_SIZE;

export function bubbleWidth(open: boolean) {
  return open ? BUBBLE_WIDTH_OPEN : BUBBLE_WIDTH_CLOSED;
}
const MARGIN = 20;
const PANEL_WIDTH = 372;
const PANEL_GAP = 12;
/** Below this, a pointer sequence is a click rather than a drag. */
const DRAG_THRESHOLD = 4;

export type BubblePosition = { right: number; bottom: number };

export const defaultBubblePosition: BubblePosition = { right: MARGIN, bottom: MARGIN };

export function clampBubble(
  position: BubblePosition,
  viewport: { width: number; height: number },
  width = BUBBLE_WIDTH_CLOSED,
): BubblePosition {
  const maxRight = Math.max(MARGIN, viewport.width - width - MARGIN);
  const maxBottom = Math.max(MARGIN, viewport.height - BUBBLE_SIZE - MARGIN);
  return {
    right: Math.min(Math.max(MARGIN, position.right), maxRight),
    bottom: Math.min(Math.max(MARGIN, position.bottom), maxBottom),
  };
}

/**
 * Panel placement for a launcher position, as fixed-position offsets.
 *
 * It opens above the launcher when there is room and below when there is not,
 * and it is pulled back inside the viewport rather than being allowed to run
 * off the edge the launcher was dragged to.
 */
export function panelPlacement(
  bubble: BubblePosition,
  viewport: { width: number; height: number },
  panelHeight: number,
  launcherWidth = BUBBLE_WIDTH_OPEN,
) {
  const bubbleLeft = viewport.width - bubble.right - launcherWidth;
  const bubbleTop = viewport.height - bubble.bottom - BUBBLE_SIZE;

  // Prefer aligning the panel's right edge with the launcher's, then keep it on screen.
  const preferredLeft = bubbleLeft + launcherWidth - PANEL_WIDTH;
  const left = Math.min(
    Math.max(MARGIN, preferredLeft),
    Math.max(MARGIN, viewport.width - PANEL_WIDTH - MARGIN),
  );

  const above = bubbleTop - PANEL_GAP - panelHeight;
  const below = bubbleTop + BUBBLE_SIZE + PANEL_GAP;
  const top = above >= MARGIN
    ? above
    : Math.min(below, Math.max(MARGIN, viewport.height - panelHeight - MARGIN));

  return { left: Math.round(left), top: Math.round(top) };
}

function readStored(): BubblePosition {
  if (typeof window === "undefined") return defaultBubblePosition;
  try {
    const raw = window.localStorage.getItem(BUBBLE_STORAGE_KEY);
    if (!raw) return defaultBubblePosition;
    const parsed = JSON.parse(raw) as Partial<BubblePosition>;
    if (typeof parsed?.right !== "number" || typeof parsed?.bottom !== "number") return defaultBubblePosition;
    return { right: parsed.right, bottom: parsed.bottom };
  } catch {
    return defaultBubblePosition;
  }
}

export function useChatBubble(onActivate: () => void, launcherWidth = BUBBLE_WIDTH_CLOSED) {
  const [position, setPosition] = useState<BubblePosition>(defaultBubblePosition);
  const [dragging, setDragging] = useState(false);
  const moved = useRef(false);

  useEffect(() => {
    setPosition(clampBubble(readStored(), { width: window.innerWidth, height: window.innerHeight }, launcherWidth));
  }, [launcherWidth]);

  // A window that shrank below the stored corner would otherwise strand the
  // launcher outside the viewport with no way to reach it.
  useEffect(() => {
    const onResize = () => setPosition((current) => clampBubble(current, { width: window.innerWidth, height: window.innerHeight }, launcherWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [launcherWidth]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY };
    const origin = position;
    moved.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);

    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - start.x;
      const dy = move.clientY - start.y;
      if (!moved.current && Math.hypot(dx, dy) > DRAG_THRESHOLD) moved.current = true;
      if (!moved.current) return;
      setPosition(clampBubble(
        { right: origin.right - dx, bottom: origin.bottom - dy },
        { width: window.innerWidth, height: window.innerHeight },
        launcherWidth,
      ));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragging(false);
      if (moved.current) {
        setPosition((current) => {
          try { window.localStorage.setItem(BUBBLE_STORAGE_KEY, JSON.stringify(current)); } catch { /* storage blocked */ }
          return current;
        });
      } else {
        onActivate();
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [launcherWidth, onActivate, position]);

  return { position, dragging, onPointerDown };
}
