\
'use strict';

// V9.7.7 read-only DB contract discovery probe.
// Purpose:
//   - Inspect local SQL/migration/schema/code files for the existing corporate-action/event storage contract.
//   - Discover candidate tables, columns, unique constraints/indexes, RLS/policies, and Supabase .from() references.
//   - Compare the discovered schema surface with the finalized V9.7.6 canonical sample.
// Safety:
//   - NO database connection
//   - NO network requests
//   - NO INSERT / UPDATE / DELETE / UPSERT
//   - NO .env contents are read or emitted
//   - NO coverage promotion

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_7_DB_CONTRACT_PROBE';
const CANONICAL_VERSION = 'V9_7_6_CANONICAL_SAMPLE_FINALIZATION_PROBE';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 12000;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo',
  '.vercel', '.wrangler', '.cache', 'out', 'logs'
]);

const ALLOWED_EXT = new Set([
  '.sql', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.json', '.prisma'
]);

const SENSITIVE_NAME = /(^|[\\/])(?:\.env(?:\..*)?|.*(?:secret|credential|private[_-]?key|service[_-]?role).*)$/i;

const ACTION_KEYWORDS = [
  'corporate_action', 'corporate-action', 'corporateaction',
  'stock_split', 'reverse_split', 'cash_dividend', 'stock_dividend',
  'rights_issue', 'spin_off', 'spinoff', 'merger',
  'effective_date', 'record_date', 'ex_date', 'listing_date',
  'source_receipt', 'receipt_no', 'rcept_no'
];

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'DB_CONTRACT_PROBE_FAILED';
}

function save(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function normalizeIdent(v) {
  return String(v ?? '')
    .trim()
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/^public\./i, '')
    .toLowerCase();
}

function cleanSql(sql) {
  return sql
    .replace(/--[^\r\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitTopLevelCsv(text) {
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i ? text[i - 1] : '';

    if (quote) {
      cur += ch;
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }

    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);

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

function findCreateTableBlocks(sql) {
  const cleaned = cleanSql(sql);
  const rx = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)\s*\(/ig;
  const blocks = [];
  let m;

  while ((m = rx.exec(cleaned))) {
    const open = rx.lastIndex - 1;
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

      if (ch === '"' || ch === "'") {
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
      blocks.push({
        rawName: m[1],
        tableName: normalizeIdent(m[1]),
        body: cleaned.slice(open + 1, close)
      });
      rx.lastIndex = close + 1;
    }
  }

  return blocks;
}

function parseTableBody(body) {
  const columns = [];
  const constraints = [];
  const items = splitTopLevelCsv(body);

  for (const item of items) {
    const s = item.trim();
    if (!s) continue;

    if (/^(?:constraint\b|primary\s+key\b|unique\b|foreign\s+key\b|check\b)/i.test(s)) {
      constraints.push(s.replace(/\s+/g, ' ').trim());
      continue;
    }

    const m = s.match(/^["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+(.+)$/s);
    if (!m) continue;

    const name = normalizeIdent(m[1]);
    const rest = m[2].replace(/\s+/g, ' ').trim();
    const typeMatch = rest.match(/^([A-Za-z0-9_\[\]\(\), ]+?)(?=\s+(?:not\s+null|null|default|primary\s+key|unique|references|check|generated|collate)\b|$)/i);

    columns.push({
      name,
      type: (typeMatch ? typeMatch[1] : rest).trim(),
      notNull: /\bnot\s+null\b/i.test(rest),
      primaryKey: /\bprimary\s+key\b/i.test(rest),
      unique: /\bunique\b/i.test(rest),
      references: (rest.match(/\breferences\s+((?:"?[\w-]+"?\.)?"?[\w-]+"?)\s*\(([^)]+)\)/i) || []).slice(1, 3)
    });
  }

  return { columns, constraints };
}

function parseIndexes(sql) {
  const cleaned = cleanSql(sql);
  const out = [];
  const rx = /\bcreate\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?["`]?([\w-]+)["`]?\s+on\s+((?:"?[\w-]+"?\.)?"?[\w-]+"?)\s*(?:using\s+\w+\s*)?\(([^;]+?)\)(?:\s+where\s+([^;]+))?\s*;/ig;
  let m;
  while ((m = rx.exec(cleaned))) {
    out.push({
      unique: !!m[1],
      indexName: normalizeIdent(m[2]),
      tableName: normalizeIdent(m[3]),
      expression: m[4].replace(/\s+/g, ' ').trim(),
      where: m[5] ? m[5].replace(/\s+/g, ' ').trim() : null
    });
  }
  return out;
}

function parseAlterConstraints(sql) {
  const cleaned = cleanSql(sql);
  const out = [];
  const rx = /\balter\s+table\s+(?:only\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)\s+add\s+(?:constraint\s+["`]?([\w-]+)["`]?\s+)?(unique|primary\s+key|foreign\s+key|check)\s*(\([^;]+?\)|[^;]+?)\s*;/ig;
  let m;
  while ((m = rx.exec(cleaned))) {
    out.push({
      tableName: normalizeIdent(m[1]),
      constraintName: m[2] ? normalizeIdent(m[2]) : null,
      kind: m[3].toUpperCase().replace(/\s+/g, '_'),
      definition: m[4].replace(/\s+/g, ' ').trim()
    });
  }
  return out;
}

function parseRlsAndPolicies(sql) {
  const cleaned = cleanSql(sql);
  const rls = [];
  const policies = [];

  const rlsRx = /\balter\s+table\s+(?:only\s+)?((?:"?[\w-]+"?\.)?"?[\w-]+"?)\s+(enable|disable|force|no\s+force)\s+row\s+level\s+security\s*;/ig;
  let m;
  while ((m = rlsRx.exec(cleaned))) {
    rls.push({
      tableName: normalizeIdent(m[1]),
      mode: m[2].toUpperCase().replace(/\s+/g, '_')
    });
  }

  const polRx = /\bcreate\s+policy\s+["`]?([^"`\r\n]+?)["`]?\s+on\s+((?:"?[\w-]+"?\.)?"?[\w-]+"?)([\s\S]*?);/ig;
  while ((m = polRx.exec(cleaned))) {
    policies.push({
      policyName: m[1].trim(),
      tableName: normalizeIdent(m[2]),
      definition: m[3].replace(/\s+/g, ' ').trim().slice(0, 1200)
    });
  }

  return { rls, policies };
}

function parseSupabaseFromRefs(text) {
  const out = [];
  const rx = /\.from\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  let m;
  while ((m = rx.exec(text))) {
    out.push(normalizeIdent(m[2]));
  }
  return out;
}

function keywordScore(text, tableName = '') {
  const lower = `${tableName}\n${text}`.toLowerCase();
  let score = 0;
  const hits = [];
  for (const kw of ACTION_KEYWORDS) {
    if (lower.includes(kw)) {
      score++;
      hits.push(kw);
    }
  }
  return { score, hits };
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
      if (e.name === '.' || e.name === '..') continue;

      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');

      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name.startsWith('.') && e.name !== '.github') continue;
        stack.push(full);
        continue;
      }

      if (!e.isFile()) continue;
      if (SENSITIVE_NAME.test(rel)) continue;

      const ext = path.extname(e.name).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;

      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.size > MAX_FILE_BYTES) continue;

      files.push({ full, rel, ext, size: stat.size });
    }
  }

  return files;
}

function loadCanonical(root, args) {
  const a = args.find(x => x.startsWith('--canonical='));
  const file = a
    ? path.resolve(a.slice('--canonical='.length))
    : path.join(root, 'logs', 'corporate-action-canonical-sample-v9-7-6.json');

  const body = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!body || body.version !== CANONICAL_VERSION || !Array.isArray(body.records)) {
    throw new Error('INVALID_V9_7_6_CANONICAL_REPORT');
  }
  if (body.summary?.unresolvedCandidates !== 0 || body.summary?.errors !== 0) {
    throw new Error('CANONICAL_SAMPLE_NOT_CLOSED');
  }
  return { file, body };
}

function inferCanonicalEventShape(canonical) {
  const events = canonical.records
    .filter(r => r.finalStatus === 'VALIDATED' && r.event && typeof r.event === 'object')
    .map(r => r.event);

  const fields = new Map();
  for (const event of events) {
    for (const [k, v] of Object.entries(event)) {
      const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
      if (!fields.has(k)) fields.set(k, new Set());
      fields.get(k).add(t);
    }
  }

  return {
    validatedEvents: events.length,
    fields: [...fields.entries()].map(([name, types]) => ({ name, types: [...types].sort() }))
  };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  if (args.some(a => !a.startsWith('--canonical=') && !a.startsWith('--output='))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const canonical = loadCanonical(root, args);
  const eventShape = inferCanonicalEventShape(canonical.body);

  const outputArg = args.find(x => x.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice('--output='.length))
    : path.join(root, 'logs', 'corporate-action-db-contract-probe-v9-7-7.json');

  const files = walk(root);

  const tableMap = new Map();
  const indexes = [];
  const alterConstraints = [];
  const rls = [];
  const policies = [];
  const fromRefs = new Map();
  const keywordFiles = [];

  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f.full, 'utf8').replace(/^\uFEFF/, ''); }
    catch { continue; }

    const score = keywordScore(text);
    if (score.score) {
      keywordFiles.push({
        file: f.rel,
        keywordScore: score.score,
        keywordHits: score.hits.slice(0, 20),
        sha256: sha256(text)
      });
    }

    for (const ref of parseSupabaseFromRefs(text)) {
      if (!fromRefs.has(ref)) fromRefs.set(ref, new Set());
      fromRefs.get(ref).add(f.rel);
    }

    if (f.ext !== '.sql') continue;

    for (const block of findCreateTableBlocks(text)) {
      const parsed = parseTableBody(block.body);
      const tableScore = keywordScore(block.body, block.tableName);

      if (!tableMap.has(block.tableName)) {
        tableMap.set(block.tableName, {
          tableName: block.tableName,
          createTableFiles: [],
          columns: new Map(),
          inlineConstraints: [],
          keywordScore: 0,
          keywordHits: new Set()
        });
      }

      const t = tableMap.get(block.tableName);
      t.createTableFiles.push(f.rel);
      t.keywordScore = Math.max(t.keywordScore, tableScore.score);
      for (const h of tableScore.hits) t.keywordHits.add(h);

      for (const c of parsed.columns) {
        if (!t.columns.has(c.name)) t.columns.set(c.name, c);
      }
      for (const c of parsed.constraints) {
        if (!t.inlineConstraints.includes(c)) t.inlineConstraints.push(c);
      }
    }

    indexes.push(...parseIndexes(text).map(x => ({ ...x, file: f.rel })));
    alterConstraints.push(...parseAlterConstraints(text).map(x => ({ ...x, file: f.rel })));

    const rp = parseRlsAndPolicies(text);
    rls.push(...rp.rls.map(x => ({ ...x, file: f.rel })));
    policies.push(...rp.policies.map(x => ({ ...x, file: f.rel })));
  }

  const allTableNames = new Set([
    ...tableMap.keys(),
    ...indexes.map(x => x.tableName),
    ...alterConstraints.map(x => x.tableName),
    ...rls.map(x => x.tableName),
    ...policies.map(x => x.tableName),
    ...fromRefs.keys()
  ]);

  const tables = [...allTableNames].map(name => {
    const base = tableMap.get(name);
    const refs = [...(fromRefs.get(name) || [])];
    const idx = indexes.filter(x => x.tableName === name);
    const cons = alterConstraints.filter(x => x.tableName === name);
    const rr = rls.filter(x => x.tableName === name);
    const pp = policies.filter(x => x.tableName === name);

    const surface = JSON.stringify({
      name,
      columns: base ? [...base.columns.values()] : [],
      constraints: base?.inlineConstraints || [],
      indexes: idx,
      alterConstraints: cons,
      refs
    });
    const kw = keywordScore(surface, name);

    const uniqueSurfaces = [
      ...(base?.inlineConstraints || []).filter(x => /\bunique\b|\bprimary\s+key\b/i.test(x))
        .map(definition => ({ source: 'CREATE_TABLE', definition })),
      ...idx.filter(x => x.unique)
        .map(x => ({ source: 'UNIQUE_INDEX', name: x.indexName, definition: x.expression, where: x.where, file: x.file })),
      ...cons.filter(x => x.kind === 'UNIQUE' || x.kind === 'PRIMARY_KEY')
        .map(x => ({ source: 'ALTER_TABLE', name: x.constraintName, definition: x.definition, file: x.file })),
      ...((base ? [...base.columns.values()] : [])
        .filter(c => c.unique || c.primaryKey)
        .map(c => ({ source: 'COLUMN', column: c.name, unique: c.unique, primaryKey: c.primaryKey })))
    ];

    return {
      tableName: name,
      createTableFiles: base?.createTableFiles || [],
      columns: base ? [...base.columns.values()] : [],
      uniqueSurfaces,
      indexes: idx,
      alterConstraints: cons,
      rls: rr,
      policies: pp,
      supabaseFromReferences: refs,
      corporateActionRelevanceScore: Math.max(base?.keywordScore || 0, kw.score),
      corporateActionKeywordHits: [...new Set([...(base ? [...base.keywordHits] : []), ...kw.hits])].slice(0, 30)
    };
  });

  tables.sort((a, b) =>
    b.corporateActionRelevanceScore - a.corporateActionRelevanceScore ||
    b.supabaseFromReferences.length - a.supabaseFromReferences.length ||
    a.tableName.localeCompare(b.tableName)
  );

  const relevantTables = tables.filter(t =>
    t.corporateActionRelevanceScore > 0 ||
    /(?:corporate|action|event|adjust|dividend|split|merger)/i.test(t.tableName)
  );

  const storageCandidates = relevantTables.filter(t => {
    const cols = new Set(t.columns.map(c => c.name));
    return (
      cols.has('effective_date') ||
      cols.has('action_type') ||
      cols.has('event_type') ||
      cols.has('receipt_no') ||
      cols.has('rcept_no') ||
      cols.has('source_receipt_no') ||
      /corporate.*action|action.*event|market.*event/i.test(t.tableName)
    );
  });

  const hasUniqueCandidate = storageCandidates.some(t =>
    t.uniqueSurfaces.length > 0
  );

  let status;
  if (storageCandidates.length === 1 && hasUniqueCandidate) {
    status = 'DB_CONTRACT_CANDIDATE_DISCOVERED';
  } else if (storageCandidates.length >= 1) {
    status = 'DB_CONTRACT_REQUIRES_REVIEW';
  } else {
    status = 'NO_CORPORATE_ACTION_STORAGE_CONTRACT_FOUND';
  }

  const state = {
    version: VERSION,
    status,
    root: '.',
    scope: 'LOCAL_SCHEMA_AND_CODE_READ_ONLY',
    canonicalSample: {
      version: canonical.body.version,
      sampleHash: canonical.body.sampleHash,
      validatedEvents: canonical.body.summary?.validatedEvents ?? eventShape.validatedEvents,
      rejectedCandidates: canonical.body.summary?.rejectedCandidates ?? null,
      unresolvedCandidates: canonical.body.summary?.unresolvedCandidates ?? null,
      errors: canonical.body.summary?.errors ?? null,
      canonicalEventShape: eventShape
    },
    scan: {
      filesScanned: files.length,
      keywordRelevantFiles: keywordFiles.length,
      sqlCreateTablesFound: tableMap.size,
      tableNamesObserved: tables.length,
      storageCandidatesFound: storageCandidates.length
    },
    storageCandidates,
    relevantTables: relevantTables.slice(0, 40),
    keywordRelevantFiles: keywordFiles
      .sort((a, b) => b.keywordScore - a.keywordScore || a.file.localeCompare(b.file))
      .slice(0, 120),
    safety: {
      databaseConnected: false,
      networkUsed: false,
      envRead: false,
      secretsEmitted: false,
      writesPerformed: 0,
      eventRowsInserted: 0,
      coveragePromoted: false
    },
    nextGate: 'REQUIRE_EXPLICIT_TABLE_AND_IDEMPOTENCY_CONTRACT_BEFORE_ANY_INSERT'
  };

  save(outputFile, state);

  console.log(JSON.stringify({
    status: state.status,
    filesScanned: state.scan.filesScanned,
    sqlCreateTablesFound: state.scan.sqlCreateTablesFound,
    storageCandidatesFound: state.scan.storageCandidatesFound,
    candidateTables: state.storageCandidates.map(t => ({
      tableName: t.tableName,
      columns: t.columns.map(c => c.name),
      uniqueSurfaces: t.uniqueSurfaces
    })),
    eventRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log('Upload only this report (no .env files): ' + outputFile);

  if (state.status === 'NO_CORPORATE_ACTION_STORAGE_CONTRACT_FOUND') {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  }
}

module.exports = {
  normalizeIdent,
  cleanSql,
  splitTopLevelCsv,
  findCreateTableBlocks,
  parseTableBody,
  parseIndexes,
  parseAlterConstraints,
  parseRlsAndPolicies,
  parseSupabaseFromRefs,
  keywordScore,
  inferCanonicalEventShape
};
