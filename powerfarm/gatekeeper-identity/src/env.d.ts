declare namespace Cloudflare {
  interface Env {
    ISSUER: string;
    CLIENT_ID?: string;
    CLIENT_SECRET?: string;
    BASE_URL?: string;
    SUPABASE_URL: string;
    SUPABASE_PUBLISHABLE_KEY: string;
    ENGINE: {
      validateGadget(source: string): Promise<unknown>;
      invokeGadget(envelope: unknown, delegatedBearer: string): Promise<unknown>;
      resumeRun(envelope: unknown, delegatedBearer: string): Promise<unknown>;
    };
  }
  interface GlobalProps {
    mainModule: typeof import("./index.js");
    durableNamespaces: "UserAccount" | "PowerfarmGatekeeper";
  }
}
