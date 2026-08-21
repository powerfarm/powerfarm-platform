#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDeployment } from "../lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config = await readDeployment(root);
const erros = [];
const exigir = (condicao, mensagem) => { if (!condicao) erros.push(mensagem); };

// Esta instância usa deliberadamente o login por senha do upstream.
// O wrapper atual não implementa Access mode; uma mudança de auth exige código,
// não apenas editar deployment.jsonc.
exigir(config.auth?.mode === "password",
  "auth.mode deve ser 'password' enquanto deploy-powerfarm.mjs implementar esse modo");

const requiredWorkers = [
  "workshop", "router", "context", "scheduler", "customGatekeeper", "identity",
  "errorReporter", "engine",
];
for (const key of requiredWorkers) {
  exigir(typeof config.workers?.[key]?.name === "string" && config.workers[key].name.length > 0,
    `workers.${key}.name é obrigatório`);
}

const names = requiredWorkers.map((key) => config.workers?.[key]?.name).filter(Boolean);
exigir(new Set(names).size === names.length, "Worker service identities devem ser únicas");
exigir(config.workers?.router?.name !== config.workers?.workshop?.name,
  "router público e workshop backend devem ser Workers distintos");

const route = config.workers?.router?.route;
exigir(route && Boolean(route.customDomain) !== Boolean(route.workersDev),
  "router deve ter exatamente uma rota: customDomain ou workersDev");
exigir(config.workers?.workshop?.route === undefined,
  "workshop backend deve permanecer interno; a rota pública pertence ao router");
exigir(config.workers?.engine?.route?.workersDev === false,
  "pf.engine v0.1 deve permanecer privado, sem endpoint workers.dev");
exigir(config.agenticRuntime?.supabaseUrl === "https://wmsrqefgdgcijupeogfa.supabase.co",
  "pf.engine deve apontar ao Supabase canônico declarado no repo");
exigir(config.agenticRuntime?.supabasePublishableKeySecret === "SUPABASE_PUBLISHABLE_KEY",
  "pf.engine deve declarar a chave publicável como secret, nunca como var");
exigir(typeof config.agenticRuntime?.workersAiModel === "string"
  && config.agenticRuntime.workersAiModel.startsWith("@cf/"),
  "pf.engine deve declarar um modelo Workers AI explícito");

// Scheduler é parte do contrato de espera/retomada. Não pode sumir por limpeza.
exigir(Boolean(config.workers?.scheduler?.name),
  "scheduler deve permanecer configurado");

// LAB é a execução primária, mas a capacidade Cloudflare deve permanecer como
// fallback automático. Aqui validamos a parte do fallback que já existe hoje.
exigir(config.aiGateway?.enabled === true,
  "fallback de modelo Cloudflare deve permanecer habilitado");
exigir(Array.isArray(config.aiGateway?.providers) && config.aiGateway.providers.includes("cloudflare"),
  "aiGateway.providers deve incluir 'cloudflare' para o fallback Workers AI");
exigir(["direct", "gateway"].includes(config.aiGateway?.workersAi?.mode),
  "Workers AI fallback deve usar modo 'direct' ou 'gateway'");
exigir(config.aiGateway?.accountId === config.accountId,
  "Workers AI fallback deve usar a mesma conta desta implantação");

exigir(config.errorReporting?.enabled === true,
  "error reporting de produção deve permanecer habilitado");
exigir(config.observability?.enabled === true,
  "observabilidade de produção deve permanecer habilitada");

if (erros.length) {
  console.error("✗ REGRA 0b — contrato de plataforma Powerfarm violado:");
  for (const erro of erros) console.error(`  - ${erro}`);
  process.exit(1);
}

console.log("✓ REGRA 0b — topologia Powerfarm e fallback Cloudflare preservados.");
