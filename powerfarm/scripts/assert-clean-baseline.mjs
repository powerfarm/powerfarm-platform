import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const expectedCoreWorkers = [
  'gatekeeper-cloudflare',
  'gatekeeper-confluence',
  'gatekeeper-context',
  'gatekeeper-email',
  'gatekeeper-github',
  'gatekeeper-google',
  'gatekeeper-homeassistant',
  'gatekeeper-linear',
  'gatekeeper-mcp',
  'gatekeeper-mcp-portal',
  'gatekeeper-notion',
  'gatekeeper-scheduler',
  'gatekeeper-slack',
  'gatekeeper-spotify',
  'gatekeeper-supabase',
  'gatekeeper-zoominfo',
  'router',
  'workshop-backend',
].sort();

const actualCoreWorkers = readdirSync('packages', { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join('packages', entry.name, 'wrangler.jsonc')))
  .map((entry) => entry.name)
  .sort();

if (JSON.stringify(actualCoreWorkers) !== JSON.stringify(expectedCoreWorkers)) {
  throw new Error(
    [
      `full Cloudflare OS core drift: expected ${expectedCoreWorkers.length} deployable Workers, found ${actualCoreWorkers.length}`,
      `expected=${expectedCoreWorkers.join(',')}`,
      `actual=${actualCoreWorkers.join(',')}`,
    ].join('\n'),
  );
}

for (const forbidden of [
  '.gitmodules',
  'cloudflare-os',
  'state/ultimo-deploy.json',
  'deployment.jsonc',
]) {
  if (existsSync(forbidden)) {
    throw new Error(`forbidden starter/legacy wrapper artifact at repository root: ${forbidden}`);
  }
}

const source = JSON.parse(readFileSync('powerfarm/source.json', 'utf8'));
if (source.canonicalBase?.repository !== 'cloudflare/cloudflare-os') {
  throw new Error('canonical base must be cloudflare/cloudflare-os');
}
if (source.canonicalBase?.layout !== 'full-repository-root') {
  throw new Error('Cloudflare OS must occupy the repository root');
}
if (source.canonicalBase?.expectedCoreDeployableWorkers !== expectedCoreWorkers.length) {
  throw new Error('source.json expected Worker count does not match guarded topology');
}
if (source.starterIsBase !== false) {
  throw new Error('cloudflare-os-starter must never be the Powerfarm base');
}
if (source.reuseExistingCloudflareWorkers !== false) {
  throw new Error('existing live Worker deployment reuse must remain forbidden');
}

const deploymentText = readFileSync('powerfarm/deployment.jsonc', 'utf8');
for (const required of [
  '"requireOldPlatformRemovedBeforeCreate": true',
  '"reuseExistingWorkerDeployments": false',
  '"allowHybridOldAndNewTopology": false',
  '"identityIsOnlyEngineBroker": true',
  '"engineWorkersDev": false',
  '"engineSupabaseServiceRoleAllowed": false',
]) {
  if (!deploymentText.includes(required)) {
    throw new Error(`missing clean-install deployment invariant: ${required}`);
  }
}

const identityWrangler = readFileSync('powerfarm/gatekeeper-identity/wrangler.jsonc', 'utf8');
if (!identityWrangler.includes('"binding": "ENGINE"')) {
  throw new Error('Powerfarm Identity must expose the ENGINE service binding');
}
if (!identityWrangler.includes('"service": "powerfarm-engine"')) {
  throw new Error('Powerfarm Identity ENGINE binding must point at powerfarm-engine');
}
if (!identityWrangler.includes('"entrypoint": "WorkspaceRuntime"')) {
  throw new Error('Powerfarm Identity ENGINE binding must target WorkspaceRuntime');
}

const wranglerFiles = [];
for (const root of ['packages', 'powerfarm']) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const wrangler = join(root, entry.name, 'wrangler.jsonc');
    if (existsSync(wrangler)) wranglerFiles.push(wrangler);
  }
}

for (const wrangler of wranglerFiles) {
  if (wrangler === 'powerfarm/gatekeeper-identity/wrangler.jsonc') continue;
  const text = readFileSync(wrangler, 'utf8');
  if (text.includes('"binding": "ENGINE"')) {
    throw new Error(`ENGINE service binding is forbidden outside Powerfarm Identity: ${wrangler}`);
  }
}

const engineWrangler = readFileSync('powerfarm/engine/wrangler.jsonc', 'utf8');
if (!/"workers_dev"\s*:\s*false/.test(engineWrangler)) {
  throw new Error('Powerfarm Engine must remain private with workers_dev=false');
}
if (/service[_-]?role/i.test(engineWrangler)) {
  throw new Error('Powerfarm Engine Wrangler config must not contain a Supabase service-role credential');
}

for (const generated of [
  'powerfarm/custom-gatekeeper/worker-configuration.d.ts',
  'powerfarm/error-reporter/worker-configuration.d.ts',
  'powerfarm/gatekeeper-identity/worker-configuration.d.ts',
  'powerfarm/engine/worker-configuration.d.ts',
]) {
  if (existsSync(generated)) {
    throw new Error(`generated Powerfarm Worker types must not be committed as source: ${generated}`);
  }
}

console.log(
  `clean baseline OK: ${actualCoreWorkers.length} full Cloudflare OS core Workers + Powerfarm extensions; starter/submodule/live-deployment reuse forbidden`,
);
