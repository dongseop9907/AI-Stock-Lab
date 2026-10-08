'use strict';

// V9.7.18.1 local read-only adjustment table DDL extractor.
//
// Goal:
//   Print the exact CREATE TABLE / UNIQUE / CHECK / FK surfaces for:
//     - corporate_action_adjustment_runs
//     - corporate_action_adjustment_factors
//
// Safety:
//   - local filesystem read-only
//   - no DB connection
//   - no network
//   - no env reads
//
// Run:
//   node .\scripts\v9718-1.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_18_1_ADJUSTMENT_DDL_EXTRACTOR';
const RUN_TABLE = 'corporate_action_adjustment_runs';
const FACTOR_TABLE = 'corporate_action_adjustment_factors';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.turbo', '.vercel', '.wrangler', '.cache', 'out', 'logs'
]);

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function walk(root) {
  const files = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');

      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name.startsWith('.') && e.name !== '.github') continue;
        stack.push(full);
        continue;
      }

      if (!e.isFile()) continue;
      if (path.extname(e.name).toLowerCase() !== '.sql') continue;
      files.push({ full, rel });
    }
  }

  return files;
}

function stripComments(sql) {
  return sql
    .replace(/--[^\r\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractCreateTable(sql, table) {
  const cleaned = stripComments(sql);
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?["\`]?${escaped}["\`]?\\s*\\(`,
    'ig'
  );

  const out = [];
  let m;

  while ((m = rx.exec(cleaned))) {
    const open = cleaned.indexOf('(', m.index);
    let depth = 0;
    let quote = null;
    let close = -1;

    for (let i = open; i < cleaned.length; i++) {
      const ch = cleaned[i];
      const prev = i ? cleaned[i - 1] : '';

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
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }

    if (close > open) {
      out.push(cleaned.slice(m.index, close + 1).trim());
      rx.lastIndex = close + 1;
    }
  }

  return out;
}

function splitTopLevel(body) {
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const prev = i ? body[i - 1] : '';

    if (quote) {
      cur += ch;
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }

    if (ch === '(') depth++;
    else if (ch === ')') depth--;

    if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }

    cur += ch;
  }

  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseCreateTable(sql, table) {
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  const body = sql.slice(open + 1, close);

  const columns = [];
  const constraints = [];

  for (const item of splitTopLevel(body)) {
    if (/^(constraint|primary\s+key|unique|foreign\s+key|check)\b/i.test(item)) {
      constraints.push(item.replace(/\s+/g, ' ').trim());
      continue;
    }

    const m = item.match(/^["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+(.+)$/s);
    if (!m) continue;

    columns.push({
      name: m[1],
      definition: m[2].replace(/\s+/g, ' ').trim()
    });
  }

  return { table, columns, constraints };
}

function extractIndexes(sql, table) {
  const cleaned = stripComments(sql);
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(
    `create\\s+(unique\\s+)?index[\\s\\S]{0,1200}?on\\s+(?:public\\.)?["\`]?${escaped}["\`]?\\s*(?:using\\s+\\w+\\s*)?\\([^;]+?\\)\\s*(?:where\\s+[^;]+)?;`,
    'ig'
  );

  const out = [];
  let m;
  while ((m = rx.exec(cleaned))) {
    out.push(m[0].replace(/\s+/g, ' ').trim());
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const files = walk(root);

  const result = {
    version: VERSION,
    status: 'ADJUSTMENT_DDL_EXTRACTED',
    filesScanned: files.length,
    runs: {
      definitions: [],
      indexes: []
    },
    factors: {
      definitions: [],
      indexes: []
    },
    safety: {
      databaseConnected: false,
      networkUsed: false,
      envRead: false,
      writesPerformed: 0
    }
  };

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file.full, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      continue;
    }

    for (const ddl of extractCreateTable(text, RUN_TABLE)) {
      result.runs.definitions.push({
        file: file.rel,
        parsed: parseCreateTable(ddl, RUN_TABLE),
        raw: ddl.replace(/\s+/g, ' ').trim()
      });
    }

    for (const ddl of extractCreateTable(text, FACTOR_TABLE)) {
      result.factors.definitions.push({
        file: file.rel,
        parsed: parseCreateTable(ddl, FACTOR_TABLE),
        raw: ddl.replace(/\s+/g, ' ').trim()
      });
    }

    for (const idx of extractIndexes(text, RUN_TABLE)) {
      result.runs.indexes.push({ file: file.rel, sql: idx });
    }

    for (const idx of extractIndexes(text, FACTOR_TABLE)) {
      result.factors.indexes.push({ file: file.rel, sql: idx });
    }
  }

  if (!result.runs.definitions.length || !result.factors.definitions.length) {
    result.status = 'ADJUSTMENT_DDL_REVIEW_REQUIRED';
  }

  const outFile = path.join(
    root,
    'logs',
    'adjustment-ddl-v9-7-18-1.json'
  );
  saveJson(outFile, result);

  const runDef = result.runs.definitions[0]?.parsed ?? null;
  const factorDef = result.factors.definitions[0]?.parsed ?? null;

  console.log(JSON.stringify({
    status: result.status,
    runColumns: runDef?.columns ?? [],
    runConstraints: runDef?.constraints ?? [],
    runIndexes: result.runs.indexes,
    factorColumns: factorDef?.columns ?? [],
    factorConstraints: factorDef?.constraints ?? [],
    factorIndexes: result.factors.indexes,
    writesPerformed: 0
  }, null, 2));

  console.log('Upload only this report: ' + outFile);

  if (result.status !== 'ADJUSTMENT_DDL_EXTRACTED') {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (err) {
  console.error(
    String(err?.message || err)
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
}
