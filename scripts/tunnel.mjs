// Runs a free Cloudflare quick tunnel to the local Bliscord server and publishes
// its current address to the `server-url` branch (server.json), where the app
// looks it up. Quick tunnel addresses change on every restart, so this keeps
// everyone's app pointed at the right place.
// Usage: node scripts/tunnel.mjs [port]
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.argv[2] || 3000);
const exe = path.join(root, 'tools', 'cloudflared.exe');
const BRANCH = 'server-url';

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function git(args, input) {
  return execFileSync('git', args, { cwd: root, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/** Force-pushes a single-file commit to the server-url branch without touching the working tree. */
function publish(url) {
  const json = `${JSON.stringify({ url, updatedAt: new Date().toISOString() }, null, 2)}\n`;
  const blob = git(['hash-object', '-w', '--stdin'], json);
  const tree = git(['mktree'], `100644 blob ${blob}\tserver.json\n`);
  const commit = git(['-c', 'user.name=Bliscord Tunnel', '-c', 'user.email=tunnel@bliscord.local', 'commit-tree', tree, '-m', 'Update server address'], '');
  git(['push', '--force', '--quiet', 'origin', `${commit}:refs/heads/${BRANCH}`]);
}

async function waitHealthy(url) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(4000) });
      if (r.ok && (await r.json()).name === 'Bliscord') return true;
    } catch { /* DNS for new tunnels takes a few seconds */ }
    await sleep(2000);
  }
  return false;
}

async function runOnce() {
  return new Promise((resolve) => {
    log(`Starting tunnel to http://localhost:${port}`);
    const child = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { windowsHide: true });
    let announced = false;
    const onData = async (buf) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (!m || announced) return;
      announced = true;
      const url = m[0];
      log(`Tunnel address: ${url}`);
      if (!(await waitHealthy(url))) {
        log('Tunnel did not become reachable, restarting it');
        child.kill();
        return;
      }
      try {
        publish(url);
        log('Published address to GitHub. Everyone\'s app will find it automatically.');
      } catch (err) {
        log('Could not publish the address to GitHub:', err.stderr?.toString() || err.message);
        log(`Share this address manually: ${url}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => resolve(code));
  });
}

if (!fs.existsSync(exe)) {
  console.error(`Missing ${exe}. Download cloudflared-windows-amd64.exe from https://github.com/cloudflare/cloudflared/releases and save it there as cloudflared.exe.`);
  process.exit(1);
}

for (;;) {
  const code = await runOnce();
  log(`Tunnel stopped (code ${code}). Restarting in 5 seconds...`);
  await sleep(5000);
}
