#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_PRE_ENTRY_RISK_CONTRACT_EXTRACTOR';

const TARGETS = [
  {
    file:
      'lib/trading/risk-manager.ts',

    tokens: [
      'export interface BuyRiskInput',
      'interface BuyRiskInput',
      'export function validateBuyRisk',
      'riskPerShare',
      'maxRiskAmount',
      'maxPositionAmount',
      'maxPortfolioAmount',
      'maxSectorAmount',
      'approved',
      'issues',
    ],
  },
  {
    file:
      'lib/trading/paper-order-service.ts',

    tokens: [
      'interface CreatePaperBuyOrderInput',
      'export async function createPaperBuyOrder',
      'const riskInput',
      'validateBuyRisk',
      'proposedStopPrice',
      'requestedQuantity',
      'portfolio',
      'sector',
      'cash',
      'equity',
      'risk_decisions',
    ],
  },
  {
    file:
      'lib/trading/generate-entry-signals.ts',

    tokens: [
      'interface GenerateEntrySignalsInput',
      'interface SignalCandidate',
      'DEFAULT_STOP_DISTANCE_RATE',
      'entryPrice',
      'stopPrice',
      'quantity',
      'createPaperBuyOrder',
      'shouldCreateOrder',
      'autoOrder',
      'eligibleCandidates',
    ],
  },
];

function readLines(
  file,
) {
  return fs
    .readFileSync(
      file,
      'utf8',
    )
    .split(/\r?\n/);
}

function mergeWindows(
  windows,
  maxLine,
) {
  const sorted =
    windows
      .map(
        (window) => ({
          start:
            Math.max(
              1,
              window.start,
            ),

          end:
            Math.min(
              maxLine,
              window.end,
            ),
        }),
      )
      .sort(
        (a, b) =>
          a.start -
          b.start,
      );

  const merged = [];

  for (const window of sorted) {
    const previous =
      merged.at(-1);

    if (
      previous &&
      window.start <=
        previous.end + 3
    ) {
      previous.end =
        Math.max(
          previous.end,
          window.end,
        );
    } else {
      merged.push({
        ...window,
      });
    }
  }

  return merged;
}

function extractTarget(
  root,
  target,
) {
  const full =
    path.join(
      root,
      target.file,
    );

  if (!fs.existsSync(full)) {
    return {
      file:
        target.file,

      exists:
        false,

      snippets:
        [],
    };
  }

  const lines =
    readLines(
      full,
    );

  const windows = [
    {
      start: 1,
      end:
        Math.min(
          120,
          lines.length,
        ),
    },
  ];

  for (
    const token
    of target.tokens
  ) {
    lines.forEach(
      (line, index) => {
        if (
          line.includes(
            token,
          )
        ) {
          windows.push({
            start:
              index + 1 - 18,

            end:
              index + 1 + 45,
          });
        }
      },
    );
  }

  const merged =
    mergeWindows(
      windows,
      lines.length,
    );

  const exports =
    lines
      .map(
        (line, index) => ({
          line:
            index + 1,

          text:
            line.trim(),
        }),
      )
      .filter(
        (row) =>
          row.text.startsWith(
            'export ',
          ),
      );

  return {
    file:
      target.file,

    exists:
      true,

    lineCount:
      lines.length,

    exports,

    snippets:
      merged.map(
        (window) => ({
          fromLine:
            window.start,

          toLine:
            window.end,

          text:
            lines
              .slice(
                window.start - 1,
                window.end,
              )
              .map(
                (line, offset) =>
                  `${window.start + offset}: ${line}`,
              )
              .join('\n'),
        }),
      ),
  };
}

function main() {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const files =
    TARGETS.map(
      (target) =>
        extractTarget(
          root,
          target,
        ),
    );

  const report = {
    status:
      'ALPHA_V1_PRE_ENTRY_RISK_CONTRACT_EXTRACT_COMPLETE',

    version:
      VERSION,

    filesFound:
      files.filter(
        (file) =>
          file.exists,
      ).length,

    filesMissing:
      files
        .filter(
          (file) =>
            !file.exists,
        )
        .map(
          (file) =>
            file.file,
        ),

    files,

    intendedArchitecture: {
      alphaCandidateRanking:
        'RISK_DEFER_TO_PREFLIGHT',

      entryTiming:
        'GENERATES_ENTRY_STOP_QUANTITY',

      riskPreflight:
        'REUSE_VALIDATE_BUY_RISK',

      paperOrder:
        'MUST_NOT_BE_CREATED_IN_PREFLIGHT_DIAGNOSTIC',

      riskFormula:
        'NO_NEW_FORMULA_NO_DUPLICATION',
    },

    safety: {
      databaseReads:
        0,

      databaseWrites:
        0,

      networkRequests:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },

    nextGate:
      'ALPHA_V1_IMPLEMENT_READ_ONLY_ENTRY_RISK_PREFLIGHT',
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'alpha-v1-pre-entry-risk-contract-extract.json',
    );

  fs.mkdirSync(
    path.dirname(
      outputFile,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      report,
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_PRE_ENTRY_RISK_CONTRACT_EXTRACT_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        ordersCreated:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode =
    2;
}
