#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root =
  path.resolve(
    __dirname,
    '..',
  );

const report =
  JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        'logs',
        'alpha-v1-alpha-only-historical-replay-read-only.json',
      ),
      'utf8',
    ),
  );

const rows =
  (report.replay ?? [])
    .flatMap(
      (day) =>
        (day.rawRanking ?? [])
          .map(
            (row) => ({
              date:
                day.date,
              ...row,
            }),
          ),
    );

if (
  rows.length === 0
) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_COMPONENT_DISTRIBUTION_DIAG_FAILED',
        reason:
          'NO_RAW_RANKING_ROWS',
      },
      null,
      2,
    ),
  );

  process.exit(2);
}

const sampleKeys =
  Object.keys(
    rows[0],
  );

const dimensionArrayKey =
  sampleKeys.find(
    (key) =>
      Array.isArray(
        rows[0][key],
      ) &&
      rows[0][key]
        .some(
          (item) =>
            item &&
            typeof item === 'object' &&
            'dimension' in item &&
            'contribution' in item,
        ),
  ) ?? null;

const dimensionObjectKey =
  sampleKeys.find(
    (key) => {
      const value =
        rows[0][key];

      return (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.values(value)
          .some(
            (item) =>
              item &&
              typeof item === 'object' &&
              'contribution' in item,
          )
      );
    },
  ) ?? null;

function getDimensions(row) {
  if (
    dimensionArrayKey &&
    Array.isArray(
      row[
        dimensionArrayKey
      ],
    )
  ) {
    return row[
      dimensionArrayKey
    ];
  }

  if (
    dimensionObjectKey &&
    row[
      dimensionObjectKey
    ] &&
    typeof row[
      dimensionObjectKey
    ] === 'object'
  ) {
    return Object.entries(
      row[
        dimensionObjectKey
      ],
    )
      .map(
        ([dimension, value]) => ({
          dimension,
          ...(value ?? {}),
        }),
      );
  }

  return [];
}

const byDimension = {};

for (const row of rows) {
  for (
    const dim
    of getDimensions(
      row,
    )
  ) {
    const name =
      String(
        dim.dimension ??
        'UNKNOWN',
      );

    if (
      !byDimension[name]
    ) {
      byDimension[name] = {
        count: 0,
        included: 0,
        rawScores: [],
        effectiveScores: [],
        contributions: [],
        confidences: [],
        issues: {},
      };
    }

    const target =
      byDimension[name];

    target.count += 1;

    if (
      dim.included === true
    ) {
      target.included += 1;
    }

    for (
      const [
        key,
        bucket,
      ]
      of [
        ['rawScore', 'rawScores'],
        ['effectiveScore', 'effectiveScores'],
        ['contribution', 'contributions'],
        ['confidence', 'confidences'],
      ]
    ) {
      const value =
        Number(
          dim[key],
        );

      if (
        Number.isFinite(
          value,
        )
      ) {
        target[
          bucket
        ].push(
          value,
        );
      }
    }

    const issue =
      dim.issue === null ||
      dim.issue === undefined
        ? 'NONE'
        : String(
            dim.issue,
          );

    target.issues[
      issue
    ] =
      (
        target.issues[
          issue
        ] ??
        0
      ) +
      1;
  }
}

function stats(values) {
  if (
    values.length === 0
  ) {
    return {
      min: null,
      avg: null,
      max: null,
    };
  }

  return {
    min:
      Math.min(
        ...values,
      ),
    avg:
      values.reduce(
        (a, b) =>
          a + b,
        0,
      ) /
      values.length,
    max:
      Math.max(
        ...values,
      ),
  };
}

const dimensions =
  Object.fromEntries(
    Object.entries(
      byDimension,
    )
      .map(
        ([name, value]) => [
          name,
          {
            count:
              value.count,
            included:
              value.included,
            rawScore:
              stats(
                value.rawScores,
              ),
            effectiveScore:
              stats(
                value.effectiveScores,
              ),
            contribution:
              stats(
                value.contributions,
              ),
            confidence:
              stats(
                value.confidences,
              ),
            issues:
              value.issues,
          },
        ],
      ),
  );

const summary = {
  status:
    'ALPHA_V1_COMPONENT_DISTRIBUTION_DIAG_COMPLETE',

  rowCount:
    rows.length,

  detectedStructure: {
    sampleKeys,
    dimensionArrayKey,
    dimensionObjectKey,
  },

  scoreDistribution: {
    min:
      Math.min(
        ...rows.map(
          (row) =>
            Number(
              row.score,
            ),
        ),
      ),
    avg:
      rows.reduce(
        (sum, row) =>
          sum +
          Number(
            row.score,
          ),
        0,
      ) /
      rows.length,
    max:
      Math.max(
        ...rows.map(
          (row) =>
            Number(
              row.score,
            ),
        ),
      ),
  },

  dimensions,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
  },

  nextGate:
    Object.keys(
      dimensions,
    ).length > 0
      ? 'REVIEW_ALPHA_FEATURE_CALIBRATION'
      : 'EXTRACT_ALPHA_SCORE_OBJECT_CONTRACT',
};

fs.writeFileSync(
  path.join(
    root,
    'logs',
    'alpha-v1-component-distribution-diag.json',
  ),
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
      rowCount:
        summary.rowCount,
      scoreDistribution:
        summary.scoreDistribution,
      detectedStructure:
        summary.detectedStructure,
      dimensions:
        summary.dimensions,
      nextGate:
        summary.nextGate,
      outputFile:
        'logs/alpha-v1-component-distribution-diag.json',
    },
    null,
    2,
  ),
);
