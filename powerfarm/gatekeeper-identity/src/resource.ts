import type { SupportedResource } from "@gadgets/workshop-shared/gatekeeper";

export const POWERFARM_WORKSPACE_RESOURCE: SupportedResource = Object.freeze({
  urlPattern: "powerfarm://workspace/*",
  title: "Powerfarm Workspace",
  description: "Typed Gadget authoring and execution capabilities for the signed-in Powerfarm workspace.",
});

export function isPowerfarmWorkspaceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "powerfarm:" && url.hostname === "workspace";
  } catch {
    return false;
  }
}
