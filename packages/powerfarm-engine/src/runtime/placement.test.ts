import { describe, expect, it } from "vitest";
import { PlacementResolver } from "./placement.js";

describe("placement", () => {
  it("resolves the only v0.1 target without changing Gadget semantics", () => {
    const resolver = new PlacementResolver();
    expect(resolver.resolve({ runtime: "adk-js" })).toBe("cloudflare-adk-js");
    expect(() => resolver.resolve({ runtime: "python-adk" })).toThrow(/unsupported/i);
  });
});
