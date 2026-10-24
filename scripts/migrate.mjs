#!/usr/bin/env node
// D1 migration runner.
//
// SAFE TO RUN TWICE: it applies only migrations/*.sql files whose name is not
// yet in the _migrations table, one at a time, in filename order, and records
// each name only after its file succeeded. A second run prints "skipped" for
// everything already applied and changes nothing.
//
// Usage:
//   node scripts/migrate.mjs            # remote D1 (npm run migrate:remote)
//   node scripts/migrate.mjs --local    # local D1  (npm run migrate:local)
//   node scripts/migrate.mjs --db <name>
//
// Bootstrap: before 004_usage_and_invites.sql there was no _migrations table
// and 001-003 were applied by hand. If _migrations is missing but the `users`
// table exists (created by 003), the database is treated as having 001-003
// applied, so 003_auth.sql (which is NOT idempotent) is never re-run.
//
// Exits non-zero on the first failure; the failed file is not recorded.
// All wrangler calls use execFileSync with an argument array, never a shell.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');
const DEFAULT_DB = 'autism-app-marketplace-db';
const NAME_RE = /^\d{3}_[a-z0-9_]+\.sql$/;
const LEGACY = ['001_init.sql', '002_seed_apps.sql', '003_auth.sql'];
const TRACKING_DDL = `CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`;

function parseArgs(argv) {
  const opts = { local: false, db: DEFAULT_DB };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--local') opts.local = true;
    else if (argv[i] === '--remote') opts.local = false;
    else if (argv[i] === '--db') opts.db = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!opts.db) throw new Error('--db requires a value');
  return opts;
}

function wrangler(opts, extra, { capture = false } = {}) {
  const args = ['wrangler', 'd1', 'execute', opts.db, opts.local ? '--local' : '--remote', '--yes', ...extra];
  return execFileSync('npx', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'inherit', 'inherit'],
  });
}

function query(opts, sql) {
  const out = wrangler(opts, ['--json', '--command', sql], { capture: true });
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed[0] : parsed).results || [];
}

function appliedMigrations(opts) {
  const tables = query(opts, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('_migrations', 'users')")
    .map((r) => r.name);
  if (tables.includes('_migrations')) {
    return new Set(query(opts, 'SELECT name FROM _migrations').map((r) => r.name));
  }
  if (tables.includes('users')) {
    console.log('note: no _migrations table but `users` exists; treating 001-003 as already applied');
    return new Set(LEGACY);
  }
  return new Set();
}

function record(opts, name) {
  // name is checked against NAME_RE, so it cannot contain a quote.
  wrangler(opts, ['--command', TRACKING_DDL], { capture: true });
  wrangler(opts, ['--command', `INSERT OR IGNORE INTO _migrations (name) VALUES ('${name}')`], { capture: true });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (!NAME_RE.test(f)) throw new Error(`Refusing migration with unexpected filename: ${f}`);
  }

  console.log(`target: ${opts.db} (${opts.local ? 'local' : 'remote'})`);
  const applied = appliedMigrations(opts);

  for (const name of files) {
    if (applied.has(name)) {
      console.log(`skipped ${name} (already applied)`);
      continue;
    }
    try {
      wrangler(opts, [`--file=${relative(ROOT, join(MIGRATIONS_DIR, name))}`]);
    } catch {
      console.error(`FAILED ${name} - not recorded; stopping`);
      process.exit(1);
    }
    try {
      record(opts, name);
    } catch {
      console.error(`FAILED to record ${name} in _migrations after it was applied; record it by hand before re-running`);
      process.exit(1);
    }
    console.log(`applied ${name}`);
  }
}

try {
  main();
} catch (err) {
  console.error(`migrate: ${err.message}`);
  process.exit(1);
}
