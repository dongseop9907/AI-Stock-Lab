#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TARGETS = [
  'lib/alpha/candidate-scoring.ts',
  'lib/alpha/daily-market-adapters.ts',
  'lib/alpha/confirmed-source-adapters.ts',
  'lib/alpha/kis-flow-adapter.ts',
  'lib/trading/generate-entry-signals.ts',
];

const NEEDLES = [
  'export function',
  'export async function',
  'export interface',
  'export type',
  'rankAlphaCandidates',
  'buildEventPersistenceEvidence',
  'buildKisInvestorFlowEvidence',
  'calculateEntrySignal',
];

function extract(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  const hits = [];

  lines.forEach((line, index) => {
    if (NEEDLES.some((needle) => line.includes(needle))) {
      const from = Math.max(0, index - 3);
      const to = Math.min(lines.length, index + 18);

      hits.push({
        line: index + 1,
        snippet: lines
          .slice(from, to)
          .map((value, offset) => `${from + offset + 1}: ${value}`)
          .join('\n'),
      });
    }
  });

  return {
    file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
    lineCount: lines.length,
    hits,
  };
}

try {
  const root = path.resolve(__dirname, '..');

  const report = {
    status: 'ALPHA_V1_HISTORICAL_REPLAY_CONTRACT_EXTRACT_COMPLETE',
    version: 'ALPHA_V1_HISTORICAL_REPLAY_CONTRACT_EXTRACTOR',
    files: TARGETS.map((relative) => extract(path.join(root, relative))),
    safety: {
      databaseReads: 0,
      databaseWrites: 0,
      networkRequests: 0,
      ordersCreated: 0,
    },
    nextGate: 'BUILD_5_DATE_FULL_HISTORICAL_REPLAY',
  };

  const out = path.join(
    root,
    'logs',
    'alpha-v1-historical-replay-contract-extract.json',
  );

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: 'ALPHA_V1_HISTORICAL_REPLAY_CONTRACT_EXTRACT_FAILED',
    error: String(error?.message ?? error),
  }, null, 2));

  process.exitCode = 2;
}
