import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const EXPECTED_UPSTREAM_COMMIT = 'b1d875034170379300e924e6fea2280852afee73';

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
  'deployment.jsonc',
  'state/ultimo-deploy.json',
  'scripts/deploy.mjs',
  'scripts/deploy-powerfarm.mjs',
  'scripts/derive-expected.mjs',
  'scripts/check-production-migration-state.mjs',
]) {
  if (existsSync(forbidden)) {
    throw new Error(`forbidden starter/legacy wrapper artifact at repository root: ${forbidden}`);
  }
}

const source = JSON.parse(readFileSync('powerfarm/source.json', 'utf8'));
if (source.canonicalBase?.repository !== 'cloudflare/cloudflare-os') {
  throw new Error('canonical base must be cloudflare/cloudflare-os');
}
if (source.canonicalBase?.commit !== EXPECTED_UPSTREAM_COMMIT) {
  throw new Error(`canonical upstream pin must be ${EXPECTED_UPSTREAM_COMMIT}`);
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

const expectedExtensionNames = new Map([
  ['powerfarm/custom-gatekeeper/wrangler.jsonc', 'powerfarm-gk-custom'],
  ['powerfarm/error-reporter/wrangler.jsonc', 'powerfarm-error-reporter'],
  ['powerfarm/gatekeeper-identity/wrangler.jsonc', 'powerfarm-gk-identity'],
  ['powerfarm/engine/wrangler.jsonc', 'powerfarm-engine'],
]);

for (const [path, expectedName] of expectedExtensionNames) {
  const text = readFileSync(path, 'utf8');
  if (!text.includes(`"name": "${expectedName}"`)) {
    throw new Error(`${path} must keep canonical Worker name ${expectedName}`);
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

const registryClient = readFileSync('powerfarm/gatekeeper-identity/src/registry-client.ts', 'utf8');
if (!registryClient.includes('const runtimeFetch: FetchFunction = (input, init) => fetch(input, init);')) {
  throw new Error('Identity must preserve the receiver-safe Cloudflare runtime fetch wrapper');
}
if (!registryClient.includes('private readonly fetcher: FetchFunction = runtimeFetch')) {
  throw new Error('Identity RegistryClient default fetcher must use runtimeFetch, never an unbound global fetch reference');
}

const runtimeFilesToCheckForStarterLeak = [
  'powerfarm/custom-gatekeeper/src/custom.ts',
  'powerfarm/custom-gatekeeper/package.json',
  'powerfarm/custom-gatekeeper/wrangler.jsonc',
  'powerfarm/error-reporter/package.json',
  'powerfarm/error-reporter/wrangler.jsonc',
  'powerfarm/gatekeeper-identity/package.json',
  'powerfarm/gatekeeper-identity/wrangler.jsonc',
  'powerfarm/engine/package.json',
  'powerfarm/engine/wrangler.jsonc',
];
for (const path of runtimeFilesToCheckForStarterLeak) {
  if (readFileSync(path, 'utf8').includes('cloudflare-os-starter')) {
    throw new Error(`starter reference leaked into canonical Powerfarm runtime/config: ${path}`);
  }
}

const trackedFiles = new Set(
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean),
);
for (const generated of [
  'powerfarm/custom-gatekeeper/worker-configuration.d.ts',
  'powerfarm/error-reporter/worker-configuration.d.ts',
  'powerfarm/gatekeeper-identity/worker-configuration.d.ts',
  'powerfarm/engine/worker-configuration.d.ts',
]) {
  if (trackedFiles.has(generated)) {
    throw new Error(`generated Powerfarm Worker types must not be committed as source: ${generated}`);
  }
}

console.log(
  `clean baseline OK: ${actualCoreWorkers.length} full Cloudflare OS core Workers + ${expectedExtensionNames.size} Powerfarm extension Workers; starter/submodule/live-deployment reuse forbidden`,
);
