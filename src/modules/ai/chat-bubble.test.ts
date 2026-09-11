import { describe, expect, it } from "vitest";
import { BUBBLE_SIZE, BUBBLE_WIDTH_CLOSED, BUBBLE_WIDTH_OPEN, bubbleWidth, clampBubble, defaultBubblePosition, panelPlacement } from "./chat-bubble";

const viewport = { width: 1600, height: 900 };

describe("chat launcher position", () => {
  it("starts in the bottom-right corner", () => {
    expect(defaultBubblePosition).toEqual({ right: 20, bottom: 20 });
  });

  it("keeps the launcher inside the viewport when dragged past an edge", () => {
    expect(clampBubble({ right: -400, bottom: -400 }, viewport)).toEqual({ right: 20, bottom: 20 });
    const far = clampBubble({ right: 9000, bottom: 9000 }, viewport);
    expect(far.right).toBe(viewport.width - BUBBLE_WIDTH_CLOSED - 20);
    expect(far.bottom).toBe(viewport.height - BUBBLE_SIZE - 20);
  });

  it("survives a window that shrank below the stored corner", () => {
    const stored = { right: 1200, bottom: 700 };
    const small = clampBubble(stored, { width: 800, height: 600 });
    expect(small.right).toBeLessThanOrEqual(800 - BUBBLE_WIDTH_CLOSED - 20);
    expect(small.bottom).toBeLessThanOrEqual(600 - BUBBLE_SIZE - 20);
  });

  it("opens the panel above the launcher when there is room", () => {
    const place = panelPlacement({ right: 20, bottom: 20 }, viewport, 500);
    const bubbleTop = viewport.height - 20 - BUBBLE_SIZE;
    expect(place.top).toBe(bubbleTop - 12 - 500);
    expect(place.top).toBeGreaterThanOrEqual(20);
  });

  it("opens below when the launcher sits near the top", () => {
    const nearTop = { right: 20, bottom: viewport.height - BUBBLE_SIZE - 20 };
    const place = panelPlacement(nearTop, viewport, 400);
    expect(place.top).toBeGreaterThan(20);
  });

  it("never lets the panel run off either side", () => {
    for (const right of [20, 400, 900, viewport.width - BUBBLE_SIZE - 20]) {
      const place = panelPlacement({ right, bottom: 20 }, viewport, 400);
      expect(place.left).toBeGreaterThanOrEqual(20);
      expect(place.left + 372).toBeLessThanOrEqual(viewport.width - 20 + 1);
    }
  });

  it("keeps a tall panel on screen in a short window", () => {
    const place = panelPlacement({ right: 20, bottom: 20 }, { width: 1200, height: 500 }, 460);
    expect(place.top).toBeGreaterThanOrEqual(20);
  });
});

describe("launcher width", () => {
  it("is a labelled pill when closed and a round button when open", () => {
    expect(bubbleWidth(false)).toBe(BUBBLE_WIDTH_CLOSED);
    expect(bubbleWidth(true)).toBe(BUBBLE_WIDTH_OPEN);
    expect(BUBBLE_WIDTH_OPEN).toBe(BUBBLE_SIZE);
  });

  it("keeps the wider pill fully on screen", () => {
    const at = clampBubble({ right: 9999, bottom: 20 }, viewport, BUBBLE_WIDTH_CLOSED);
    expect(at.right + BUBBLE_WIDTH_CLOSED).toBeLessThanOrEqual(viewport.width - 20);
  });

  it("anchors the panel to whichever width the launcher currently has", () => {
    const closed = panelPlacement({ right: 20, bottom: 20 }, viewport, 400, BUBBLE_WIDTH_CLOSED);
    const open = panelPlacement({ right: 20, bottom: 20 }, viewport, 400, BUBBLE_WIDTH_OPEN);
    // Both align to the launcher's right edge, which is the same corner.
    expect(closed.left).toBe(open.left);
    expect(closed.left).toBeGreaterThanOrEqual(20);
  });
});
