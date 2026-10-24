#!/usr/bin/env node
// Creates the first platform_admin. CLI ONLY: there is deliberately no HTTP
// route for this, and /auth/register refuses role=platform_admin.
//
// Usage:
//   node scripts/bootstrap-admin.mjs --email <email> [--local] [--apply] [--print-hash] [--db <name>]
//
//   default       check, then print the SQL with the password hash redacted
//   --print-hash  print the SQL including the hash (to run it yourself)
//   --apply       run the SQL via `wrangler d1 execute` (hash never printed)
//   --local       target local D1 instead of remote
//
// Password: read from BOOTSTRAP_ADMIN_PASSWORD if set, otherwise prompted on
// stdin without echo. The password is never printed.
//
// Refuses to run if a platform_admin already exists. The INSERT also carries
// a WHERE NOT EXISTS guard, so a stale or replayed copy of the SQL cannot
// create a second admin.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/auth/password.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DB = 'autism-app-marketplace-db';
// Same rules as src/routes/auth.js, plus no quotes so the email is safe in SQL.
const EMAIL_RE = /^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 1024;

function fail(message) {
  console.error(`bootstrap-admin: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { email: '', local: false, apply: false, printHash: false, db: DEFAULT_DB };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--email') opts.email = argv[++i] || '';
    else if (arg === '--local') opts.local = true;
    else if (arg === '--apply') opts.apply = true;
    else if (arg === '--print-hash') opts.printHash = true;
    else if (arg === '--db') opts.db = argv[++i] || '';
    else fail(`unknown argument: ${arg}`);
  }
  opts.email = opts.email.trim().toLowerCase();
  if (!EMAIL_RE.test(opts.email) || opts.email.length > 254) fail('--email <valid address> is required');
  if (!opts.db) fail('--db requires a value');
  return opts;
}

function wrangler(opts, extra) {
  const args = ['wrangler', 'd1', 'execute', opts.db, opts.local ? '--local' : '--remote', '--yes', ...extra];
  return execFileSync('npx', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function query(opts, sql) {
  const parsed = JSON.parse(wrangler(opts, ['--json', '--command', sql]));
  return (Array.isArray(parsed) ? parsed[0] : parsed).results || [];
}

// Reads one line from a TTY without echoing it.
function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('stdin is not a TTY; set BOOTSTRAP_ADMIN_PASSWORD instead'));
      return;
    }
    process.stderr.write(label);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          done();
          resolve(value);
          return;
        }
        if (ch === '\u0003') { // Ctrl-C
          done();
          reject(new Error('cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    const done = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
    };
    stdin.on('data', onData);
  });
}

async function readPassword() {
  if (process.env.BOOTSTRAP_ADMIN_PASSWORD !== undefined) return process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const first = await promptHidden('Password: ');
  const second = await promptHidden('Confirm password: ');
  if (first !== second) fail('passwords do not match');
  return first;
}

function insertSql(id, email, hash) {
  return `INSERT INTO users (id, email, password_hash, role, school_id)
SELECT '${id}', '${email}', '${hash}', 'platform_admin', NULL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'platform_admin');`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = `${opts.db} (${opts.local ? 'local' : 'remote'})`;

  const admins = query(opts, "SELECT COUNT(*) AS n FROM users WHERE role = 'platform_admin'");
  if (admins[0] && admins[0].n > 0) {
    fail(`refusing: ${target} already has a platform_admin. Add further admins by hand, deliberately.`);
  }
  const existing = query(opts, `SELECT COUNT(*) AS n FROM users WHERE email = '${opts.email}'`);
  if (existing[0] && existing[0].n > 0) fail(`refusing: ${opts.email} is already registered in ${target}`);

  let password;
  try {
    password = await readPassword();
  } catch (err) {
    fail(err.message);
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    fail(`password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters`);
  }

  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  const sql = insertSql(id, opts.email, hash);

  if (opts.apply) {
    // Written to a private temp file rather than passed as --command, so the
    // hash does not appear in the process list.
    const dir = mkdtempSync(join(tmpdir(), 'bootstrap-admin-'));
    const file = join(dir, 'admin.sql');
    try {
      writeFileSync(file, sql + '\n', { mode: 0o600 });
      wrangler(opts, [`--file=${file}`]);
    } catch {
      fail(`wrangler d1 execute failed against ${target}; no admin was created`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const check = query(opts, `SELECT id, role FROM users WHERE email = '${opts.email}'`);
    if (!check[0] || check[0].role !== 'platform_admin') fail('insert did not take effect (another platform_admin may have been created concurrently)');
    console.log(`created platform_admin ${opts.email} (id ${id}) in ${target}`);
    return;
  }

  console.log(`-- platform_admin for ${opts.email} on ${target}`);
  if (opts.printHash) {
    console.log(sql);
  } else {
    console.log(insertSql(id, opts.email, '<redacted: re-run with --print-hash or use --apply>'));
    console.log('-- print-only: nothing was written. Use --apply to create the admin.');
  }
}

main().catch((err) => fail(err.message));
