#!/usr/bin/env node
const [command = "invoke", target = "hello-agentic", input = "hello"] = process.argv.slice(2);
const endpoint = (process.env.POWERFARM_ENGINE_URL ?? "").replace(/\/$/, "");
const token = process.env.POWERFARM_TOKEN ?? "";
if (!endpoint || !token) {
  console.error("Set POWERFARM_ENGINE_URL and POWERFARM_TOKEN.");
  process.exit(2);
}

let method = "POST";
let path;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
let body;
if (command === "invoke") {
  path = `/v1/gadgets/${encodeURIComponent(target)}/invocations`;
  headers["idempotency-key"] = process.env.POWERFARM_IDEMPOTENCY_KEY ?? crypto.randomUUID();
  body = JSON.stringify({ input });
} else if (command === "resume") {
  path = `/v1/runs/${encodeURIComponent(target)}/resume`;
  body = JSON.stringify({ input });
} else if (command === "get") {
  method = "GET";
  path = `/v1/runs/${encodeURIComponent(target)}`;
} else {
  console.error("Usage: invoke.mjs invoke <gadget> <input> | resume <run-id> <input> | get <run-id>");
  process.exit(2);
}

const result = await fetch(endpoint + path, { method, headers, body });
const text = await result.text();
if (!result.ok) {
  console.error(`Powerfarm Engine returned HTTP ${result.status}: ${text}`);
  process.exit(1);
}
console.log(text);
