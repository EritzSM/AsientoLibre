import { spawn } from 'node:child_process';

const children = ['server', 'client'].map(directory => spawn(process.execPath, [
  process.env.npm_execpath, '--prefix', directory, 'run', directory === 'server' ? 'start:dev' : 'dev',
], { stdio: 'inherit' }));

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') spawn('C:\\Windows\\System32\\taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exitCode = exitCode;
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
