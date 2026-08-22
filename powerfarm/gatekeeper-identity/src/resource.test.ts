import { describe, expect, it } from "vitest";
import { POWERFARM_WORKSPACE_RESOURCE, isPowerfarmWorkspaceUrl } from "./resource.js";

describe("Powerfarm Workspace resource", () => {
  it("advertises one stable capability URL without exposing Engine placement", () => {
    expect(POWERFARM_WORKSPACE_RESOURCE).toMatchObject({
      urlPattern: "powerfarm://workspace/*",
      title: "Powerfarm Workspace",
    });
    expect(isPowerfarmWorkspaceUrl("powerfarm://workspace/")).toBe(true);
    expect(isPowerfarmWorkspaceUrl("powerfarm://workspace/runtime")).toBe(true);
    expect(isPowerfarmWorkspaceUrl("https://powerfarm-engine.example")).toBe(false);
    expect(JSON.stringify(POWERFARM_WORKSPACE_RESOURCE)).not.toContain("ENGINE");
  });
});
