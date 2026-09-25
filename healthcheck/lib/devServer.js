'use strict';

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const { REPO_ROOT, LOCAL_PORT } = require('./constants');

function waitForServer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`http://127.0.0.1:${port}/index.html`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`dev-server.py did not become ready on port ${port} within ${timeoutMs}ms`));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

// Reuses the repo's own dev-server.py (no-cache static file server, already
// tuned to avoid a local filesystem race) instead of adding a Node static-
// server dependency just for this. Returns { url, stop() }.
async function startDevServer(port = LOCAL_PORT) {
  const proc = spawn('python3', ['dev-server.py', String(port)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  const exitedEarly = new Promise((_, reject) => {
    proc.once('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`dev-server.py exited early (code ${code}): ${stderr}`));
    });
  });

  await Promise.race([waitForServer(port), exitedEarly]);

  return {
    url: `http://127.0.0.1:${port}`,
    stop() {
      proc.kill('SIGTERM');
    },
  };
}

module.exports = { startDevServer };
