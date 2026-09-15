import { describe, expect, it, vi, afterEach } from "vitest";

const original = globalThis.MediaRecorder;
afterEach(() => { (globalThis as Record<string, unknown>).MediaRecorder = original; });

function withSupport(supported: string[]) {
  (globalThis as Record<string, unknown>).MediaRecorder = {
    isTypeSupported: (type: string) => supported.includes(type),
  };
}

describe("video formats", () => {
  it("reports MP4 when the browser can record it", async () => {
    withSupport(["video/webm;codecs=vp9", "video/mp4;codecs=avc1.42E01E"]);
    const { videoFormatSupport } = await import("./export-document");
    expect(videoFormatSupport()).toEqual({ webm: true, mp4: true });
  });

  it("reports MP4 unavailable rather than silently writing WebM into an .mp4", async () => {
    withSupport(["video/webm;codecs=vp8"]);
    const { videoFormatSupport } = await import("./export-document");
    expect(videoFormatSupport()).toEqual({ webm: true, mp4: false });
  });

  it("refuses MP4 with a message naming what does work", async () => {
    withSupport(["video/webm"]);
    const { exportVideo } = await import("./export-document");
    await expect(exportVideo({ nodes: [], edges: [] } as never, "mp4"))
      .rejects.toThrow(/cannot record MP4/i);
  });

  it("says nothing is possible when MediaRecorder is missing", async () => {
    (globalThis as Record<string, unknown>).MediaRecorder = undefined;
    vi.resetModules();
    const { videoFormatSupport } = await import("./export-document");
    expect(videoFormatSupport()).toEqual({ webm: false, mp4: false });
  });
});

describe("raster size", () => {
  const sheet = (width: number, height: number) => ({
    format: "full" as const,
    nodes: [{ id: "a", position: { x: 0, y: 0 }, size: { width, height } }],
    edges: [],
  });

  it("fills the frame a video promises instead of stopping at the diagram's own size", async () => {
    // The source is an SVG, which redraws sharp at any size. Capping the scale
    // at 1 meant a small diagram recorded a small video while the PNG of the
    // same diagram came out at 2x — the whole of why video looked soft.
    const { rasterDimensions } = await import("./export-document");
    const small = rasterDimensions(sheet(400, 300) as never, 1920, true);
    expect(Math.max(small.width, small.height)).toBeGreaterThan(1000);
  });

  it("never blows a small diagram up for a GIF, where every pixel costs bytes", async () => {
    const { rasterDimensions } = await import("./export-document");
    // Same enormous target both ways: without the flag the scale stops at 1:1,
    // with it the frame is filled. That difference is the whole flag.
    const capped = rasterDimensions(sheet(400, 300) as never, 100000);
    const filled = rasterDimensions(sheet(400, 300) as never, 100000, true);
    expect(Math.max(capped.width, capped.height))
      .toBeLessThan(Math.max(filled.width, filled.height));
  });

  it("returns even dimensions, because H.264 encodes in 2x2 blocks", async () => {
    const { rasterDimensions } = await import("./export-document");
    for (const [width, height] of [[401, 301], [999, 777], [1233, 651]]) {
      const size = rasterDimensions(sheet(width, height) as never, 1920, true);
      expect(size.width % 2, `${width}x${height}`).toBe(0);
      expect(size.height % 2, `${width}x${height}`).toBe(0);
    }
  });
});
