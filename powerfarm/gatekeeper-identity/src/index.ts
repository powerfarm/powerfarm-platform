import { getBasePath, describeVendor } from "./identity.js";

export * from "./identity.js";

const NONCE_HEX = 32; // 16 bytes

const FECHA = `<!doctype html><meta charset="utf-8">
<title>Entrou</title>
<style>body{font:15px/1.5 system-ui;background:#0d0f12;color:#e7eaee;
display:grid;place-items:center;height:100vh;margin:0}</style>
<p>Identidade confirmada. Pode fechar esta janela.</p>
<script>window.close()</script>`;

const SEM_CONFIG = `<!doctype html><meta charset="utf-8">
<title>Por configurar</title>
<style>body{font:15px/1.5 system-ui;background:#0d0f12;color:#e7eaee;
display:grid;place-items:center;height:100vh;margin:0;text-align:center}</style>
<p>Este gatekeeper ainda nao tem CLIENT_ID.<br>
Regista o cliente em Clientes OAuth e poe o segredo com<br>
<code>wrangler secret put CLIENT_SECRET --name powerfarm-gk-identity</code></p>`;

const LINK_INVALIDO = `<!doctype html><meta charset="utf-8">
<title>Link invalido</title>
<style>body{font:15px/1.5 system-ui;background:#0d0f12;color:#e7eaee;
display:grid;place-items:center;height:100vh;margin:0}</style>
<p>Este link ja foi usado ou expirou. Comeca a ligacao de novo.</p>`;

const html = (corpo: string, status = 200) =>
  new Response(corpo, { status, headers: { "content-type": "text/html; charset=utf-8" } });

export default {
  async fetch(req: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const base = getBasePath(env);
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
      return new Response("Not Found", { status: 404 });
    }
    const partes = url.pathname.slice(base.length).replace(/^\//, "").split("/");

    // /<doId>/<nonce> — o utilizador clicou no link e vai para o emissor.
    if (partes.length === 2 && partes[1].length === NONCE_HEX) {
      if (!env.CLIENT_ID) return html(SEM_CONFIG);

      let conta;
      try {
        conta = ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(partes[0]));
      } catch { return html(LINK_INVALIDO, 400); }

      const inicio = await conta.beginOAuthFlow(partes[1]);
      if (!inicio) return html(LINK_INVALIDO, 400);

      const destino = new URL(`${env.ISSUER}/oauth/authorize`);
      destino.searchParams.set("response_type", "code");
      destino.searchParams.set("client_id", env.CLIENT_ID);
      destino.searchParams.set("redirect_uri", `${new URL(req.url).origin}${base}/oauth`);
      destino.searchParams.set("scope", inicio.scopes);
      destino.searchParams.set("state", `${partes[0]}:${inicio.oauthNonce}`);
      destino.searchParams.set("code_challenge", inicio.challenge);
      destino.searchParams.set("code_challenge_method", "S256");
      return Response.redirect(destino.toString(), 302);
    }

    // /oauth — o emissor devolve o utilizador aqui.
    if (partes.length === 1 && partes[0] === "oauth") {
      if (url.searchParams.get("error")) {
        return html(`<p>O emissor recusou: ${url.searchParams.get("error")}</p>`, 400);
      }
      const state = url.searchParams.get("state") ?? "";
      const corte = state.indexOf(":");
      const code = url.searchParams.get("code");
      if (corte < 0 || !code) return html(LINK_INVALIDO, 400);

      let conta;
      try {
        conta = ctx.exports.UserAccount.get(
          ctx.exports.UserAccount.idFromString(state.slice(0, corte)));
      } catch { return html(LINK_INVALIDO, 400); }

      const ok = await conta.acceptAuthCode(code, state.slice(corte + 1));
      return ok ? html(FECHA) : html(LINK_INVALIDO, 400);
    }

    if (partes.length === 1 && partes[0] === "") {
      return Response.json(describeVendor());
    }
    return new Response("Not Found", { status: 404 });
  },
};
