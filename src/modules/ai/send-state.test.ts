import { describe, expect, it } from "vitest";
import { sendBlockedReason } from "./ai-assistant";

describe("why send is blocked", () => {
  it("names the missing connection first — the usual cause", () => {
    expect(sendBlockedReason(false, false, "add a retry path")).toBe("Connect an AI gateway first");
  });

  it("reports a request already in flight", () => {
    expect(sendBlockedReason(true, true, "add a retry path")).toBe("The AI is still working on the last request");
  });

  it("asks for something to send", () => {
    expect(sendBlockedReason(true, false, "")).toBe("Type what you want changed");
    expect(sendBlockedReason(true, false, "  a  ")).toBe("Type what you want changed");
  });

  it("returns nothing when the button really is usable", () => {
    expect(sendBlockedReason(true, false, "simplify this")).toBeUndefined();
  });
});
