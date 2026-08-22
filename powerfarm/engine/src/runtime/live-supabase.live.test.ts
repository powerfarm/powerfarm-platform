import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { LlmRequest } from "../adk.js";
import type { CapabilityBindings } from "./compile-adk.js";
import { EffectStore } from "./effect-store.js";
import { PowerfarmInvocationRuntime } from "./invocation.js";
import { SupabaseSessionService } from "./session-service.js";
import { createPowerfarmDatabase } from "./supabase.js";

interface LocalCredentials {
  url: string;
  publishableKey: string;
  secretKey: string;
}

async function credentials(): Promise<LocalCredentials> {
  const path = process.env.POWERFARM_CREDENTIAL_FILE ?? "/Users/ubl-ops/Desktop/.env4";
  const lines = (await readFile(path, "utf8")).split(/\r?\n/).map((line) => line.trim());
  const url = lines.find((line) => /^https:\/\/[a-z]+\.supabase\.co$/.test(line));
  const publishableKey = lines.find((line) => line.startsWith("sb_publishable_"));
  const secretKey = lines.find((line) => line.startsWith("sb_secret_"));
  if (!url || !publishableKey || !secretKey) {
    throw new Error("Authorized credential file lacks Supabase URL/publishable/secret keys");
  }
  return { url, publishableKey, secretKey };
}

function liveBindings(): CapabilityBindings {
  return {
    models: {
      model: {
        async *generate(request: LlmRequest) {
          const resumed = request.contents.some((content) => content.parts?.some(
            (part) => "functionResponse" in part && part.functionResponse?.name === "adk_request_input",
          ));
          if (!resumed) {
            yield { content: { role: "model", parts: [{ functionCall: {
              id: "live-input-call", name: "adk_request_input",
              args: { message: "Confirm durable resume" },
            } }] } };
          } else {
            yield { content: { role: "model", parts: [{ text: "live resume complete" }] }, turnComplete: true };
          }
        },
      },
    },
    codeExecutors: {},
    tools: {},
  };
}

const runLive = process.env.POWERFARM_LIVE_SUPABASE === "1";

describe.runIf(runLive)("live Supabase durable truth", () => {
  it("persists, loses compute, resumes, and replays one effect", { timeout: 45_000 }, async () => {
    const keys = await credentials();
    const admin = createClient(keys.url, keys.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const suffix = randomBytes(12).toString("hex");
    const email = `powerfarm-engine-${suffix}@test.invalid`;
    const password = `${randomBytes(24).toString("base64url")}Aa1!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Could not create temporary live-test caller");
    const temporaryUser = created.data.user;

    try {
      const identity = await admin.from("identities").select("id").eq("kind", "person")
        .eq("name", "danvoulez").single();
      if (identity.error || typeof identity.data?.id !== "string") throw new Error("Canonical identity missing");
      const linked = await admin.from("identity_links").insert({
        supabase_user: temporaryUser.id,
        identity_id: identity.data.id,
      });
      if (linked.error) throw new Error("Could not link temporary caller to Powerfarm identity");

      const caller = createClient(keys.url, keys.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const signedIn = await caller.auth.signInWithPassword({ email, password });
      const bearer = signedIn.data.session?.access_token;
      if (signedIn.error || !bearer) throw new Error("Could not obtain temporary caller JWT");

      const gadgetSource = await readFile(
        new URL("../../../../examples/gadgets/hello-agentic/gadget.yaml", import.meta.url), "utf8",
      );
      const idempotencyKey = `live-${suffix}`;
      const database1 = await createPowerfarmDatabase({
        url: keys.url, publishableKey: keys.publishableKey, callerBearer: bearer,
      });
      const first = await new PowerfarmInvocationRuntime(database1, gadgetSource, liveBindings()).invoke({
        userId: temporaryUser.id, input: "start", idempotencyKey,
      });
      expect(first.status).toBe("waiting_input");

      // New clients, services, agents, and Runner: no authoritative process state survives.
      const database2 = await createPowerfarmDatabase({
        url: keys.url, publishableKey: keys.publishableKey, callerBearer: bearer,
      });
      const completed = await new PowerfarmInvocationRuntime(database2, gadgetSource, liveBindings()).resume({
        userId: temporaryUser.id, runId: first.runId, input: "confirmed",
      });
      expect(completed).toMatchObject({ status: "completed", result: { text: "live resume complete" } });

      const externalEffect = vi.fn(async () => ({ receipt: `receipt-${suffix}` }));
      const effectInput = {
        runId: first.runId,
        gadgetId: "hello-agentic",
        capabilityId: "live-proof",
        idempotencyKey: `effect-${suffix}`,
        request: { value: 1 },
      };
      const firstEffect = await new EffectStore(database2).perform(effectInput, externalEffect);
      const database3 = await createPowerfarmDatabase({
        url: keys.url, publishableKey: keys.publishableKey, callerBearer: bearer,
      });
      const replayed = await new EffectStore(database3).perform(effectInput, externalEffect);
      expect(replayed).toEqual(firstEffect);
      expect(externalEffect).toHaveBeenCalledOnce();

      const session = await new SupabaseSessionService(database3, {
        gadgetId: "hello-agentic",
        gadgetVersion: "0.1.0",
        definitionHash: completed.provenance.definitionHash,
      }).getSession({
        appName: "hello-agentic", userId: temporaryUser.id, sessionId: completed.sessionId,
      });
      const durableJson = JSON.stringify({ completed, session });
      expect(durableJson).not.toContain(bearer);
      expect(durableJson).not.toContain(keys.secretKey);
      expect(durableJson).not.toContain(keys.publishableKey);
    } finally {
      // Exact target created above; deleting it cascades only its temporary link.
      await admin.auth.admin.deleteUser(temporaryUser.id);
    }
  });
});
