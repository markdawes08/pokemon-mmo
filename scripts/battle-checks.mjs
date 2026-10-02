// One registry owns build/check ordering and retained evidence for every engine.
// Runtime implementations remain frozen for save compatibility.
export const battleChecks = [
  { profile: 'spike', wasm: 'probe', checks: ['verify', 'verify-turns', 'verify-checkpoint', 'verify-recovery', 'verify-engine', 'measure'],
    reports: ['build', 'batch-1', 'batch-2', 'checkpoint-tests', 'recovery', 'engine', 'measurements'] },
  { profile: 'encounter', checks: ['dependencies', 'verify'], reports: ['build', 'verification', 'recovery'] },
  { profile: 'route1', checks: ['verify', 'verify-items', 'verify-integration', 'verify-items-integration'],
    reports: ['build', 'verification', 'recovery', 'integration', 'items', 'items-recovery', 'items-integration'] },
  ...['progression', 'loss', 'capture', 'evolution', 'family', 'party', 'tactics', 'charge', 'protect', 'pursuit', 'mirror']
    .map(profile => ({ profile, checks: ['verify', 'verify-integration'], reports: ['build', 'verification', 'recovery', 'integration'] })),
].map(row => ({ ...row, wasm: row.wasm ?? row.profile,
  directory: row.profile === 'encounter' ? 'encounter-core' : `battle-${row.profile}`,
  stage: row.profile === 'encounter' ? 'encounter:check' : `battle:${row.profile}` }));
