#!/usr/bin/env node
/* ============================================================
   Xadrez Royale 3D — Unified E2E Test Runner
   Usage:
     node tests/e2e/run-e2e.mjs
     node tests/e2e/run-e2e.mjs --tier=1
     node tests/e2e/run-e2e.mjs --tier=1,2
   ============================================================ */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  let tiers = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--tier=')) {
      tiers = a.slice('--tier='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--tier' && argv[i + 1]) {
      tiers = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (tiers) {
    for (const t of tiers) {
      if (!/^[1-4]$/.test(t)) {
        console.error(`Invalid --tier value "${t}". Expected 1, 2, 3, or 4.`);
        process.exit(2);
      }
    }
  }
  return { tiers };
}

function discoverTierFiles(tiers) {
  const entries = fs.readdirSync(__dirname, { withFileTypes: true });
  const all = entries
    .filter((e) => e.isFile() && /^tier\d+.*\.test\.mjs$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (!tiers) return all.map((name) => path.join(__dirname, name));

  const wanted = new Set(tiers);
  return all
    .filter((name) => {
      const m = name.match(/^tier(\d+)/);
      return m && wanted.has(m[1]);
    })
    .map((name) => path.join(__dirname, name));
}

function runTestFile(filePath) {
  const start = Date.now();
  return new Promise((resolve) => {
    const proc = spawn(
      process.execPath,
      ['--test', '--test-concurrency=1', '--test-reporter=spec', filePath],
      { cwd: REPO_ROOT, stdio: 'inherit' }
    );
    proc.once('exit', (code, signal) => {
      resolve({
        file: path.relative(REPO_ROOT, filePath),
        code: code ?? (signal ? 1 : 0),
        durationMs: Date.now() - start
      });
    });
  });
}

async function main() {
  const { tiers } = parseArgs(process.argv.slice(2));
  const files = discoverTierFiles(tiers);

  if (files.length === 0) {
    const scope = tiers ? `tier(s) ${tiers.join(', ')}` : 'any tier*.test.mjs';
    console.error(`No E2E test files found in ${__dirname} matching ${scope}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n=== Xadrez Royale E2E Runner (${files.length} suite${files.length > 1 ? 's' : ''}) ===`);
  const results = [];
  for (const f of files) {
    console.log(`\n>>> Running ${path.relative(REPO_ROOT, f)}`);
    const res = await runTestFile(f);
    results.push(res);
  }

  console.log('\n=== E2E Summary ===');
  let failed = 0;
  let totalMs = 0;
  for (const r of results) {
    totalMs += r.durationMs;
    const status = r.code === 0 ? 'PASS' : `FAIL (exit ${r.code})`;
    if (r.code !== 0) failed++;
    console.log(`  [${status}] ${r.file} (${(r.durationMs / 1000).toFixed(2)}s)`);
  }
  console.log(`Total: ${results.length - failed}/${results.length} suites passed in ${(totalMs / 1000).toFixed(2)}s\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
