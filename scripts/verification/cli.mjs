import { resolve } from 'node:path';
import { createCatalog, selectStages, currentProfile } from './catalog.mjs';
import { runVerification } from './runner.mjs';

const root = process.cwd();
try {
  const [command = 'verify', ...args] = process.argv.slice(2);
  const options = { mode: command === 'verify:focus' ? 'focus' : command === 'verify:stage' ? 'stage' : 'full', requested: [] };
  let force = false, list = false;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--force') force = true;
    else if (value === '--list') list = true;
    else if (value === '--area' || value === '--profile') {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${value} needs a value.`);
      options[value.slice(2)] = args[++index];
    } else if (options.mode === 'stage' && !value.startsWith('-')) options.requested.push(value);
    else throw new Error(`Unknown verification argument: ${value}`);
  }
  if (!['verify', 'verify:focus', 'verify:stage'].includes(command)) throw new Error(`Unknown verification command: ${command}`);
  const stages = await createCatalog(root), selected = selectStages(stages, options);
  if (list) {
    console.log(JSON.stringify({ mode: options.mode, area: options.area ?? 'battle', profile: options.profile ?? currentProfile,
      stages: selected.map(id => ({ id, reusable: stages.find(stage => stage.id === id).cacheable })) }, null, 2));
  } else {
    console.log(`Verification ${options.mode}: ${selected.length} stages; ${force ? 'fresh deterministic checks' : 'unchanged deterministic checks may be reused'}. Database, browser and health checks always run.`);
    const result = await runVerification({ root, stages, selected, mode: options.mode, force,
      toolIdentity: { node: process.version, platform: process.platform, architecture: process.arch },
      onStage: stage => console.log(`[verify] ${stage.id}: ${stage.status}${stage.durationMs === undefined ? '' : ` (${(stage.durationMs / 1000).toFixed(2)}s)`}`) });
    console.log(`Verification ${result.status}. Evidence: ${resolve(result.runDir, 'run.json')}`);
    process.exitCode = result.exitCode;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
