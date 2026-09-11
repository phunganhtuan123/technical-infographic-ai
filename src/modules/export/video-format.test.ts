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
