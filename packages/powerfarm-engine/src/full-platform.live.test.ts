import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { PowerfarmAuthorityBroker } from "../../gatekeeper-identity/src/powerfarm-authority.js";
import { SupabaseRegistryClient } from "../../gatekeeper-identity/src/registry-client.js";
import type { LlmRequest } from "./adk.js";
import type { EngineEnv } from "./http.js";
import type { CapabilityBindings } from "./runtime/compile-adk.js";
import { createWorkspaceRuntimeService } from "./workspace-runtime.js";

type LiveCredentials = { url: string; publishableKey: string; secretKey: string };

async function credentials(): Promise<LiveCredentials> {
  const path = process.env.POWERFARM_CREDENTIAL_FILE ?? "/Users/ubl-ops/Desktop/.env4";
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).map((line) => line.trim());
  const url = lines.find((line) => /^https:\/\/[a-z]+\.supabase\.co$/.test(line));
  const publishableKey = lines.find((line) => line.startsWith("sb_publishable_"));
  const secretKey = lines.find((line) => line.startsWith("sb_secret_"));
  if (!url || !publishableKey || !secretKey) throw new Error("Authorized live credentials missing");
  return { url, publishableKey, secretKey };
}

function deterministicBindings(): CapabilityBindings {
  return {
    models: {
      model: {
        async *generate(request: LlmRequest) {
          const resumed = request.contents.some((content) => content.parts?.some(
            (part) => "functionResponse" in part
              && part.functionResponse?.name === "adk_request_input",
          ));
          if (!resumed) {
            yield { content: { role: "model", parts: [{ functionCall: {
              id: "full-platform-input", name: "adk_request_input",
              args: { message: "Say hello" },
            } }] } };
          } else {
            yield { content: { role: "model", parts: [{ text: "HELLO" }] }, turnComplete: true };
          }
        },
      },
    },
    codeExecutors: {},
    tools: {},
  };
}

const runLive = process.env.POWERFARM_FULL_LIVE === "1";

describe.runIf(runLive)("Powerfarm full Operate / Change / Sleep loop", () => {
  it("publishes one lineage, invokes its exact grant, discards compute, resumes, and replays", {
    timeout: 60_000,
  }, async () => {
    const keys = await credentials();
    const admin = createClient(keys.url, keys.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const suffix = randomBytes(10).toString("hex");
    const email = `powerfarm-full-${suffix}@test.invalid`;
    const password = `${randomBytes(24).toString("base64url")}Aa1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Could not create live proof caller");
    const callerUser = created.data.user;

    try {
      const identity = await admin.from("identities").select("id").eq("kind", "person")
        .eq("name", "danvoulez").single();
      if (identity.error || typeof identity.data?.id !== "string") {
        throw new Error("Canonical Powerfarm identity missing");
      }
      const linked = await admin.from("identity_links").insert({
        supabase_user: callerUser.id,
        identity_id: identity.data.id,
      });
      if (linked.error) throw new Error("Could not link live proof caller");

      const caller = createClient(keys.url, keys.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const signedIn = await caller.auth.signInWithPassword({ email, password });
      const bearer = signedIn.data.session?.access_token;
      if (signedIn.error || !bearer) throw new Error("Could not obtain delegated caller JWT");

      const engineEnv: EngineEnv = {
        SUPABASE_URL: keys.url,
        SUPABASE_PUBLISHABLE_KEY: keys.publishableKey,
        WORKERS_AI_MODEL: "unused-in-deterministic-proof",
        AI: { run: vi.fn() },
      };
      const freshEngine = () => createWorkspaceRuntimeService({
        bindingsFactory: () => deterministicBindings(),
      });
      const engineBinding = {
        validateGadget: (source: string) => freshEngine().validateGadget(source),
        invokeGadget: (envelope: unknown, token: string) =>
          freshEngine().invokeGadget(envelope, token, engineEnv),
        resumeRun: (envelope: unknown, token: string) =>
          freshEngine().resumeRun(envelope, token, engineEnv),
      };
      const registry = new SupabaseRegistryClient(keys.url, keys.publishableKey, bearer);
      const broker = new PowerfarmAuthorityBroker(registry, engineBinding);

      const draft = await broker.getHelloDraft() as {
        draft_revision: number;
        authored_state: { files: { "gadget.yaml": string } };
      };
      const source = draft.authored_state.files["gadget.yaml"].replaceAll("0.1.0", "0.1.1");
      const changed = source === draft.authored_state.files["gadget.yaml"]
        ? draft
        : await broker.applyHelloPatch(draft.draft_revision, {
          version: "0.1.1", files: { "gadget.yaml": source },
        }, `full-edit-${suffix}`) as { draft_revision: number };
      const visible = await broker.getHelloDraft() as {
        draft_revision: number;
        authored_state: { files: { "gadget.yaml": string } };
      };
      expect(visible.authored_state.files["gadget.yaml"]).toBe(source);

      const published = await broker.publishHello(changed.draft_revision) as {
        revision: number; content_hash: string; definition_hash: string;
      };
      const idempotencyKey = `full-run-${suffix}`;
      const waiting = await broker.helloRun(
        { task: "hello" }, idempotencyKey, bearer,
      ) as { runId: string; status: string; provenance: Record<string, unknown> };
      expect(waiting.status).toBe("waiting_input");
      expect(waiting.provenance).toMatchObject({
        gadgetRevision: published.revision,
        gadgetRevisionHash: published.content_hash,
        definitionHash: published.definition_hash,
      });

      // Every call above constructed a new service/runtime. Only Supabase survives.
      const resumedBroker = new PowerfarmAuthorityBroker(
        new SupabaseRegistryClient(keys.url, keys.publishableKey, bearer), engineBinding,
      );
      const completed = await resumedBroker.resumeHello(
        waiting.runId, "hello", `full-resume-${suffix}`, bearer,
      ) as { runId: string; status: string; result: { text: string }; provenance: unknown };
      expect(completed).toMatchObject({
        runId: waiting.runId, status: "completed", result: { text: "HELLO" },
      });
      expect(completed.provenance).toEqual(waiting.provenance);

      const replayed = await resumedBroker.helloRun(
        { task: "hello" }, idempotencyKey, bearer,
      ) as { runId: string; status: string; result: { text: string } };
      expect(replayed).toMatchObject({
        runId: waiting.runId, status: "completed", result: { text: "HELLO" },
      });
      const serialized = JSON.stringify({ waiting, completed, replayed });
      expect(serialized).not.toContain(bearer);
      expect(serialized).not.toContain(keys.secretKey);
    } finally {
      await admin.auth.admin.deleteUser(callerUser.id);
    }
  });
});
