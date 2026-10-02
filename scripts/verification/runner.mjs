import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const VERSION = 1;
const digest = value => createHash('sha256').update(value).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const fingerprint = value => digest(JSON.stringify(stable(value)));
const nativePath = (root, path) => isAbsolute(path) ? resolve(path) : resolve(root, path);
const inside = (root, path) => { const child = relative(root, path); return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child)); };

export class VerificationLockError extends Error {
  constructor() {
    super('Another verification owns reports/verification-runs/.lock. Wait for it to finish. If its recorded PID has exited, inspect the unfinished run and remove only that stale lock before retrying.');
    this.name = 'VerificationLockError';
  }
}

/** Resolve the selected dependency closure without running or reading stages. */
export function selectStages(stages, selected = stages.map(stage => stage.id)) {
  const byId = new Map();
  for (const stage of stages) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/.test(stage.id) || byId.has(stage.id)) throw new Error('Stage IDs must be unique safe identifiers.');
    byId.set(stage.id, stage);
  }
  const ordered = [], visiting = new Set(), visited = new Set();
  function visit(id) {
    if (!byId.has(id)) throw new Error(`Unknown verification stage: ${id}`);
    if (visiting.has(id)) throw new Error(`Verification dependency cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const stage = byId.get(id);
    for (const dependency of stage.dependsOn ?? []) visit(dependency);
    visiting.delete(id); visited.add(id); ordered.push(stage);
  }
  for (const id of selected) visit(id);
  return ordered;
}

/** Hash contents and directory membership; explicit absolute inputs may be read outside root. */
async function filesFingerprint(root, paths) {
  const rows = [];
  async function visit(path, logical, ancestors) {
    const resolved = await realpath(path);
    if (ancestors.has(resolved)) throw new Error('Verification input contains a directory cycle.');
    const info = await stat(resolved);
    if (info.isFile()) rows.push([logical, digest(await readFile(resolved))]);
    else if (info.isDirectory()) {
      rows.push([logical, 'directory']);
      const nested = new Set([...ancestors, resolved]);
      for (const name of (await readdir(resolved)).sort()) await visit(join(resolved, name), `${logical}/${name}`, nested);
    } else throw new Error('Verification paths must be regular files or directories.');
  }
  for (const path of [...new Set(paths ?? [])].sort()) {
    if (typeof path !== 'string' || !path) throw new Error('Verification paths must be nonempty strings.');
    await visit(nativePath(root, path), path.replaceAll('\\', '/'), new Set());
  }
  return { hash: fingerprint(rows), files: rows.filter(row => row[1] !== 'directory').length };
}

async function checkGuards(root, guards = []) {
  for (const guard of guards) {
    if (!guard || typeof guard.path !== 'string' || !guard.path || !/^[a-f0-9]{64}$/.test(guard.sha256)) {
      throw Object.assign(new Error('Verification metadata guard is invalid.'), { code: 'GUARD_INVALID' });
    }
    const actual = digest(await readFile(nativePath(root, guard.path)));
    if (actual !== guard.sha256) throw Object.assign(new Error('Verification metadata changed during this run.'), { code: 'GUARD_MISMATCH' });
  }
}

function redact(text, env) {
  const secrets = Object.entries(env).filter(([key, value]) => value && /password|passwd|secret|token|credential|cookie|private.?key|database.?url|connection.?string/i.test(key))
    .map(([, value]) => String(value)).sort((a, b) => b.length - a.length);
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
  return text;
}

async function execute(command, root, env, logPath) {
  // Never echo arguments or environment: callers must also avoid printing secrets
  // loaded internally by the command. Known supplied secret values are redacted.
  let stdout = '', stderr = '', retained = 0, truncated = false;
  const maxBytes = 32 * 1024 * 1024;
  const result = await new Promise(done => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; done(value); } };
    const child = spawn(nativePath(root, command.file), command.args ?? [], {
      cwd: nativePath(root, command.cwd ?? '.'), env, windowsHide: true, shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const collect = (buffer, stream) => {
      const available = Math.max(0, maxBytes - retained);
      const kept = buffer.subarray(0, available).toString('utf8'); retained += buffer.length;
      if (stream === 'stdout') stdout += kept; else stderr += kept;
      if (buffer.length > available) truncated = true;
    };
    child.stdout.on('data', buffer => collect(buffer, 'stdout'));
    child.stderr.on('data', buffer => collect(buffer, 'stderr'));
    child.once('error', error => finish({ nativeExitCode: null, exitCode: 1, signal: null, failure: `spawn-${error.code ?? 'error'}` }));
    child.once('close', (code, signal) => finish({ nativeExitCode: code, exitCode: code ?? 1, signal, ...(code === 0 ? {} : { failure: signal ? 'terminated-by-signal' : 'nonzero-exit' }) }));
  });
  await writeFile(logPath, redact(stdout + (stderr ? `\n[stderr]\n${stderr}` : '') + (truncated ? '\n[log truncated at 32 MiB]\n' : ''), env), { flag: 'wx' });
  return result;
}

async function readReceipt(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

async function archiveEvidence(root, runDir, stage, env) {
  const result = [];
  for (const [index, path] of (stage.evidence ?? []).entries()) {
    const source = nativePath(root, path);
    try {
      const resolved = await realpath(source);
      if (!inside(root, resolved)) throw new Error('Evidence must be an explicitly declared workspace report.');
      const bytes = await readFile(resolved);
      const target = `evidence/${stage.id.replaceAll(':', '_')}/${index}-${path.split(/[\\/]/).at(-1)}`;
      await mkdir(dirname(join(runDir, target)), { recursive: true });
      const redacted = redact(bytes.toString('utf8'), env);
      await writeFile(join(runDir, target), redacted, { flag: 'wx' });
      result.push({ path: target, sourceHash: digest(bytes), archivedHash: digest(redacted) });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      result.push({ missing: true, sourcePathHash: digest(path) });
    }
  }
  return result;
}

/**
 * Sequential verification with content-addressed successful receipts.
 * Only cacheable:true opts in; mutable database/browser/health stages must omit it.
 * Inputs include the complete dependency closure; callers resolve their own globs.
 * Optional guards [{path, sha256}] fence metadata reads whose relevant projected
 * fields are in stage.config. Guard paths bind the cache key; expected raw hashes
 * do not, allowing irrelevant metadata additions without invalidating old engines.
 * Reports contain hashes, timing and native exit status, never command/env values.
 * Every invocation has a unique archive. A previous successful stage can be reused
 * after a failed run; failed stages never mint or reuse a successful receipt.
 */
export async function runVerification({ root: requestedRoot, stages, selected, mode = 'selected', force = false,
  env: suppliedEnv = process.env, toolIdentity = {}, onStage } = {}) {
  const root = await realpath(requestedRoot);
  const ordered = selectStages(stages, selected);
  const base = join(root, 'reports', 'verification-runs');
  await mkdir(base, { recursive: true });
  // Avoid writing archives through a redirected reports directory.
  if (!inside(root, await realpath(base))) throw new Error('Verification report directory resolves outside the workspace.');
  const cache = join(root, '.local', 'verification', 'receipts');
  await mkdir(cache, { recursive: true });
  if (!inside(root, await realpath(cache))) throw new Error('Verification cache directory resolves outside the workspace.');
  const lockPath = join(base, '.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new VerificationLockError(); throw error; }
  const runId = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}-${randomUUID()}`;
  const runDir = join(base, runId), started = performance.now();
  const report = { schemaVersion: VERSION, runId, mode, force, startedAt: new Date().toISOString(), stages: [], status: 'passed', exitCode: 0 };
  let complete = false;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, runId, startedAt: report.startedAt }));
    await mkdir(join(runDir, 'logs'), { recursive: true });
    const runnerHash = digest(await readFile(fileURLToPath(import.meta.url)));
    const executableHash = digest(await readFile(process.execPath));
    const completed = new Map();
    for (const [index, stage] of ordered.entries()) {
      const began = performance.now();
      const row = { id: stage.id, startedAt: new Date().toISOString(), cacheable: stage.cacheable === true,
        status: 'failed', nativeExitCode: null, exitCode: 1, evidence: [] };
      report.stages.push(row);
      await onStage?.({ id: stage.id, status: 'started' });
      try {
        if (!stage.command || typeof stage.command.file !== 'string') throw new Error('Stage command is required.');
        const env = Object.fromEntries(Object.entries({ ...suppliedEnv, ...stage.command.env }).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
        const inputs = await filesFingerprint(root, stage.inputs);
        const commandExecutable = await filesFingerprint(root, [stage.command.file]);
        const dependencies = (stage.dependsOn ?? []).map(id => [id, completed.get(id).proof]);
        const key = fingerprint({ version: VERSION, runnerHash, executableHash, platform: process.platform, arch: process.arch,
          nodeVersion: process.version, toolIdentity, stage: { id: stage.id, config: stage.config, command: stage.command,
            outputs: stage.outputs ?? [], evidence: stage.evidence ?? [], guards: (stage.guards ?? []).map(guard => guard.path) },
          inputs: inputs.hash, commandExecutable: commandExecutable.hash, environment: fingerprint(env), dependencies });
        Object.assign(row, { inputHash: inputs.hash, inputFiles: inputs.files, configurationHash: key });
        await checkGuards(root, stage.guards);
        const receiptPath = join(cache, `${key}.json`);
        let receipt = stage.cacheable === true && !force ? await readReceipt(receiptPath) : null;
        if (receipt?.schemaVersion !== VERSION || receipt?.configurationHash !== key || receipt?.status !== 'passed') receipt = null;
        if (receipt) {
          try {
            const outputs = await filesFingerprint(root, stage.outputs);
            const original = join(base, receipt.runId, 'run.json');
            const saved = JSON.parse(await readFile(original, 'utf8'));
            const originalRow = saved.stages.find(value => value.id === stage.id && value.status === 'passed' && value.configurationHash === key);
            if (outputs.hash !== receipt.outputHash || !originalRow || originalRow.outputHash !== outputs.hash) receipt = null;
            else for (const item of originalRow.evidence ?? []) if (item.path && digest(await readFile(join(base, receipt.runId, item.path))) !== item.archivedHash) receipt = null;
          } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) receipt = null; else throw error; }
        }
        if (receipt) {
          // A user may edit sources independently of the runner's process lock.
          // Do not declare a cache hit across an input change during validation.
          const after = await filesFingerprint(root, stage.inputs);
          const executableAfter = await filesFingerprint(root, [stage.command.file]);
          await checkGuards(root, stage.guards);
          if (after.hash !== inputs.hash || executableAfter.hash !== commandExecutable.hash) row.failure = 'inputs-changed-during-stage';
          else Object.assign(row, { status: 'cached', exitCode: 0, outputHash: receipt.outputHash, reusedFrom: { runId: receipt.runId, stageId: stage.id } });
        } else {
          await checkGuards(root, stage.guards);
          row.log = `logs/${String(index + 1).padStart(2, '0')}-${stage.id.replaceAll(':', '_')}.log`;
          Object.assign(row, await execute(stage.command, root, env, join(runDir, row.log)));
          row.evidence = await archiveEvidence(root, runDir, stage, env);
          await checkGuards(root, stage.guards);
          if (row.exitCode === 0) {
            const after = await filesFingerprint(root, stage.inputs);
            const executableAfter = await filesFingerprint(root, [stage.command.file]);
            if (after.hash !== inputs.hash || executableAfter.hash !== commandExecutable.hash) {
              row.exitCode = 1; row.failure = 'inputs-changed-during-stage';
            } else {
              const outputs = await filesFingerprint(root, stage.outputs);
              row.outputHash = outputs.hash; row.status = 'passed';
              if (stage.cacheable === true) {
                row.receipt = { schemaVersion: VERSION, status: 'passed', configurationHash: key, outputHash: outputs.hash, runId };
              }
            }
          }
        }
        if (row.exitCode === 0) {
          row.proof = fingerprint({ key, outputHash: row.outputHash }); completed.set(stage.id, row);
        }
      } catch (error) {
        // Error messages can contain command arguments or environment paths. The
        // reason code is sufficient; original child stderr is in its owned log.
        row.failure = error.code ?? 'stage-preparation-or-evidence-error'; row.exitCode = 1;
      }
      row.durationMs = Math.round((performance.now() - began) * 1000) / 1000;
      row.finishedAt = new Date().toISOString();
      if (row.exitCode !== 0 && row.cacheable && row.configurationHash) {
        row.receipt = { schemaVersion: VERSION, status: 'failed', configurationHash: row.configurationHash, runId };
      }
      await onStage?.({ id: stage.id, status: row.status, exitCode: row.exitCode, durationMs: row.durationMs });
      if (row.exitCode !== 0) {
        report.status = 'failed'; report.exitCode = row.exitCode;
        for (const pending of ordered.slice(index + 1)) report.stages.push({ id: pending.id, status: 'blocked', nativeExitCode: null, exitCode: null, durationMs: 0 });
        break;
      }
    }
    report.durationMs = Math.round((performance.now() - started) * 1000) / 1000;
    report.finishedAt = new Date().toISOString();
    // Save the immutable source evidence before publishing any reusable receipt.
    const receipts = report.stages.flatMap(row => { const receipt = row.receipt; delete row.receipt; return receipt ? [receipt] : []; });
    await writeFile(join(runDir, 'run.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    complete = true;
    for (const receipt of receipts) {
      const path = join(cache, `${receipt.configurationHash}.json`);
      // Receipts are replaceable indexes into immutable runs. In particular, a
      // failed forced run invalidates an earlier success for the same key.
      const temporary = `${path}.${runId}.tmp`;
      await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
      await rename(temporary, path);
    }
    return { ...report, runDir };
  } finally {
    if (!complete) {
      report.status = 'failed'; report.exitCode = 1; report.failure = 'runner-interrupted-or-report-error';
      report.durationMs = Math.round((performance.now() - started) * 1000) / 1000;
      try { await writeFile(join(runDir, 'run.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); } catch { /* Preserve any existing archive. */ }
    }
    await lock.close(); await unlink(lockPath);
  }
}
