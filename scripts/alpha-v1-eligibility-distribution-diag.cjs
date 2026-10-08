#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root =
  path.resolve(
    __dirname,
    '..',
  );

const inputFile =
  path.join(
    root,
    'logs',
    'alpha-v1-alpha-only-historical-replay-read-only.json',
  );

const report =
  JSON.parse(
    fs.readFileSync(
      inputFile,
      'utf8',
    ),
  );

const rows = [];

for (const day of report.replay ?? []) {
  for (const row of day.topRanking ?? []) {
    rows.push({
      date:
        day.date,
      stockCode:
        row.stockCode,
      score:
        Number(
          row.score ??
          0,
        ),
      quality:
        Number(
          row.quality ??
          0,
        ),
      coverage:
        Number(
          row.coverage ??
          0,
        ),
      eligible:
        row.eligible === true,
      blockers:
        Array.isArray(
          row.blockers,
        )
          ? row.blockers
          : [],
    });
  }
}

const sorted =
  [...rows].sort(
    (a, b) =>
      b.score - a.score,
  );

const blockerCounts = {};

for (const row of rows) {
  for (const blocker of row.blockers) {
    const key =
      String(blocker)
        .split(':')[0];

    blockerCounts[key] =
      (blockerCounts[key] ?? 0) + 1;
  }
}

const nearThreshold =
  sorted
    .filter(
      (row) =>
        row.score >= 0.60,
    )
    .slice(
      0,
      30,
    );

const summary = {
  status:
    'ALPHA_V1_ELIGIBILITY_DISTRIBUTION_DIAG_COMPLETE',

  rowCount:
    rows.length,

  maxScore:
    sorted[0]?.score ??
    null,

  top10:
    sorted
      .slice(
        0,
        10,
      ),

  counts: {
    scoreGe068:
      rows.filter(
        (row) =>
          row.score >= 0.68,
      ).length,

    scoreGe065:
      rows.filter(
        (row) =>
          row.score >= 0.65,
      ).length,

    scoreGe060:
      rows.filter(
        (row) =>
          row.score >= 0.60,
      ).length,

    qualityGe078:
      rows.filter(
        (row) =>
          row.quality >= 0.78,
      ).length,

    coverageGe080:
      rows.filter(
        (row) =>
          row.coverage >= 0.80,
      ).length,

    allStableNonScoreRequirements:
      rows.filter(
        (row) =>
          row.quality >= 0.78 &&
          row.coverage >= 0.80,
      ).length,
  },

  blockerCounts,

  nearThreshold,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
  },

  nextGate:
    'DECIDE_ALPHA_CALIBRATION_FROM_DISTRIBUTION',
};

const outputFile =
  path.join(
    root,
    'logs',
    'alpha-v1-eligibility-distribution-diag.json',
  );

fs.writeFileSync(
  outputFile,
  JSON.stringify(
    summary,
    null,
    2,
  ) + '\n',
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        summary.status,

      maxScore:
        summary.maxScore,

      counts:
        summary.counts,

      blockerCounts:
        summary.blockerCounts,

      top5:
        summary.top10.slice(
          0,
          5,
        ),

      outputFile:
        'logs/alpha-v1-eligibility-distribution-diag.json',
    },
    null,
    2,
  ),
);
