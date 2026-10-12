'use strict';

// V9.7.18 read-only adjustment write-contract discovery.
//
// Goal:
//   Inspect local migrations/code for:
//     - corporate_action_adjustment_runs schema / constraints / indexes
//     - corporate_action_adjustment_factors schema / constraints / indexes
//     - existing write/upsert sites
//   And inspect live Supabase row counts via GET only.
//
// Safety:
//   - local filesystem read-only
//   - Supabase GET only
//   - no INSERT / UPDATE / DELETE / UPSERT
//
// Run:
//   node --env-file=.env.local .\scripts\v9718.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_18_ADJUSTMENT_WRITE_CONTRACT_DISCOVERY';
const RUN_TABLE = 'corporate_action_adjustment_runs';
const FACTOR_TABLE = 'corporate_action_adjustment_factors';

const MAX_FILES = 14000;
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_EVIDENCE = 100;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo',
  '.vercel', '.wrangler', '.cache', 'out', 'logs'
]);

const ALLOWED_EXT = new Set([
  '.sql', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.prisma'
]);

const SENSITIVE = /(^|[\\/])(?:\.env(?:\..*)?|.*(?:secret|credential|private[_-]?key|service[_-]?role).*)$/i;
const SELF = /^v9718\.cjs$/i;

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function requireEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
}

function walk(root) {
  const files = [];
  const stack = [root];

  while (stack.length && files.length < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }

    for (const e of entries) {
      if (files.length >= MAX_FILES) break;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');

      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name.startsWith('.') && e.name !== '.github') continue;
        stack.push(full);
        continue;
      }

      if (!e.isFile()) continue;
      if (SENSITIVE.test(rel) || SELF.test(path.basename(rel))) continue;
      if (!ALLOWED_EXT.has(path.extname(e.name).toLowerCase())) continue;

      let stat;
      try { stat = fs.statSync(full); }
      catch { continue; }

      if (stat.size > MAX_FILE_BYTES) continue;
      files.push({ full, rel, ext: path.extname(e.name).toLowerCase() });
    }
  }

  return files;
}

function lineAt(text, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function context(text, idx, before = 18, after = 30) {
  const lines = text.split(/\r?\n/);
  const line = lineAt(text, idx);
  const start = Math.max(0, line - before - 1);
  const end = Math.min(lines.length, line + after);
  return {
    line,
    text: lines.slice(start, end)
      .map((v, i) => `${start + i + 1}: ${v}`)
      .join('\n')
      .slice(0, 16000)
  };
}

function extractCreateTable(text, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?["\`]?${escaped}["\`]?\\s*\\(`,
    'ig'
  );

  const out = [];
  let m;

  while ((m = rx.exec(text))) {
    const open = text.indexOf('(', m.index);
    let depth = 0, quote = null, close = -1;

    for (let i = open; i < text.length; i++) {
      const ch = text[i];
      const prev = i ? text[i - 1] : '';

      if (quote) {
        if (ch === quote && prev !== '\\') quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }

    if (close > open) {
      out.push(text.slice(m.index, close + 1).replace(/\s+/g, ' ').trim());
      rx.lastIndex = close + 1;
    }
  }

  return out;
}

function scanLocal(root) {
  const files = walk(root);
  const result = {
    filesScanned: files.length,
    ddl: { runs: [], factors: [] },
    indexes: { runs: [], factors: [] },
    writeSites: { runs: [], factors: [] },
    readSites: { runs: [], factors: [] }
  };

  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file.full, 'utf8').replace(/^\uFEFF/, ''); }
    catch { continue; }

    const lower = text.toLowerCase();
    const hasRun = lower.includes(RUN_TABLE);
    const hasFactor = lower.includes(FACTOR_TABLE);
    if (!hasRun && !hasFactor) continue;

    if (file.ext === '.sql') {
      for (const ddl of extractCreateTable(text, RUN_TABLE)) {
        result.ddl.runs.push({ file: file.rel, ddl });
      }
      for (const ddl of extractCreateTable(text, FACTOR_TABLE)) {
        result.ddl.factors.push({ file: file.rel, ddl });
      }

      const idxRx = /create\s+(unique\s+)?index[\s\S]{0,1000}?;/ig;
      let m;
      while ((m = idxRx.exec(text))) {
        const block = m[0].replace(/\s+/g, ' ').trim();
        const low = block.toLowerCase();
        if (low.includes(RUN_TABLE) && result.indexes.runs.length < MAX_EVIDENCE) {
          result.indexes.runs.push({ file: file.rel, sql: block });
        }
        if (low.includes(FACTOR_TABLE) && result.indexes.factors.length < MAX_EVIDENCE) {
          result.indexes.factors.push({ file: file.rel, sql: block });
        }
      }
    }

    for (const [table, bucket] of [
      [RUN_TABLE, 'runs'],
      [FACTOR_TABLE, 'factors']
    ]) {
      const fromRx = new RegExp(
        `\\.from\\s*\\(\\s*['"\`]${table}['"\`]\\s*\\)`,
        'ig'
      );

      let m;
      while ((m = fromRx.exec(text))) {
        const ctx = context(text, m.index);
        const next = text.slice(m.index, Math.min(text.length, m.index + 3000));
        const isWrite = /\.(insert|upsert|update|delete)\s*\(/i.test(next);

        const item = {
          file: file.rel,
          line: ctx.line,
          context: ctx.text
        };

        if (isWrite) {
          if (result.writeSites[bucket].length < MAX_EVIDENCE) {
            result.writeSites[bucket].push(item);
          }
        } else {
          if (result.readSites[bucket].length < MAX_EVIDENCE) {
            result.readSites[bucket].push(item);
          }
        }
      }
    }
  }

  return result;
}

async function liveRead(base, key, table) {
  const url =
    `${base}/rest/v1/${table}?select=*&limit=25`;

  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      Prefer: 'count=exact'
    }
  });

  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : []; }
  catch { throw new Error(`${table.toUpperCase()}_INVALID_JSON`); }

  if (!res.ok) {
    const code = body?.code || `HTTP_${res.status}`;
    throw new Error(`${table.toUpperCase()}_${String(code).replace(/[^A-Za-z0-9_]/g, '_')}`);
  }

  const contentRange = res.headers.get('content-range');
  let total = null;
  if (contentRange && contentRange.includes('/')) {
    const tail = contentRange.split('/').pop();
    if (tail !== '*') total = Number(tail);
  }

  return {
    returnedRows: Array.isArray(body) ? body.length : 0,
    totalRows: Number.isFinite(total) ? total : null,
    sampleRows: Array.isArray(body) ? body : []
  };
}

function detectUniqueHints(local) {
  const allFactor = [
    ...local.ddl.factors.map(x => x.ddl),
    ...local.indexes.factors.map(x => x.sql)
  ].join('\n').toLowerCase();

  const allRun = [
    ...local.ddl.runs.map(x => x.ddl),
    ...local.indexes.runs.map(x => x.sql)
  ].join('\n').toLowerCase();

  return {
    factorAdjustmentRunActionEventUnique:
      /unique\s*\([^)]*adjustment_run_id[^)]*action_event_id[^)]*\)/i.test(allFactor) ||
      /unique[\s\S]{0,300}adjustment_run_id[\s\S]{0,200}action_event_id/i.test(allFactor),
    runUniqueSurfaceDetected:
      /\bunique\b/i.test(allRun),
    runPrimaryKeyDetected:
      /primary\s+key/i.test(allRun)
  };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const outputArg = process.argv.slice(2).find(a => a.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice('--output='.length))
    : path.join(root, 'logs', 'adjustment-write-contract-v9-7-18.json');

  const local = scanLocal(root);
  const { url, key } = requireEnv();

  const [liveRuns, liveFactors] = await Promise.all([
    liveRead(url, key, RUN_TABLE),
    liveRead(url, key, FACTOR_TABLE)
  ]);

  const uniqueHints = detectUniqueHints(local);

  const schemaFound =
    local.ddl.runs.length > 0 &&
    local.ddl.factors.length > 0;

  const status = schemaFound
    ? 'ADJUSTMENT_WRITE_CONTRACT_DISCOVERED'
    : 'ADJUSTMENT_WRITE_CONTRACT_REVIEW_REQUIRED';

  const report = {
    version: VERSION,
    status,
    local: {
      filesScanned: local.filesScanned,
      runTableDefinitions: local.ddl.runs,
      factorTableDefinitions: local.ddl.factors,
      runIndexes: local.indexes.runs,
      factorIndexes: local.indexes.factors,
      runWriteSites: local.writeSites.runs,
      factorWriteSites: local.writeSites.factors,
      runReadSites: local.readSites.runs,
      factorReadSites: local.readSites.factors
    },
    live: {
      adjustmentRuns: liveRuns,
      adjustmentFactors: liveFactors
    },
    contractHints: uniqueHints,
    safety: {
      databaseConnected: true,
      httpMethodsUsed: ['GET'],
      writesPerformed: 0,
      adjustmentRunsInserted: 0,
      adjustmentFactorsInserted: 0,
      productionAppliedRows: 0,
      coveragePromoted: false
    },
    nextGate: status === 'ADJUSTMENT_WRITE_CONTRACT_DISCOVERED'
      ? 'DESIGN_VALIDATION_RUN_IDEMPOTENCY_AND_11_FACTOR_INSERT'
      : 'INSPECT_LIVE_SQL_CONTRACT_BEFORE_ANY_FACTOR_WRITE'
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status,
    filesScanned: local.filesScanned,
    runTableDefinitions: local.ddl.runs.length,
    factorTableDefinitions: local.ddl.factors.length,
    runWriteSites: local.writeSites.runs.length,
    factorWriteSites: local.writeSites.factors.length,
    runLiveRows: liveRuns.totalRows,
    factorLiveRows: liveFactors.totalRows,
    factorAdjustmentRunActionEventUnique:
      uniqueHints.factorAdjustmentRunActionEventUnique,
    runUniqueSurfaceDetected:
      uniqueHints.runUniqueSurfaceDetected,
    writesPerformed: 0,
    adjustmentRunsInserted: 0,
    adjustmentFactorsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' + outputFile
  );

  if (status !== 'ADJUSTMENT_WRITE_CONTRACT_DISCOVERED') {
    process.exitCode = 2;
  }
}

main().catch(err => {
  console.error(
    String(err?.message || err)
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
});
