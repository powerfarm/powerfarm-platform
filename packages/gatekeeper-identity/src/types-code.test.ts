import { describe, expect, it } from "vitest";
import TYPES_CODE from "./types-code.js";

describe("Workspace LLM Powerfarm capability surface", () => {
  it("exposes a specific hello capability without Engine or credential internals", () => {
    expect(TYPES_CODE).toContain("helloRun");
    expect(TYPES_CODE).toContain("resumeHello");
    expect(TYPES_CODE).not.toContain("invokeGadget");
    expect(TYPES_CODE).not.toMatch(/accessToken|refreshToken|Authorization|ENGINE/);
  });

  it("exposes the one lineage authoring contract without a generic Registry escape hatch", () => {
    expect(TYPES_CODE).toContain("getHelloDraft");
    expect(TYPES_CODE).toContain("applyHelloPatch");
    expect(TYPES_CODE).toContain("publishHello");
    expect(TYPES_CODE).not.toContain("registryRpc");
  });
});
