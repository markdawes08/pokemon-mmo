/** Private P03 resource measurements, isolated from the running preview. */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const start = performance.now();
const report = await new Promise<Record<string, unknown>>((resolve, reject) => {
  const child = spawn(process.execPath, ['--expose-gc', '--import', 'tsx',
    fileURLToPath(new URL('./measure-worker.ts', import.meta.url))], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  const timeout = setTimeout(() => { child.kill(); reject(new Error('Battle measurement child exceeded 120 seconds')); }, 120_000);
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (text: string) => {
    stdout += text;
    if (stdout.length > 4_000_000) { child.kill(); reject(new Error('Unexpected measurement output size')); }
  });
  child.stderr.on('data', (text: string) => { stderr = (stderr + text).slice(-16_000); });
  child.on('error', error => { clearTimeout(timeout); reject(error); });
  child.on('close', code => {
    clearTimeout(timeout);
    if (code !== 0) { reject(new Error(`Battle measurements failed (${code}): ${stderr}`)); return; }
    try { resolve(JSON.parse(stdout) as Record<string, unknown>); }
    catch { reject(new Error(`Invalid measurement report: ${stderr}`)); }
  });
});
report.childWallMilliseconds = performance.now() - start;
await writeFile('reports/battle-spike-measurements.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, report: 'reports/battle-spike-measurements.json',
  childWallMilliseconds: report.childWallMilliseconds, assessment: report.assessment }));
