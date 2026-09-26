import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, '.tools', 'node-runtime.json');
const localNode = existsSync(runtime) ? resolve(root, JSON.parse(readFileSync(runtime, 'utf8')).executable) : process.execPath;
if (Number(process.versions.node.split('.')[0]) !== 24 && localNode === process.execPath) {
  console.error('Node 24 is required. On Windows run: py -3 scripts/bootstrap-runtime.py');
  process.exit(1);
}
const child = spawn(localNode, [join(root, 'scripts', 'tasks.mjs'), ...process.argv.slice(2)], {
  cwd: root, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: true,
  env: { ...process.env, PATH: `${dirname(localNode)}${delimiter}${process.env.PATH ?? ''}` },
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (child.connected) child.send({ type: 'shutdown' }, () => {});
  else child.kill('SIGINT');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('message', message => { if (message?.type === 'shutdown') stop(); });
process.on('disconnect', stop);
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? (stopping ? 0 : 1); if (process.connected) process.disconnect(); });
