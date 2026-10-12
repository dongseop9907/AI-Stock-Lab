#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Alpha V1 source locator
 *
 * READ ONLY
 * - scans local source/sql files
 * - no DB access
 * - no network
 * - no file mutation
 *
 * Goal:
 * locate concrete existing sources for:
 *   1) flow
 *   2) eventPersistence
 *   3) riskPenalty
 */

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_SOURCE_LOCATOR_FLOW_EVENT_RISK';

const MAX_FILE_BYTES =
  2 * 1024 * 1024;

const MAX_HITS_PER_GROUP =
  80;

const SCAN_EXTENSIONS =
  new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.cjs',
    '.mjs',
    '.sql',
    '.json',
    '.md',
  ]);

const SKIP_DIRS =
  new Set([
    'node_modules',
    '.next',
    '.git',
    'dist',
    'build',
    'coverage',
    '.turbo',
    '.vercel',
    'logs',
  ]);

const GROUPS = {
  flow: [
    /foreign[_\s-]*(?:net|buy|sell|volume|amount)/i,
    /institution[_\s-]*(?:net|buy|sell|volume|amount)/i,
    /individual[_\s-]*(?:net|buy|sell|volume|amount)/i,
    /investor[_\s-]*(?:flow|trend|trading|net)/i,
    /net[_\s-]*(?:buy|purchase|buying)/i,
    /순매수/i,
    /외국인/i,
    /기관/i,
    /투자자/i,
    /수급/i,
    /frgn/i,
    /orgn/i,
  ],

  eventPersistence: [
    /disclosure/i,
    /prediction/i,
    /catalyst/i,
    /event[_\s-]*persistence/i,
    /signal[_\s-]*(?:history|decay|age|lifetime)/i,
    /lookback(?:Hours|Days|Minutes)?/i,
    /prediction_date/i,
    /generated_at/i,
    /rcept_no/i,
    /report_nm/i,
    /공시/i,
  ],

  risk: [
    /validateBuyRisk/i,
    /BuyRiskInput/i,
    /riskPerShare/i,
    /maxRiskAmount/i,
    /maxPositionAmount/i,
    /maxPortfolioAmount/i,
    /maxSectorAmount/i,
    /STOP_NOT_BELOW_ENTRY/i,
    /POSITION_LIMIT_EXCEEDED/i,
    /proposedStopPrice/i,
    /risk[_\s-]*(?:validate|validation|policy|limit|score)/i,
    /paper[_\s-]*order/i,
  ],

  tables: [
    /\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."]+)/ig,
    /table_name\s*[:=]\s*["'`]([^"'`]+)["'`]/ig,
  ],
};

function walk(dir, out = []) {
  const entries =
    fs.readdirSync(
      dir,
      {
        withFileTypes: true,
      },
    );

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      SKIP_DIRS.has(entry.name)
    ) {
      continue;
    }

    const full =
      path.join(
        dir,
        entry.name,
      );

    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const ext =
      path.extname(
        entry.name,
      ).toLowerCase();

    if (
      !SCAN_EXTENSIONS.has(ext)
    ) {
      continue;
    }

    let stat;

    try {
      stat =
        fs.statSync(full);
    } catch {
      continue;
    }

    if (
      stat.size >
      MAX_FILE_BYTES
    ) {
      continue;
    }

    out.push(full);
  }

  return out;
}

function lineNumberAt(
  text,
  index,
) {
  return (
    text
      .slice(0, index)
      .split('\n')
      .length
  );
}

function getLine(
  text,
  lineNumber,
) {
  return (
    text
      .split(/\r?\n/)
      [lineNumber - 1] ??
    ''
  ).trim();
}

function getContext(
  text,
  lineNumber,
  radius = 2,
) {
  const lines =
    text.split(/\r?\n/);

  const start =
    Math.max(
      0,
      lineNumber - 1 - radius,
    );

  const end =
    Math.min(
      lines.length,
      lineNumber + radius,
    );

  return lines
    .slice(start, end)
    .map(
      (line, i) => ({
        line:
          start + i + 1,

        text:
          line.trim(),
      }),
    );
}

function scanRegexGroup(
  root,
  files,
  patterns,
) {
  const hits = [];

  for (const file of files) {
    let text;

    try {
      text =
        fs.readFileSync(
          file,
          'utf8',
        );
    } catch {
      continue;
    }

    for (const pattern of patterns) {
      const flags =
        pattern.flags.includes('g')
          ? pattern.flags
          : `${pattern.flags}g`;

      const regex =
        new RegExp(
          pattern.source,
          flags,
        );

      let match;

      while (
        (match = regex.exec(text)) !== null
      ) {
        const lineNumber =
          lineNumberAt(
            text,
            match.index,
          );

        hits.push({
          file:
            path
              .relative(root, file)
              .replaceAll('\\', '/'),

          line:
            lineNumber,

          match:
            match[0],

          lineText:
            getLine(
              text,
              lineNumber,
            ),

          context:
            getContext(
              text,
              lineNumber,
              2,
            ),
        });

        if (
          hits.length >=
          MAX_HITS_PER_GROUP
        ) {
          return hits;
        }

        if (
          match[0].length === 0
        ) {
          regex.lastIndex += 1;
        }
      }
    }
  }

  return hits;
}

function uniqueTables(
  root,
  files,
) {
  const map =
    new Map();

  for (const file of files) {
    let text;

    try {
      text =
        fs.readFileSync(
          file,
          'utf8',
        );
    } catch {
      continue;
    }

    const regexes = [
      /\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
      /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."]+)/ig,
      /table_name\s*[:=]\s*["'`]([^"'`]+)["'`]/ig,
    ];

    for (const regex of regexes) {
      let match;

      while (
        (match = regex.exec(text)) !== null
      ) {
        const raw =
          String(
            match[1] ?? '',
          )
            .replaceAll('"', '')
            .trim();

        if (!raw) {
          continue;
        }

        const line =
          lineNumberAt(
            text,
            match.index,
          );

        const key =
          raw.toLowerCase();

        if (!map.has(key)) {
          map.set(
            key,
            {
              table:
                raw,

              references: [],
            },
          );
        }

        const row =
          map.get(key);

        if (
          row.references.length <
          10
        ) {
          row.references.push({
            file:
              path
                .relative(root, file)
                .replaceAll('\\', '/'),

            line,

            lineText:
              getLine(
                text,
                line,
              ),
          });
        }
      }
    }
  }

  return [
    ...map.values(),
  ].sort(
    (a, b) =>
      a.table.localeCompare(
        b.table,
      ),
  );
}

function scoreFileHits(
  hits,
) {
  const grouped =
    new Map();

  for (const hit of hits) {
    const current =
      grouped.get(hit.file) ??
      {
        file:
          hit.file,

        hitCount:
          0,

        matches:
          new Set(),

        sampleLines: [],
      };

    current.hitCount += 1;
    current.matches.add(
      hit.match,
    );

    if (
      current.sampleLines.length <
      8
    ) {
      current.sampleLines.push({
        line:
          hit.line,

        text:
          hit.lineText,
      });
    }

    grouped.set(
      hit.file,
      current,
    );
  }

  return [
    ...grouped.values(),
  ]
    .map(
      (row) => ({
        file:
          row.file,

        hitCount:
          row.hitCount,

        distinctMatches:
          [
            ...row.matches,
          ].slice(0, 15),

        sampleLines:
          row.sampleLines,
      }),
    )
    .sort(
      (a, b) =>
        b.hitCount -
        a.hitCount ||
        a.file.localeCompare(
          b.file,
        ),
    );
}

function classifyTables(
  tables,
) {
  const names =
    tables.map(
      (row) =>
        row.table,
    );

  const pick =
    (regex) =>
      names.filter(
        (name) =>
          regex.test(name),
      );

  return {
    likelyFlowTables:
      pick(
        /invest|flow|supply|demand|foreign|institution|trading|market.*snapshot|market.*bar/i,
      ),

    likelyEventTables:
      pick(
        /disclosure|prediction|signal|event|news/i,
      ),

    likelyRiskTables:
      pick(
        /risk|order|position|portfolio|trade/i,
      ),
  };
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const files =
    walk(root);

  const flowHits =
    scanRegexGroup(
      root,
      files,
      GROUPS.flow,
    );

  const eventHits =
    scanRegexGroup(
      root,
      files,
      GROUPS.eventPersistence,
    );

  const riskHits =
    scanRegexGroup(
      root,
      files,
      GROUPS.risk,
    );

  const tables =
    uniqueTables(
      root,
      files,
    );

  const tableClassification =
    classifyTables(
      tables,
    );

  const report = {
    status:
      'ALPHA_V1_SOURCE_LOCATOR_COMPLETE',

    version:
      VERSION,

    scan: {
      filesScanned:
        files.length,

      extensions:
        [
          ...SCAN_EXTENSIONS,
        ],

      skippedDirs:
        [
          ...SKIP_DIRS,
        ],
    },

    flow: {
      hitCount:
        flowHits.length,

      candidateFiles:
        scoreFileHits(
          flowHits,
        ),

      likelyTables:
        tableClassification
          .likelyFlowTables,
    },

    eventPersistence: {
      hitCount:
        eventHits.length,

      candidateFiles:
        scoreFileHits(
          eventHits,
        ),

      likelyTables:
        tableClassification
          .likelyEventTables,
    },

    riskPenalty: {
      hitCount:
        riskHits.length,

      candidateFiles:
        scoreFileHits(
          riskHits,
        ),

      likelyTables:
        tableClassification
          .likelyRiskTables,
    },

    discoveredTables:
      tables,

    safety: {
      databaseReads:
        0,

      databaseWrites:
        0,

      networkRequests:
        0,

      sourceFilesModified:
        0,

      ordersCreated:
        0,
    },

    nextGate:
      'ALPHA_V1_BIND_CONFIRMED_FLOW_EVENT_RISK_SOURCES',
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'alpha-v1-source-locator-flow-event-risk.json',
    );

  fs.mkdirSync(
    path.dirname(
      outputFile,
    ),
    {
      recursive: true,
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
      {
        status:
          report.status,

        version:
          report.version,

        scan:
          report.scan,

        flow: {
          hitCount:
            report.flow.hitCount,

          topCandidateFiles:
            report.flow
              .candidateFiles
              .slice(0, 10),

          likelyTables:
            report.flow
              .likelyTables,
        },

        eventPersistence: {
          hitCount:
            report.eventPersistence
              .hitCount,

          topCandidateFiles:
            report
              .eventPersistence
              .candidateFiles
              .slice(0, 10),

          likelyTables:
            report
              .eventPersistence
              .likelyTables,
        },

        riskPenalty: {
          hitCount:
            report.riskPenalty
              .hitCount,

          topCandidateFiles:
            report
              .riskPenalty
              .candidateFiles
              .slice(0, 10),

          likelyTables:
            report.riskPenalty
              .likelyTables,
        },

        safety:
          report.safety,

        nextGate:
          report.nextGate,

        outputFile:
          'logs/alpha-v1-source-locator-flow-event-risk.json',
      },
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
          'ALPHA_V1_SOURCE_LOCATOR_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        safety: {
          databaseReads:
            0,

          databaseWrites:
            0,

          networkRequests:
            0,

          sourceFilesModified:
            0,

          ordersCreated:
            0,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
