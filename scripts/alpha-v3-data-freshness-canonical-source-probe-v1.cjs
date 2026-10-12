const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targetFiles = [
  "app/api/market/regime/v7/freshness/capture/route.ts",
  "app/api/market/regime/v7/quality-gate/capture/route.ts",
  "app/api/trading/automation/run/route.ts",
  "lib/trading/generate-entry-signals.ts",
  "lib/trading/paper-order-service.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "lib/trading/execute-paper-order.ts"
];

const migrationDir =
  path.resolve(
    root,
    "supabase/migrations"
  );

function read(rel) {
  const abs =
    path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    return null;
  }

  return fs.readFileSync(
    abs,
    "utf8"
  );
}

function extractMatches(
  text,
  regex
) {
  if (!text) return [];

  return [
    ...text.matchAll(regex)
  ].map(
    (match) =>
      match[1]
  );
}

function uniq(values) {
  return [
    ...new Set(
      values.filter(Boolean)
    )
  ];
}

function excerptAround(
  text,
  patterns,
  radius = 8
) {
  if (!text) return [];

  const lines =
    text.split(/\r?\n/);

  const hits = [];

  for (
    let i = 0;
    i < lines.length;
    i += 1
  ) {
    if (
      !patterns.some(
        (pattern) =>
          pattern.test(
            lines[i]
          )
      )
    ) {
      continue;
    }

    const start =
      Math.max(
        0,
        i - radius
      );

    const end =
      Math.min(
        lines.length,
        i + radius + 1
      );

    hits.push({
      line:
        i + 1,

      excerpt:
        lines
          .slice(
            start,
            end
          )
          .map(
            (line, index) =>
              `${start + index + 1}: ${line}`
          )
          .join("\n")
    });
  }

  return hits;
}

const fileFindings = [];

for (const rel of targetFiles) {
  const text =
    read(rel);

  const tables =
    uniq([
      ...extractMatches(
        text,
        /\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/g
      ),

      ...extractMatches(
        text,
        /from\s+public\.([A-Za-z0-9_]+)/gi
      )
    ]);

  const rpcs =
    uniq(
      extractMatches(
        text,
        /\.rpc\(\s*["'`]([^"'`]+)["'`]/g
      )
    );

  const statusTokens =
    uniq(
      extractMatches(
        text,
        /\b(FRESH|STALE|FAIL_FRESHNESS|PASS|WARNING|UNKNOWN|DATE_MISMATCH)\b/g
      )
    );

  fileFindings.push({
    file:
      rel,

    exists:
      Boolean(text),

    tables,
    rpcs,
    statusTokens,

    freshnessIdentifiers:
      text
        ? uniq(
            [
              ...extractMatches(
                text,
                /\b([A-Za-z0-9_]*(?:freshness|expectedMarketDate|latestCommonDate|usableForForwardShadow|usableForShadowComparison|productionApplied|qualityGate)[A-Za-z0-9_]*)\b/gi
              )
            ]
          ).slice(0, 40)
        : [],

    queryHints:
      text
        ? {
            orderCalls:
              (
                text.match(
                  /\.order\(/g
                ) || []
              ).length,

            limitCalls:
              (
                text.match(
                  /\.limit\(/g
                ) || []
              ).length,

            maybeSingleCalls:
              (
                text.match(
                  /\.maybeSingle\(/g
                ) || []
              ).length,

            singleCalls:
              (
                text.match(
                  /\.single\(/g
                ) || []
              ).length
          }
        : null,

    contexts:
      excerptAround(
        text,
        [
          /\.from\(/,
          /\.rpc\(/,
          /freshness/i,
          /quality.?gate/i,
          /expectedMarketDate/i,
          /latestCommonDate/i,
          /usableForForwardShadow/i,
          /productionApplied/i
        ],
        6
      )
  });
}

const migrations = [];

if (
  fs.existsSync(
    migrationDir
  )
) {
  for (
    const name of
      fs.readdirSync(
        migrationDir
      )
        .filter(
          (item) =>
            item.endsWith(
              ".sql"
            )
        )
        .sort()
  ) {
    const abs =
      path.join(
        migrationDir,
        name
      );

    const text =
      fs.readFileSync(
        abs,
        "utf8"
      );

    if (
      !/freshness|quality.?gate|expected_market_date|latest_common_date|forward_shadow|production_applied/i.test(
        text
      )
    ) {
      continue;
    }

    const createdTables =
      uniq(
        extractMatches(
          text,
          /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([A-Za-z0-9_]+)/gi
        )
      );

    const alteredTables =
      uniq(
        extractMatches(
          text,
          /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([A-Za-z0-9_]+)/gi
        )
      );

    const functions =
      uniq(
        extractMatches(
          text,
          /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([A-Za-z0-9_]+)/gi
        )
      );

    migrations.push({
      migration:
        name.replace(
          /\.sql$/,
          ""
        ),

      file:
        `supabase/migrations/${name}`,

      createdTables,
      alteredTables,
      functions,

      contexts:
        excerptAround(
          text,
          [
            /freshness/i,
            /quality.?gate/i,
            /expected_market_date/i,
            /latest_common_date/i,
            /forward_shadow/i,
            /production_applied/i
          ],
          5
        )
    });
  }
}

const allTables =
  uniq(
    fileFindings.flatMap(
      (item) => item.tables
    )
  );

const allRpcs =
  uniq(
    fileFindings.flatMap(
      (item) => item.rpcs
    )
  );

const migrationTables =
  uniq(
    migrations.flatMap(
      (item) => [
        ...item.createdTables,
        ...item.alteredTables
      ]
    )
  );

const candidateCanonicalTables =
  uniq([
    ...allTables.filter(
      (name) =>
        /fresh|quality|regime|market|shadow/i.test(
          name
        )
    ),

    ...migrationTables.filter(
      (name) =>
        /fresh|quality|regime|market|shadow/i.test(
          name
        )
    )
  ]);

const report = {
  status:
    "ALPHA_V3_DATA_FRESHNESS_CANONICAL_SOURCE_PROBE_V1_COMPLETE",

  summary: {
    targetFileCount:
      targetFiles.length,

    existingTargetFileCount:
      fileFindings.filter(
        (item) => item.exists
      ).length,

    freshnessMigrationCount:
      migrations.length,

    candidateCanonicalTableCount:
      candidateCanonicalTables.length,

    discoveredRpcCount:
      allRpcs.length
  },

  candidateCanonicalTables,
  discoveredRpcs:
    allRpcs,

  fileFindings,
  migrations,

  decisionQuestions: {
    canonicalStoredState:
      candidateCanonicalTables.length > 0,

    latestRowSelectionVisible:
      fileFindings.some(
        (item) =>
          item.queryHints &&
          item.queryHints.orderCalls > 0 &&
          item.queryHints.limitCalls > 0
      ),

    productionAppliedFieldVisible:
      fileFindings.some(
        (item) =>
          item.freshnessIdentifiers.some(
            (name) =>
              /productionApplied/i.test(
                name
              )
          )
      ),

    expectedAndLatestDateVisible:
      fileFindings.some(
        (item) =>
          item.freshnessIdentifiers.some(
            (name) =>
              /expectedMarketDate/i.test(
                name
              )
          )
      ) &&
      fileFindings.some(
        (item) =>
          item.freshnessIdentifiers.some(
            (name) =>
              /latestCommonDate/i.test(
                name
              )
          )
      )
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-data-freshness-canonical-source-probe-v1.json",

  nextGate:
    "SELECT_CANONICAL_FRESHNESS_STATE_SOURCE_AND_BUILD_READ_GUARD_V1"
};

const logPath =
  path.resolve(
    root,
    report.logFile
  );

fs.mkdirSync(
  path.dirname(logPath),
  {
    recursive: true
  }
);

fs.writeFileSync(
  logPath,
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      summary:
        report.summary,

      candidateCanonicalTables:
        report.candidateCanonicalTables,

      discoveredRpcs:
        report.discoveredRpcs,

      decisionQuestions:
        report.decisionQuestions,

      keyFiles:
        report.fileFindings
          .filter(
            (item) =>
              item.exists &&
              (
                item.tables.length > 0 ||
                item.rpcs.length > 0 ||
                item.freshnessIdentifiers.length > 0
              )
          )
          .map(
            (item) => ({
              file:
                item.file,

              tables:
                item.tables,

              rpcs:
                item.rpcs,

              queryHints:
                item.queryHints
            })
          ),

      logFile:
        report.logFile,

      nextGate:
        report.nextGate
    },
    null,
    2
  )
);
