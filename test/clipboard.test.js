// Regression test for the tmux→OSC 52→server→pbcopy path that makes
// "copy from terminal" work in Loom.app on macOS. The frontend OSC 52
// handler in public/js/terminal.js base64-decodes the payload and POSTs
// the plain text to /api/clipboard; this test covers the second half.
//
// Run: node --test test/clipboard.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');

const IS_MAC = process.platform === 'darwin';

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/agent-status`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`server on :${port} never came up`);
}

test('POST /api/clipboard lands text on the macOS pasteboard', { skip: !IS_MAC }, async (t) => {
  const port = await pickFreePort();
  const repoRoot = path.resolve(__dirname, '..');

  // Use a throwaway LOOM_DATA_DIR so we don't touch the user's real config.
  const dataDir = path.join(os.tmpdir(), `loom-test-${process.pid}-${Date.now()}`);

  const child = spawn(process.execPath, ['server.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), LOOM_DATA_DIR: dataDir, LOOM_HA_MODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { try { child.kill('SIGTERM'); } catch {} });

  await waitForServer(port);

  // Save the user's existing clipboard so the test doesn't trash it.
  let prior = '';
  try { prior = execFileSync('pbpaste').toString(); } catch {}
  t.after(() => {
    try {
      const p = spawn('pbcopy');
      p.stdin.end(prior);
    } catch {}
  });

  const sentinel = `loom-clipboard-test ${Date.now()} ${Math.random()}`;
  const res = await fetch(`http://127.0.0.1:${port}/api/clipboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: sentinel }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  // pbcopy reads stdin async; give it a beat to flush before reading.
  await new Promise(r => setTimeout(r, 200));
  const got = execFileSync('pbpaste').toString();
  assert.equal(got, sentinel, 'pbpaste should return the text we POSTed');
});

test('POST /api/open-url rejects non-http schemes', async (t) => {
  const port = await pickFreePort();
  const repoRoot = path.resolve(__dirname, '..');
  const dataDir = path.join(os.tmpdir(), `loom-test-${process.pid}-${Date.now()}-url`);

  const child = spawn(process.execPath, ['server.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), LOOM_DATA_DIR: dataDir, LOOM_HA_MODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { try { child.kill('SIGTERM'); } catch {} });

  await waitForServer(port);

  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'not-a-url', '']) {
    const res = await fetch(`http://127.0.0.1:${port}/api/open-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: bad }),
    });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
});
