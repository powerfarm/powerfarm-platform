import { DurableObject, RpcStub, RpcTarget, WorkerEntrypoint } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import type {
  AccountDescription,
  ActionDescription,
  ActionKind,
  ApprovalQueue,
  ResourceConfiguratorFrame,
  ResourceDescription,
  Gatekeeper,
  GatekeeperConnectCallback,
  GatekeeperConnectOptions,
  GatekeeperUser,
  GatekeeperUserVerifier,
  GatekeeperVendor as GatekeeperVendorIface,
  SupportedResource,
  VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import TYPES_CODE from "./types-code.js";
import { refreshOAuthTokens } from "./oauth-refresh.js";
import { PowerfarmAuthorityBroker } from "./powerfarm-authority.js";
import { SupabaseRegistryClient } from "./registry-client.js";
import { isPowerfarmWorkspaceUrl, POWERFARM_WORKSPACE_RESOURCE } from "./resource.js";

// Este Worker preserva duas fronteiras: o emissor OAuth prova quem e a pessoa;
// o Gatekeeper oferece somente as capacidades Powerfarm tipadas dessa pessoa.
// O token delegado nunca atravessa para o Gadget ou para a Workspace LLM.
//
// Porque o email e o que importa aqui: o Workshop indexa contas por email, e o
// proprio upstream avisa que um email nao verificado permitiria tomada de conta.
// Por isso so devolvemos email quando o emissor diz email_verified.

const ICON = {
  url: "data:image/svg+xml," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='none' " +
    "stroke='currentColor' stroke-width='18'><circle cx='128' cy='96' r='44'/>" +
    "<path d='M40 216c0-44 40-72 88-72s88 28 88 72'/></svg>"),
};

const NONCE_BYTES = 16;
const SCOPES_AUTH = "openid email";
const SCOPES_FULL = "openid email profile";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function generateNonce(): string {
  return hex(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}
function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

/** Sem BASE_URL o redirect_uri apontaria para localhost e o emissor recusaria. */
function getBaseUrl(env: Cloudflare.Env): string {
  return (env.BASE_URL ?? "http://localhost:8787/gatekeeper/identity").replace(/\/+$/, "");
}
export function getBasePath(env: Cloudflare.Env): string {
  return new URL(getBaseUrl(env)).pathname.replace(/\/+$/, "");
}

export function describeVendor(): VendorDescription {
  return {
    displayName: "PowerFarm Identity",
    url: "https://powerfarm-registry.vercel.app",
    logo: ICON,
    color: "#e8eeff",
    tagline: "Entrar com a identidade da PowerFarm",
    description:
      "Autenticacao contra o emissor OAuth 2.1 da PowerFarm. O cargo e duravel e " +
      "assina; o modelo que o ocupa e detalhe de execucao.",
    providesAuth: true,
  };
}

type Estado = {
  initiationNonce?: string;
  oauthNonce?: string;
  pkceVerifier?: string;
  scopes?: string;
  authOnly?: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  email?: string;
};

export interface PowerfarmRunResult {
  runId: string;
  sessionId: string;
  status: "waiting_input" | "completed";
  pendingInput?: unknown;
  result?: unknown;
  provenance: unknown;
}

export interface PowerfarmSession {
  getHelloDraft(): Promise<unknown>;
  applyHelloPatch(baseRevision: number, patch: Record<string, unknown>, clientOperationId: string): Promise<void>;
  publishHello(baseRevision: number): Promise<void>;
  helloRun(input: unknown, idempotencyKey: string): Promise<PowerfarmRunResult>;
  resumeHello(runId: string, input: unknown, idempotencyKey: string): Promise<PowerfarmRunResult>;
}

function runResult(value: unknown): PowerfarmRunResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Powerfarm runtime returned an invalid result");
  }
  const result = value as Record<string, unknown>;
  if (typeof result.runId !== "string" || typeof result.sessionId !== "string"
    || (result.status !== "waiting_input" && result.status !== "completed")
    || result.provenance === undefined) {
    throw new Error("Powerfarm runtime returned an invalid result");
  }
  return result as unknown as PowerfarmRunResult;
}

export class UserAccount extends DurableObject<Cloudflare.Env> {
  #ler(): Estado {
    return (this.ctx.storage.get("estado") as unknown as Estado) ?? {};
  }

  async setCallback(callback: Fetcher<GatekeeperConnectCallback>,
                    initiationNonce: string, scopes: string, authOnly: boolean): Promise<void> {
    await this.ctx.storage.put("callback", callback);
    await this.ctx.storage.put("estado", { initiationNonce, scopes, authOnly } satisfies Estado);
  }

  /**
   * O link so serve uma vez. Consumir o nonce aqui e o que impede replay: um
   * link reenviado nao reabre o fluxo.
   */
  async beginOAuthFlow(initiationNonce: string): Promise<{ oauthNonce: string;
      challenge: string; scopes: string } | null> {
    const e = await this.ctx.storage.get<Estado>("estado");
    if (!e?.initiationNonce || e.initiationNonce !== initiationNonce) return null;

    const oauthNonce = generateNonce();
    const pkceVerifier = generateNonce() + generateNonce();
    const challenge = await pkceChallenge(pkceVerifier);

    await this.ctx.storage.put("estado", {
      ...e, initiationNonce: undefined, oauthNonce, pkceVerifier,
    } satisfies Estado);
    return { oauthNonce, challenge, scopes: e.scopes ?? SCOPES_AUTH };
  }

  async acceptAuthCode(code: string, oauthNonce: string): Promise<boolean> {
    const e = await this.ctx.storage.get<Estado>("estado");
    if (!e?.oauthNonce || e.oauthNonce !== oauthNonce || !e.pkceVerifier) return false;

    const corpo = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${getBaseUrl(this.env)}/oauth`,
      client_id: this.env.CLIENT_ID ?? "",
      code_verifier: e.pkceVerifier,
    });
    const cabecalhos: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
    };
    if (this.env.CLIENT_SECRET) {
      cabecalhos.authorization = "Basic " +
        btoa(`${this.env.CLIENT_ID}:${this.env.CLIENT_SECRET}`);
    }

    const res = await fetch(`${this.env.ISSUER}/oauth/token`, {
      method: "POST", headers: cabecalhos, body: corpo,
    });
    if (!res.ok) return false;
    const tok = await res.json<{
      access_token?: string; refresh_token?: string; expires_in?: number;
    }>();
    if (!tok.access_token) return false;

    const email = await this.#emailVerificado(tok.access_token);

    await this.ctx.storage.put("estado", {
      ...e, oauthNonce: undefined, pkceVerifier: undefined,
      accessToken: tok.access_token, refreshToken: tok.refresh_token,
      expiresAt: new Date(Date.now() + (tok.expires_in ?? 3600) * 1_000).toISOString(),
      email: email ?? undefined,
    } satisfies Estado);

    const callback = await this.ctx.storage.get<Fetcher<GatekeeperConnectCallback>>("callback");
    if (callback) await callback.complete(this.ctx.exports.GatekeeperUserImpl({
      props: { userObjectId: this.ctx.id.toString() },
    }));
    return true;
  }

  /**
   * O emissor e quem diz se o email esta verificado. Nao inferimos, nao
   * confiamos no que o utilizador escreveu: sem email_verified, devolve null.
   */
  async #emailVerificado(accessToken: string): Promise<string | null> {
    const res = await fetch(`${this.env.ISSUER}/oauth/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const info = await res.json<{ email?: string; email_verified?: boolean }>();
    if (!info.email || info.email_verified !== true) return null;
    return info.email;
  }

  async getEmail(): Promise<string | null> {
    return (await this.ctx.storage.get<Estado>("estado"))?.email ?? null;
  }

  async #freshAccessToken(): Promise<string> {
    const state = await this.ctx.storage.get<Estado>("estado");
    if (!state?.accessToken) throw new Error("Powerfarm reauthentication required");
    if (state.expiresAt !== undefined && Date.parse(state.expiresAt) > Date.now() + 60_000) {
      return state.accessToken;
    }
    if (!state.refreshToken || !this.env.CLIENT_ID) {
      throw new Error("Powerfarm reauthentication required");
    }
    try {
      const refreshed = await refreshOAuthTokens({
        issuer: this.env.ISSUER,
        clientId: this.env.CLIENT_ID,
        clientSecret: this.env.CLIENT_SECRET,
        refreshToken: state.refreshToken,
      });
      await this.ctx.storage.put("estado", {
        ...state,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      } satisfies Estado);
      return refreshed.accessToken;
    } catch {
      const callback = await this.ctx.storage.get<Fetcher<GatekeeperConnectCallback>>("callback");
      await callback?.credentialsExpired();
      throw new Error("Powerfarm reauthentication required");
    }
  }

  async helloRun(input: unknown, idempotencyKey: string): Promise<PowerfarmRunResult> {
    const bearer = await this.#freshAccessToken();
    const registry = new SupabaseRegistryClient(
      this.env.SUPABASE_URL, this.env.SUPABASE_PUBLISHABLE_KEY, bearer,
    );
    return runResult(await new PowerfarmAuthorityBroker(registry, this.env.ENGINE)
      .helloRun(input, idempotencyKey, bearer));
  }

  async getHelloDraft(): Promise<unknown> {
    const bearer = await this.#freshAccessToken();
    const registry = new SupabaseRegistryClient(
      this.env.SUPABASE_URL, this.env.SUPABASE_PUBLISHABLE_KEY, bearer,
    );
    return new PowerfarmAuthorityBroker(registry, this.env.ENGINE).getHelloDraft();
  }

  async applyHelloPatch(
    baseRevision: number,
    patch: Record<string, unknown>,
    clientOperationId: string,
  ): Promise<unknown> {
    const bearer = await this.#freshAccessToken();
    const registry = new SupabaseRegistryClient(
      this.env.SUPABASE_URL, this.env.SUPABASE_PUBLISHABLE_KEY, bearer,
    );
    return new PowerfarmAuthorityBroker(registry, this.env.ENGINE)
      .applyHelloPatch(baseRevision, patch, clientOperationId);
  }

  async publishHello(baseRevision: number): Promise<unknown> {
    const bearer = await this.#freshAccessToken();
    const registry = new SupabaseRegistryClient(
      this.env.SUPABASE_URL, this.env.SUPABASE_PUBLISHABLE_KEY, bearer,
    );
    return new PowerfarmAuthorityBroker(registry, this.env.ENGINE).publishHello(baseRevision);
  }

  async resumeHello(
    runId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<PowerfarmRunResult> {
    const bearer = await this.#freshAccessToken();
    const registry = new SupabaseRegistryClient(
      this.env.SUPABASE_URL, this.env.SUPABASE_PUBLISHABLE_KEY, bearer,
    );
    return runResult(await new PowerfarmAuthorityBroker(registry, this.env.ENGINE)
      .resumeHello(runId, input, idempotencyKey, bearer));
  }

  async revoke(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  async restart(initiationNonce: string): Promise<void> {
    const e = await this.ctx.storage.get<Estado>("estado");
    await this.ctx.storage.put("estado", { ...e, initiationNonce } satisfies Estado);
  }
}

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Cloudflare.Env>
    implements GatekeeperVendorIface {
  async describe(): Promise<VendorDescription> { return describeVendor(); }

  async connectAccount(callback: Fetcher<GatekeeperConnectCallback>,
                       options?: GatekeeperConnectOptions): Promise<{ url: string }> {
    const id = this.ctx.exports.UserAccount.newUniqueId();
    const initiationNonce = generateNonce();
    const authOnly = options?.scopes === "auth";
    await this.ctx.exports.UserAccount.get(id)
      .setCallback(callback, initiationNonce, authOnly ? SCOPES_AUTH : SCOPES_FULL, authOnly);
    return { url: `${getBaseUrl(this.env)}/${id.toString()}/${initiationNonce}` };
  }

  async newUser(): Promise<Fetcher<GatekeeperUser>> {
    const id = this.ctx.exports.UserAccount.newUniqueId();
    return this.ctx.exports.GatekeeperUserImpl({ props: { userObjectId: id.toString() } });
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return [POWERFARM_WORKSPACE_RESOURCE];
  }
  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }
}

@validateRpc()
export class GatekeeperUserImpl
    extends WorkerEntrypoint<Cloudflare.Env, { userObjectId: string }>
    implements GatekeeperUser {
  #conta() {
    const id = this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId);
    return this.ctx.exports.UserAccount.get(id);
  }

  async describe(): Promise<AccountDescription> {
    const email = await this.#conta().getEmail();
    return {
      displayName: email ?? "PowerFarm Identity",
      avatar: ICON,
      singleton: { tsType: "PowerfarmSession" },
    };
  }

  // Contrato: nunca lanca. Qualquer falha e "nao ha email".
  async getAuthenticatedEmail(): Promise<string | null> {
    try { return await this.#conta().getEmail(); } catch { return null; }
  }

  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.IdentityVerifier({
      props: { userObjectId: this.ctx.props.userObjectId },
    });
  }

  async getSingletonGatekeeperClass(): Promise<DurableObjectClass<Gatekeeper<PowerfarmSession>>> {
    return this.ctx.exports.PowerfarmGatekeeper({
      props: { userObjectId: this.ctx.props.userObjectId },
    });
  }

  async reconnect(): Promise<{ url: string }> {
    const initiationNonce = generateNonce();
    await this.#conta().restart(initiationNonce);
    return {
      url: `${getBaseUrl(this.env)}/${this.ctx.props.userObjectId}/${initiationNonce}`,
    };
  }

  async revoke(): Promise<void> { await this.#conta().revoke(); }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return [POWERFARM_WORKSPACE_RESOURCE];
  }

  async getGatekeeperClassFor(url: string): Promise<{
    class: DurableObjectClass<Gatekeeper<any>>; resource: SupportedResource;
  }> {
    if (!isPowerfarmWorkspaceUrl(url)) {
      throw new Error(`Unsupported Powerfarm resource (${url}).`);
    }
    return {
      class: this.ctx.exports.PowerfarmGatekeeper({
        props: { userObjectId: this.ctx.props.userObjectId },
      }),
      resource: POWERFARM_WORKSPACE_RESOURCE,
    };
  }

  // Sem recursos endereçaveis, nao ha formulario de configuracao para servir.
  startResourceConfigurator(_resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    throw new Error("PowerFarm Identity nao tem recursos endereçaveis por URL.");
  }

  async ensureResources(resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    if (resourceUrlPatterns.some((pattern) => pattern !== POWERFARM_WORKSPACE_RESOURCE.urlPattern)) {
      throw new Error("Unsupported Powerfarm resource grant");
    }
    return {};
  }
}

@validateRpc()
export class IdentityVerifier
    extends WorkerEntrypoint<Cloudflare.Env, { userObjectId: string }>
    implements GatekeeperUserVerifier {}

@validateRpc()
class PowerfarmSessionImpl extends RpcTarget implements PowerfarmSession {
  constructor(
    private readonly account: DurableObjectStub<UserAccount>,
    private readonly approvalQueue: RpcStub<ApprovalQueue>,
    private readonly stageAction: (
      action: PendingPowerfarmAction,
      description: ActionDescription,
      approvalQueue: RpcStub<ApprovalQueue>,
    ) => Promise<void>,
  ) { super(); }

  async getHelloDraft(): Promise<unknown> {
    await this.approvalQueue.authorizeObservation({
      title: "Read hello-agentic draft",
      description: "Read the current mutable hello-agentic draft from the Powerfarm Registry.",
    });
    return this.account.getHelloDraft();
  }

  async applyHelloPatch(
    baseRevision: number,
    patch: Record<string, unknown>,
    clientOperationId: string,
  ): Promise<void> {
    await this.stageAction(
      { kind: "apply_patch", baseRevision, patch, clientOperationId },
      {
        title: "Edit hello-agentic draft",
        description: `Apply an optimistic edit to hello-agentic draft revision ${baseRevision}.`,
        implementsRevert: false,
        awaitDecision: true,
        actionKind: { tag: "powerfarm.gadget.edit", label: "Edit Powerfarm Gadget draft" },
      },
      this.approvalQueue,
    );
  }

  async publishHello(baseRevision: number): Promise<void> {
    await this.stageAction(
      { kind: "publish", baseRevision },
      {
        title: "Publish hello-agentic",
        description: `Validate and publish hello-agentic draft revision ${baseRevision} as an immutable revision.`,
        implementsRevert: false,
        awaitDecision: true,
        actionKind: { tag: "powerfarm.gadget.publish", label: "Publish Powerfarm Gadget" },
      },
      this.approvalQueue,
    );
  }

  async helloRun(input: unknown, idempotencyKey: string): Promise<PowerfarmRunResult> {
    await this.approvalQueue.authorizeObservation({
      title: "Run hello.run",
      description: "Use the installed hello.run capability under the current Powerfarm authority.",
    });
    return this.account.helloRun(input, idempotencyKey);
  }

  async resumeHello(
    runId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<PowerfarmRunResult> {
    await this.approvalQueue.authorizeObservation({
      title: "Resume hello.run",
      description: "Resume the named waiting run under its existing Powerfarm RunGrant.",
    });
    return this.account.resumeHello(runId, input, idempotencyKey);
  }

  [Symbol.dispose](): void { this.approvalQueue[Symbol.dispose](); }
}

type PendingPowerfarmAction =
  | { kind: "apply_patch"; baseRevision: number; patch: Record<string, unknown>; clientOperationId: string }
  | { kind: "publish"; baseRevision: number };

@validateRpc()
export class PowerfarmGatekeeper
    extends DurableObject<Cloudflare.Env, { userObjectId: string }>
    implements Gatekeeper<PowerfarmSession> {
  #account(): DurableObjectStub<UserAccount> {
    return this.ctx.exports.UserAccount.get(
      this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId),
    );
  }

  async describe(): Promise<ResourceDescription> {
    return {
      url: "powerfarm://workspace",
      title: "Powerfarm Workspace",
      snippet: "Installed, typed Powerfarm capabilities under the signed-in identity.",
      suggestedBindingName: "POWERFARM",
      tsType: "PowerfarmSession",
    };
  }

  async getTypeScriptTypes(): Promise<string> { return TYPES_CODE; }
  async getAutoApprovableActions(): Promise<ActionKind[]> { return []; }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<PowerfarmSession> {
    return new PowerfarmSessionImpl(
      this.#account(),
      approvalQueue.dup(),
      (action, description, queue) => this.#stageAction(action, description, queue),
    );
  }

  async #stageAction(
    action: PendingPowerfarmAction,
    description: ActionDescription,
    approvalQueue: RpcStub<ApprovalQueue>,
  ): Promise<void> {
    const next = this.ctx.storage.kv.get<number>("powerfarm:next-action") ?? 1;
    this.ctx.storage.kv.put("powerfarm:next-action", next + 1);
    this.ctx.storage.kv.put(`powerfarm:action:${next}`, action);
    try {
      await approvalQueue.submitAction(next, description);
    } catch (error) {
      this.ctx.storage.kv.delete(`powerfarm:action:${next}`);
      throw error;
    }
  }

  async addObserver(_id: string, _user: Fetcher<GatekeeperUserVerifier>): Promise<void> {}
  async removeObserver(_id: string): Promise<void> {}
  async applyAction(action: number): Promise<void> {
    const key = `powerfarm:action:${action}`;
    const pending = this.ctx.storage.kv.get<PendingPowerfarmAction>(key);
    if (pending === undefined) throw new Error(`Powerfarm runtime has no queued action ${action}.`);
    const account = this.#account();
    if (pending.kind === "apply_patch") {
      await account.applyHelloPatch(
        pending.baseRevision, pending.patch, pending.clientOperationId,
      );
    } else {
      await account.publishHello(pending.baseRevision);
    }
    this.ctx.storage.kv.delete(key);
  }
  async rejectAction(action: number): Promise<void> {
    this.ctx.storage.kv.delete(`powerfarm:action:${action}`);
  }
  async revertAction(action: number): Promise<void> {
    throw new Error(`Powerfarm runtime action ${action} cannot be reverted here.`);
  }
}
