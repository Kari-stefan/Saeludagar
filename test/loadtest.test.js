// Milestone 8: the load test script (AGENT_START §13, M8). A small run of `npm run loadtest`
// checks BR-32, BR-35 and BR-65 under concurrent sign-ups, and that the script keeps to its own
// temporary database (§10).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT_DIR } from '../src/config.js';

// Runs the script the way `npm run loadtest -- …` does, without reading any .env file.
function loadtest(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/loadtest.js', ...args], { cwd: ROOT_DIR, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('npm run loadtest (M8)', () => {
  let dir;
  let run;

  before(async () => {
    // Settings the script must ignore: a database, upload and backup folder in a folder of our own.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saeludagar-loadtest-env-'));
    run = await loadtest(['--students', '30', '--events', '6', '--window', '1'], {
      DATABASE_PATH: path.join(dir, 'configured.db'),
      UPLOAD_DIR: path.join(dir, 'uploads'),
      BACKUP_DIR: path.join(dir, 'backups'),
    });
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('BR-35, BR-65: a small load run ends with no event over its maximum and no student over the limits', () => {
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /^Result: PASS$/m);
    assert.match(run.stdout, /^5xx responses: 0, network errors: 0, unexpected responses: 0$/m);
    assert.match(run.stdout, /^ {2}OK +BR-35: no event over its maximum$/m);
    assert.match(run.stdout, /^ {2}OK +BR-32: no student over 4 sign-ups$/m);
    assert.match(run.stdout, /^ {2}OK +BR-65: no student over 2 sign-ups on one day$/m);
    assert.match(run.stdout, /^Sign-ups: 180 posts, [1-9]\d* sign-ups created/m);
    for (const kind of ['login', 'front page', 'sign-up']) {
      assert.match(run.stdout, new RegExp(`^ {2}${kind} +count +\\d+ +p50 +\\d+ ms +p95 +\\d+ ms +max +\\d+ ms$`, 'm'), kind);
    }
    assert.doesNotMatch(run.stdout, /0000000001/, 'no kennitala in the report');
  });

  test('§10: the load test never uses the configured database', () => {
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  test('prints the usage on a bad option', async () => {
    for (const args of [['--students', '0'], ['--window', '60'], ['--events', 'x'], ['--speed', '2']]) {
      const { code, stderr } = await loadtest(args, {});
      assert.equal(code, 1, args.join(' '));
      assert.match(stderr, /Usage: npm run loadtest -- \[--students 1000\] \[--events 40\] \[--window 20\]/);
    }
  });
});
