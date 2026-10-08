'use strict';

// V9.7.18.2 read-only adjustment run/cumulative semantics probe.
//
// Goals:
//   1) Confirm how the 15 validation events group by stock_code.
//   2) Find project evidence for:
//        - cumulative_price_factor / cumulative_share_factor accumulation order
//        - READY / BLOCKED_UNSUPPORTED_ACTION run-status semantics
//   3) Determine how many per-stock validation runs are required.
//
// Safety:
//   - local filesystem read-only
//   - Supabase GET only
//   - no INSERT / UPDATE / DELETE / UPSERT
//
// Run:
//   node --env-file=.env.local .\scripts\v9718-2.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_18_2_RUN_AND_CUMULATIVE_SEMANTICS_PROBE';
const EVENT_TABLE = 'corporate_action_events';
const PROVIDER = 'DART_KRX_CANONICAL';

const SUPPORTED = new Set([
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
  'STOCK_DIVIDEND',
  'CASH_DIVIDEND'
]);

const STRUCTURAL = new Set([
  'MERGER',
  'SPIN_OFF'
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.turbo', '.vercel', '.wrangler', '.cache', 'out', 'logs'
]);

const EXT = new Set([
  '.sql', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.prisma'
]);

const SENSITIVE =
  /(^|[\\/])(?:\.env(?:\..*)?|.*(?:secret|credential|private[_-]?key|service[_-]?role).*)$/i;

const SELF = /^v9718-2\.cjs$/i;
const MAX_FILES = 15000;
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_EVIDENCE = 120;

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
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
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

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
      if (!EXT.has(path.extname(e.name).toLowerCase())) continue;

      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }

      if (stat.size > MAX_FILE_BYTES) continue;
      files.push({ full, rel });
    }
  }

  return files;
}

function lineNo(text, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

function context(text, idx, before = 12, after = 18) {
  const lines = text.split(/\r?\n/);
  const line = lineNo(text, idx);
  const start = Math.max(0, line - before - 1);
  const end = Math.min(lines.length, line + after);

  return {
    line,
    text: lines
      .slice(start, end)
      .map((v, i) => `${start + i + 1}: ${v}`)
      .join('\n')
      .slice(0, 12000)
  };
}

function push(arr, item) {
  if (arr.length < MAX_EVIDENCE) arr.push(item);
}

function scanLocal(root) {
  const files = walk(root);

  const evidence = {
    cumulativePrice: [],
    cumulativeShare: [],
    readyStatus: [],
    blockedStatus: [],
    factorOrdering: [],
    runLifecycle: []
  };

  const patterns = [
    ['cumulativePrice', /cumulative_price_factor/ig],
    ['cumulativeShare', /cumulative_share_factor/ig],
    ['readyStatus', /\bREADY\b/ig],
    ['blockedStatus', /\bBLOCKED_UNSUPPORTED_ACTION\b/ig],
    ['factorOrdering', /(effective_date[\s\S]{0,300}(asc|desc)|(asc|desc)[\s\S]{0,300}effective_date)/ig],
    ['runLifecycle', /(supported_event_count|unsupported_event_count|factor_count|event_count)/ig]
  ];

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file.full, 'utf8').replace(/^\uFEFF/, '');
    } catch {
      continue;
    }

    const lower = text.toLowerCase();
    const relevant =
      lower.includes('corporate_action_adjustment') ||
      lower.includes('cumulative_price_factor') ||
      lower.includes('cumulative_share_factor') ||
      lower.includes('blocked_unsupported_action');

    if (!relevant) continue;

    for (const [bucket, rx] of patterns) {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(text))) {
        const ctx = context(text, m.index);
        push(evidence[bucket], {
          file: file.rel,
          line: ctx.line,
          match: m[0].slice(0, 300),
          context: ctx.text
        });
        if (m.index === rx.lastIndex) rx.lastIndex++;
      }
    }
  }

  return { filesScanned: files.length, evidence };
}

async function getArray(url, key) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('INVALID_SUPABASE_JSON_RESPONSE');
  }

  if (!res.ok) {
    const code = body?.code || `HTTP_${res.status}`;
    throw new Error(
      String(code).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
    );
  }

  if (!Array.isArray(body)) throw new Error('EXPECTED_ARRAY_RESPONSE');
  return body;
}

async function readValidationEvents(base, key) {
  const select = [
    'id',
    'stock_code',
    'action_type',
    'effective_date',
    'provider_event_id',
    'status',
    'is_validation',
    'production_applied'
  ].join(',');

  const url =
    `${base}/rest/v1/${EVENT_TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false` +
    `&order=stock_code.asc,effective_date.asc,provider_event_id.asc`;

  return getArray(url, key);
}

function groupEvents(events) {
  const map = new Map();

  for (const e of events) {
    if (!map.has(e.stock_code)) {
      map.set(e.stock_code, {
        stockCode: e.stock_code,
        events: [],
        supportedEvents: 0,
        structuralEvents: 0,
        otherEvents: 0
      });
    }

    const g = map.get(e.stock_code);
    const cls =
      SUPPORTED.has(e.action_type) ? 'SUPPORTED_FACTOR' :
      STRUCTURAL.has(e.action_type) ? 'STRUCTURAL_EXCLUSION' :
      'OTHER';

    if (cls === 'SUPPORTED_FACTOR') g.supportedEvents++;
    else if (cls === 'STRUCTURAL_EXCLUSION') g.structuralEvents++;
    else g.otherEvents++;

    g.events.push({
      id: e.id,
      actionType: e.action_type,
      effectiveDate: e.effective_date,
      providerEventId: e.provider_event_id,
      class: cls
    });
  }

  return [...map.values()].sort((a, b) =>
    a.stockCode.localeCompare(b.stockCode)
  );
}

function inferEvidence(local) {
  const cp = local.evidence.cumulativePrice
    .map(x => x.context)
    .join('\n')
    .toLowerCase();

  const cs = local.evidence.cumulativeShare
    .map(x => x.context)
    .join('\n')
    .toLowerCase();

  const all = `${cp}\n${cs}`;

  const multiplicationEvidence =
    /cumulative[\s\S]{0,250}\*[\s\S]{0,250}event_|event_[\s\S]{0,250}\*[\s\S]{0,250}cumulative/i
      .test(all);

  const explicitInitOne =
    /(cumulative_price_factor|cumulative_share_factor)[\s\S]{0,200}(1(?:\.0+)?)/i
      .test(all);

  const statusContexts = [
    ...local.evidence.readyStatus,
    ...local.evidence.blockedStatus,
    ...local.evidence.runLifecycle
  ].map(x => x.context).join('\n');

  const explicitStatusAssignment =
    /(status\s*[:=]\s*['"`](READY|BLOCKED_UNSUPPORTED_ACTION)['"`]|['"`](READY|BLOCKED_UNSUPPORTED_ACTION)['"`]\s*as\s+status)/i
      .test(statusContexts);

  return {
    cumulativeMultiplicationEvidence: multiplicationEvidence,
    cumulativeInitializationAtOneEvidence: explicitInitOne,
    explicitRunStatusAssignmentEvidence: explicitStatusAssignment
  };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  if (args.some(a => !a.startsWith('--output='))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const outputArg = args.find(a => a.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice('--output='.length))
    : path.join(
        root,
        'logs',
        'adjustment-run-semantics-v9-7-18-2.json'
      );

  const local = scanLocal(root);
  const { url, key } = requireEnv();
  const events = await readValidationEvents(url, key);

  if (events.length !== 15) {
    throw new Error('EXPECTED_15_VALIDATION_EVENTS');
  }

  const groups = groupEvents(events);
  const evidenceSummary = inferEvidence(local);

  const groupsWithStructural = groups.filter(g => g.structuralEvents > 0);
  const groupsSupportedOnly = groups.filter(
    g => g.supportedEvents > 0 && g.structuralEvents === 0 && g.otherEvents === 0
  );
  const groupsStructuralOnly = groups.filter(
    g => g.structuralEvents > 0 && g.supportedEvents === 0 && g.otherEvents === 0
  );

  const semanticsProven =
    evidenceSummary.cumulativeMultiplicationEvidence &&
    evidenceSummary.explicitRunStatusAssignmentEvidence;

  const report = {
    version: VERSION,
    status: semanticsProven
      ? 'ADJUSTMENT_RUN_SEMANTICS_EVIDENCE_FOUND'
      : 'ADJUSTMENT_RUN_SEMANTICS_REVIEW_REQUIRED',
    live: {
      validationEvents: events.length,
      stockGroups: groups.length,
      requiredPerStockRunCount: groups.length,
      groupsSupportedOnly: groupsSupportedOnly.length,
      groupsWithStructuralEvents: groupsWithStructural.length,
      groupsStructuralOnly: groupsStructuralOnly.length,
      groups
    },
    local: {
      filesScanned: local.filesScanned,
      evidenceCounts: {
        cumulativePrice: local.evidence.cumulativePrice.length,
        cumulativeShare: local.evidence.cumulativeShare.length,
        readyStatus: local.evidence.readyStatus.length,
        blockedStatus: local.evidence.blockedStatus.length,
        factorOrdering: local.evidence.factorOrdering.length,
        runLifecycle: local.evidence.runLifecycle.length
      },
      evidenceSummary,
      evidence: local.evidence
    },
    schemaImplication: {
      runGranularity: 'ONE_RUN_PER_STOCK_CODE',
      factorIdentity: 'UNIQUE(adjustment_run_id, action_event_id)',
      structuralFactorRows:
        'DO_NOT_INSERT_NULL_FACTORS_BECAUSE_FACTOR_COLUMNS_ARE_NOT_NULL_AND_POSITIVE',
      note:
        'A stock with structural exclusions may require BLOCKED_UNSUPPORTED_ACTION semantics, but this probe does not assume that without code evidence.'
    },
    safety: {
      databaseConnected: true,
      httpMethodsUsed: ['GET'],
      writesPerformed: 0,
      adjustmentRunsInserted: 0,
      adjustmentFactorsInserted: 0,
      coveragePromoted: false
    },
    nextGate: semanticsProven
      ? 'DESIGN_PER_STOCK_VALIDATION_RUNS_AND_CUMULATIVE_FACTOR_PREVIEW'
      : 'DEFINE_OR_CONFIRM_CUMULATIVE_ORDER_AND_RUN_STATUS_POLICY_BEFORE_ANY_WRITE'
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status: report.status,
    validationEvents: events.length,
    stockGroups: groups.length,
    requiredPerStockRunCount: groups.length,
    groupsSupportedOnly: groupsSupportedOnly.length,
    groupsWithStructuralEvents: groupsWithStructural.length,
    groupsStructuralOnly: groupsStructuralOnly.length,
    cumulativePriceEvidence: local.evidence.cumulativePrice.length,
    cumulativeShareEvidence: local.evidence.cumulativeShare.length,
    readyStatusEvidence: local.evidence.readyStatus.length,
    blockedStatusEvidence: local.evidence.blockedStatus.length,
    cumulativeMultiplicationEvidence:
      evidenceSummary.cumulativeMultiplicationEvidence,
    explicitRunStatusAssignmentEvidence:
      evidenceSummary.explicitRunStatusAssignmentEvidence,
    stockGroupsDetail: groups.map(g => ({
      stockCode: g.stockCode,
      supportedEvents: g.supportedEvents,
      structuralEvents: g.structuralEvents,
      otherEvents: g.otherEvents,
      events: g.events.map(e => ({
        actionType: e.actionType,
        effectiveDate: e.effectiveDate,
        class: e.class
      }))
    })),
    writesPerformed: 0,
    adjustmentRunsInserted: 0,
    adjustmentFactorsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' + outputFile
  );

  if (!semanticsProven) process.exitCode = 2;
}

main().catch(err => {
  console.error(
    String(err?.message || err)
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
});
