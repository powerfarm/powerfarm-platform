export interface PlacementRequirements { runtime: string }
export type RuntimeTarget = "cloudflare-adk-js";

export class PlacementResolver {
  resolve(requirements: PlacementRequirements): RuntimeTarget {
    if (requirements.runtime === "adk-js") return "cloudflare-adk-js";
    throw new Error(`Unsupported Powerfarm runtime ${requirements.runtime}`);
  }
}
