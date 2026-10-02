import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { battleChecks } from '../battle-checks.mjs';

// Order is deliberately conservative: a profile may use any earlier source
// module. Changing a new profile never invalidates its unchanged predecessors.
export const profiles = battleChecks.map(row => row.profile);
export const currentProfile = profiles.at(-1);
export const profileDirectory = name => name === 'encounter' ? 'encounter-core' : `battle-${name}`;
export const profileStage = name => name === 'encounter' ? 'encounter:check' : `battle:${name}`;
const wasmName = name => ({ spike: 'probe', encounter: 'encounter' }[name] ?? name);
const suffixes = new Set(['.ts', '.mjs', '.js', '.py', '.c', '.h', '.inc', '.json', '.gz', '.sql', '.html', '.css', '.png', '.pal', '.s', '.txt']);
const excluded = new Set(['node_modules', 'dist', '__pycache__', '.git']);

async function files(root, locations, allExtensions = false) {
  const found = [];
  async function visit(location) {
    const entries = await readdir(resolve(root, location), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${location}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Verification input must not be redirected: ${path}`);
      if (entry.isDirectory() && !excluded.has(entry.name)) await visit(path);
      else if (entry.isFile() && (allExtensions || suffixes.has(extname(entry.name)))) found.push(path);
    }
  }
  for (const location of locations) await visit(location);
  return found;
}
const unique = values => [...new Set(values)].sort();

export function selectStages(stages, { mode = 'full', area = 'battle', profile = currentProfile, requested = [] } = {}) {
  if (!profiles.includes(profile)) throw new Error(`Unknown battle profile: ${profile}`);
  const roots = mode === 'full' ? stages.filter(stage => stage.milestone).map(stage => stage.id)
    : mode === 'stage' ? requested
      : ({ battle: [profileStage(profile), 'lint', 'test:ts', 'practice:check', 'wild:check', 'test:boundaries', 'browser:practice'],
        app: ['lint', 'test:ts', 'test:integration', 'practice:check', 'wild:check', 'test:boundaries', 'test:recovery', 'browser:app'],
        content: ['lint', 'test:content', 'content:check', 'test:boundaries', 'test:e2e'],
        tooling: ['lint', 'typecheck', 'test:workflow', 'fixtures:check'] }[area]);
  if (!roots?.length) throw new Error('Select full, an area (battle/app/content/tooling), or explicit stage IDs.');
  const byId = new Map(stages.map(stage => [stage.id, stage])), ordered = [], visiting = new Set(), done = new Set();
  function add(id) {
    if (done.has(id)) return;
    const stage = byId.get(id);
    if (!stage) throw new Error(`Unknown verification stage: ${id}`);
    if (visiting.has(id)) throw new Error(`Cyclic verification dependency: ${id}`);
    visiting.add(id); for (const dependency of stage.dependsOn ?? []) add(dependency);
    visiting.delete(id); done.add(id); ordered.push(id);
  }
  for (const id of roots) add(id);
  // Global manifest validation must finish before any engine can reuse evidence,
  // but unrelated new fixture entries must not invalidate older engine proofs.
  if (ordered.some(id => battleChecks.some(row => row.stage === id)) && byId.has('fixtures:check')) {
    add('fixtures:check');
    ordered.splice(ordered.indexOf('fixtures:check'), 1); ordered.unshift('fixtures:check');
  }
  return ordered;
}

export async function createCatalog(root) {
  const read = async path => JSON.parse((await readFile(resolve(root, path), 'utf8')).replace(/^\uFEFF/, ''));
  const lock = await read('source-lock.json');
  const projectedFiles = ['tools/fixtures/manifest.json', 'scripts/battle-checks.mjs', 'package.json'];
  const projectedBytes = await Promise.all(projectedFiles.map(path => readFile(resolve(root, path))));
  const guards = projectedFiles.map((path, index) => ({ path, sha256: createHash('sha256').update(projectedBytes[index]).digest('hex') }));
  const fixtureManifest = JSON.parse(projectedBytes[0]);
  const packageConfig = JSON.parse(projectedBytes[2]); delete packageConfig.scripts;
  const toolchain = await read('tools/battle-spike/toolchain-lock.json');
  const sourceRoot = lock.reference.localPath;
  if (process.env.REFERENCE_SOURCE_DIR && resolve(process.env.REFERENCE_SOURCE_DIR).toLowerCase() !== resolve(sourceRoot).toLowerCase())
    throw new Error('REFERENCE_SOURCE_DIR must match the source-lock path used by the pinned extractors.');
  const scripts = await files(root, ['scripts']);
  const configs = ['package.json', 'package-lock.json', 'tsconfig.json', 'eslint.config.mjs', 'vitest.config.ts', 'playwright.config.ts', '.env'];
  const app = await files(root, ['apps', 'packages', 'tests']);
  const contentTools = await files(root, ['tools/content-import']);
  const fixtureTools = await files(root, ['tools/fixtures']);
  const toolFiles = await Promise.all(profiles.map(name => files(root, [`tools/${profileDirectory(name)}`])));
  const allTools = toolFiles.flat();
  const generatedServer = await files(root, ['content/generated/server'], true);
  const generatedClient = await files(root, ['content/generated/client'], true);
  const generatedManifests = await files(root, ['content/generated/manifests'], true);
  const fixtureRuntime = ['apps/server/src/development-profile.ts', 'apps/server/src/world-content.ts', ...generatedClient, ...generatedManifests];
  const common = unique([...scripts, ...configs]);
  const engineCommon = common.filter(path => !path.startsWith('scripts/verification/') && path !== 'scripts/battle-checks.mjs' && path !== 'package.json');
  const engineFixtureTools = fixtureTools.filter(path => path !== 'tools/fixtures/manifest.json');
  const appInputs = unique([...common, ...app, ...allTools.filter(path => /\.(ts|json)$/.test(path) && !path.includes('/fixtures/')), ...generatedServer]);
  const compiler = resolve(root, '.tools', toolchain.directory, toolchain.executable);
  const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  // Installations are managed by npm ci/pip requirements. Fingerprint their
  // receipts and actual runtime identity; manual installation edits require --force.
  const pythonInfo = JSON.parse((await promisify(execFile)(python, ['-c',
    'import json,sys,zlib,PIL,importlib.metadata as m; from pathlib import Path; d=m.distribution("Pillow"); print(json.dumps({"version":sys.version,"zlib":zlib.ZLIB_RUNTIME_VERSION,"pillow":PIL.__version__,"record":str(d.locate_file(next(p for p in d.files if str(p).endswith(".dist-info/RECORD")))),"runtime":str(Path(sys.base_prefix)/("python"+str(sys.version_info.major)+str(sys.version_info.minor)+".dll")) if sys.platform=="win32" else sys._base_executable}))'], { windowsHide: true })).stdout);
  const toolInputs = ['.tools/node-runtime.json', 'node_modules/.package-lock.json', '.venv/pyvenv.cfg', compiler, python, pythonInfo.record, pythonInfo.runtime,
    `.tools/${toolchain.directory}/.pokewaterblue-toolchain.json`, 'tools/content-import/requirements.txt'];
  const node = process.execPath;
  const stages = [];
  const add = (id, task, { inputs = common, outputs = [], dependsOn = [], cacheable = true, evidence = [], milestone = true, args = [], config = {}, guards = [] } = {}) => {
    stages.push({ id, inputs: unique([...inputs, ...toolInputs]), outputs: unique([...outputs, ...evidence]), dependsOn, cacheable, evidence, milestone, guards,
      command: { file: node, args: ['scripts/run.mjs', task, ...args] }, config: { catalogVersion: 2, stage: id, python: pythonInfo, ...config } });
  };
  add('doctor', 'doctor', { cacheable: false });
  add('lint', 'lint', { inputs: [...common, ...app, ...allTools.filter(path => path.endsWith('.ts')), ...fixtureTools] });
  add('typecheck', 'typecheck', { inputs: [...appInputs, ...fixtureTools] });
  add('test:workflow', 'test:workflow', { inputs: [...common, ...fixtureTools] });
  add('fixtures:check', 'fixtures:check', { inputs: [...common, ...fixtureTools, ...allTools.filter(path => path.includes('/fixtures/'))],
    outputs: ['reports/fixture-storage-node.json', 'reports/fixture-storage-python.json'], evidence: ['reports/fixture-storage-node.json', 'reports/fixture-storage-python.json'] });
  // Hash actual reference bytes used by each successful extractor. A missing
  // report gets the entire source tree on a cold build; new extractor code is
  // an input and a changed source read-set causes a subsequent cache miss.
  for (let index = 0; index < profiles.length; index++) {
    const name = profiles[index], directory = profileDirectory(name), id = profileStage(name);
    const report = `reports/${directory}-build.json`;
    let referenceInputs;
    if (existsSync(resolve(root, report))) {
      const build = await read(report);
      if (!Array.isArray(build.extraction?.inputs) || !build.extraction.inputs.length) throw new Error(`Missing source dependency closure in ${report}`);
      referenceInputs = build.extraction.inputs.map(row => {
        const path = resolve(sourceRoot, row.path), rel = relative(resolve(sourceRoot), path);
        if (rel.startsWith('..') || resolve(sourceRoot, rel) !== path) throw new Error('Unsafe reference dependency');
        return path;
      });
    } else referenceInputs = [resolve(sourceRoot)];
    const ancestorDirectories = profiles.slice(0, index + 1).map(profileDirectory);
    const relevantFixtures = fixtureManifest.fixtures.filter(row => ancestorDirectories.some(dir => row.path.startsWith(`tools/${dir}/`)));
    for (const fixture of relevantFixtures) {
      for (const path of fixture.sourcePaths) {
        if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes(':')) throw new Error('Unsafe oracle source dependency');
        referenceInputs.push(resolve(sourceRoot, path));
      }
    }
    if (index >= profiles.indexOf('encounter')) referenceInputs.push(...['src/battle_controller_opponent.c', 'src/item_use.c', 'src/overworld.c',
      'src/heal_location.c'].map(path => resolve(sourceRoot, path)));
    const dependencies = index ? [profileStage(profiles[index - 1])] : [];
    const historicalInputs = [
      ['family', 'reports/nineteenth-battle-evolution-integration.json'],
      ['party', 'reports/twentieth-battle-family-integration.json'],
      ['tactics', 'reports/twentyfirst-battle-party-integration.json'],
      ['charge', 'reports/twentysecond-battle-tactics-integration.json'],
      ['protect', 'reports/twentythird-battle-charge-integration.json'],
      ['protect', 'reports/protect-source-audit.json'],
    ].filter(([first]) => index >= profiles.indexOf(first)).map(([, path]) => path);
    if (index >= profiles.indexOf('protect')) referenceInputs.push(...['pokefirered.gba', 'pokefirered.elf', 'pokefirered.map',
      'build/firered/src/battle_script_commands.o'].map(path => resolve(sourceRoot, path)));
    const outputReports = battleChecks[index].reports.map(suffix => `reports/${directory}-${suffix}.json`);
    if (name === 'encounter') outputReports.push('reports/encounter-dependencies.json');
    add(id, id, { inputs: [...engineCommon, ...toolFiles.slice(0, index + 1).flat(), ...engineFixtureTools, ...app.filter(path => path.startsWith('packages/')),
      ...fixtureRuntime, ...historicalInputs, ...generatedServer, 'source-lock.json', lock.fingerprint.manifest, ...referenceInputs], dependsOn: dependencies,
      guards, config: { registry: battleChecks[index], package: packageConfig, fixtures: { ...fixtureManifest, fixtures: relevantFixtures } },
      outputs: [...outputReports, `.local/${directory}/primary/${wasmName(name)}.wasm`, `.local/${directory}/rebuild/${wasmName(name)}.wasm`], evidence: outputReports });
  }
  const referenceContent = [resolve(sourceRoot, 'data'), resolve(sourceRoot, 'graphics'), resolve(sourceRoot, 'include'), resolve(sourceRoot, 'sound'), resolve(sourceRoot, 'src')];
  const spriteManifestPath = 'content/generated/manifests/practice-sprites-manifest.json';
  let spriteReferences = referenceContent;
  if (existsSync(resolve(root, spriteManifestPath))) {
    const manifest = await read(spriteManifestPath);
    if (!Array.isArray(manifest.inputs) || !manifest.inputs.length) throw new Error('Missing sprite source dependency closure.');
    spriteReferences = manifest.inputs.map(row => {
      const path = resolve(sourceRoot, row.path), rel = relative(resolve(sourceRoot), path);
      if (rel.startsWith('..') || resolve(sourceRoot, rel) !== path) throw new Error('Unsafe sprite source dependency');
      return path;
    });
  }
  add('test:content', 'test:content', { inputs: [...common, ...contentTools, 'source-lock.json', lock.fingerprint.manifest, ...referenceContent] });
  add('content:check', 'content:check', { inputs: [...common, ...contentTools, 'source-lock.json', lock.fingerprint.manifest, ...referenceContent, ...generatedClient, ...generatedServer, ...generatedManifests] });
  add('sprites:check', 'sprites:check', { inputs: [...common, ...contentTools, 'source-lock.json', lock.fingerprint.manifest, ...spriteReferences],
    outputs: ['content/generated/client/practice', 'content/generated/manifests/practice-sprites-manifest.json'] });
  add('test:ts', 'test:ts', { inputs: appInputs, dependsOn: [profileStage(currentProfile)], outputs: [] });
  add('test:integration', 'test:integration', { inputs: appInputs, dependsOn: [profileStage(currentProfile)], cacheable: false });
  add('practice:check', 'practice:integration', { inputs: appInputs, dependsOn: [profileStage(currentProfile), 'sprites:check'], cacheable: false,
    evidence: ['reports/practice-engine-verification.json', 'reports/practice-storage-verification.json', 'reports/practice-network-verification.json'] });
  add('wild:check', 'wild:check', { inputs: appInputs, dependsOn: [profileStage(currentProfile)], cacheable: false,
    evidence: ['reports/wild-engine-verification.json', 'reports/wild-test-verification.json'] });
  add('build', 'build:bundle', { inputs: [...appInputs, ...generatedClient, ...generatedManifests], dependsOn: ['typecheck', 'sprites:check'],
    outputs: ['apps/client/dist', 'apps/server/dist', '.local/client-public'] });
  add('test:boundaries', 'test:boundaries', { inputs: appInputs, dependsOn: ['build'], cacheable: false,
    evidence: ['reports/client-bundle-check.json', 'reports/private-client-boundary.json'] });
  add('test:recovery', 'test:recovery', { inputs: appInputs, dependsOn: ['build', profileStage(currentProfile)], cacheable: false });
  add('test:e2e', 'test:e2e', { inputs: appInputs, dependsOn: ['build', profileStage(currentProfile)], cacheable: false,
    evidence: ['reports/browser-tests.json'] });
  add('browser:practice', 'test:e2e', { inputs: appInputs, dependsOn: ['build', profileStage(currentProfile)], cacheable: false, milestone: false,
    args: ['tests/e2e/practice.spec.ts'], evidence: ['reports/browser-tests.json', 'reports/practice-browser.json'] });
  add('browser:app', 'test:e2e', { inputs: appInputs, dependsOn: ['build', profileStage(currentProfile)], cacheable: false, milestone: false,
    args: ['tests/e2e/accounts.spec.ts', 'tests/e2e/assets.spec.ts', 'tests/e2e/local-testing.spec.ts', 'tests/e2e/practice.spec.ts', 'tests/e2e/reconnect.spec.ts', 'tests/e2e/world.spec.ts', 'tests/e2e/wild-testing.spec.ts'],
    evidence: ['reports/browser-tests.json'] });
  return stages;
}
