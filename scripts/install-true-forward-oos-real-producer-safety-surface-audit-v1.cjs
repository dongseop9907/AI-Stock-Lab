const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-real-producer-safety-surface-audit-v1.cjs"
  );

function fail(
  reason,
  extra = {},
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_PRODUCER_SAFETY_SURFACE_AUDIT_V1_INSTALL_FAILED",

        reason,
        ...extra,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}

const required = [
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(
          ROOT,
          rel,
        ),
      ),
  );

if (
  missing.length > 0
) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      missing,
    },
  );
} else {
  fs.writeFileSync(
    TARGET,
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst TARGET_REL =\n  \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\";\n\nconst TARGET =\n  path.join(\n    ROOT,\n    TARGET_REL,\n  );\n\nfunction lineHits(\n  text,\n  regex,\n  limit = 40,\n) {\n  const lines =\n    text.split(/\\r?\\n/);\n\n  const out = [];\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i++\n  ) {\n    if (\n      regex.test(\n        lines[i],\n      )\n    ) {\n      out.push({\n        line:\n          i + 1,\n        text:\n          lines[i].trim(),\n      });\n\n      if (\n        out.length >=\n        limit\n      ) {\n        break;\n      }\n    }\n\n    regex.lastIndex = 0;\n  }\n\n  return out;\n}\n\nfunction bool(\n  value,\n) {\n  return value ===\n    true;\n}\n\nif (\n  !fs.existsSync(\n    TARGET,\n  )\n) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_PRODUCER_SAFETY_SURFACE_AUDIT_V1_FAILED\",\n\n        reason:\n          \"PRODUCER_NOT_FOUND\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode = 1;\n} else {\n  const source =\n    fs.readFileSync(\n      TARGET,\n      \"utf8\",\n    );\n\n  const hits = {\n    dryRunLike:\n      lineHits(\n        source,\n        /(dry.?run|probe.?only|read.?only|no.?write|preview|smoke)/i,\n      ),\n\n    fileWrites:\n      lineHits(\n        source,\n        /(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|rename|copyFile|unlink)/i,\n      ),\n\n    dbWrites:\n      lineHits(\n        source,\n        /\\.(insert|update|upsert|delete)\\s*\\(|\\b(insert|update|upsert|delete)\\b/i,\n      ),\n\n    dbReads:\n      lineHits(\n        source,\n        /\\.(select|from)\\s*\\(/i,\n      ),\n\n    network:\n      lineHits(\n        source,\n        /\\bfetch\\s*\\(|axios\\.|https?\\.request|https?\\.get/i,\n      ),\n\n    supabase:\n      lineHits(\n        source,\n        /supabase|createClient|createSupabase/i,\n      ),\n\n    mainExecution:\n      lineHits(\n        source,\n        /(main\\s*\\(|await\\s+main\\s*\\(|process\\.exit|process\\.exitCode)/i,\n      ),\n\n    forwardOutput:\n      lineHits(\n        source,\n        /(forward|oos|candidate|targetSession|checkpoint|json)/i,\n        60,\n      ),\n\n    trading:\n      lineHits(\n        source,\n        /(order|position|real.?trading|live.?trading|paper.?order|submit|execute)/i,\n        60,\n      ),\n  };\n\n  const checks = {\n    producerExists:\n      true,\n\n    hasExplicitDryRunOrProbeMode:\n      hits\n        .dryRunLike\n        .length >\n      0,\n\n    hasFileWriteSurface:\n      hits\n        .fileWrites\n        .length >\n      0,\n\n    hasDatabaseWriteSurface:\n      hits\n        .dbWrites\n        .length >\n      0,\n\n    hasDatabaseReadSurface:\n      hits\n        .dbReads\n        .length >\n      0,\n\n    hasNetworkSurface:\n      hits\n        .network\n        .length >\n      0,\n\n    hasSupabaseSurface:\n      hits\n        .supabase\n        .length >\n      0,\n\n    autoExecutesMain:\n      /(?:^|\\n)\\s*(?:void\\s+)?main\\s*\\(\\s*\\)|await\\s+main\\s*\\(\\s*\\)/m.test(\n        source,\n      ) ||\n      /main\\s*\\(\\s*\\)\\s*\\.catch/m.test(\n        source,\n      ),\n\n    hasOrderCreationLikeSurface:\n      /(create.*order|place.*order|submit.*order|execute.*order|paper.*order)/i.test(\n        source,\n      ),\n\n    hasRealTradingEnableSurface:\n      /(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)/.test(\n        source,\n      ),\n  };\n\n  let readiness;\n\n  if (\n    checks\n      .hasExplicitDryRunOrProbeMode\n  ) {\n    readiness =\n      \"EXPLICIT_PROBE_OR_DRY_RUN_SURFACE_PRESENT\";\n  } else if (\n    !checks\n      .hasDatabaseWriteSurface &&\n    !checks\n      .hasOrderCreationLikeSurface\n  ) {\n    readiness =\n      \"NO_EXPLICIT_PROBE_MODE_BUT_NO_OBVIOUS_DB_OR_ORDER_WRITE_SURFACE\";\n  } else {\n    readiness =\n      \"NO_SAFE_REAL_PRODUCER_EXECUTION_YET_NEEDS_ISOLATED_PROBE_BOUNDARY\";\n  }\n\n  const report = {\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_PRODUCER_SAFETY_SURFACE_AUDIT_V1_COMPLETE\",\n\n    readiness,\n\n    checks,\n\n    counts: {\n      dryRunLike:\n        hits\n          .dryRunLike\n          .length,\n\n      fileWrites:\n        hits\n          .fileWrites\n          .length,\n\n      dbWrites:\n        hits\n          .dbWrites\n          .length,\n\n      dbReads:\n        hits\n          .dbReads\n          .length,\n\n      network:\n        hits\n          .network\n          .length,\n\n      supabase:\n        hits\n          .supabase\n          .length,\n\n      trading:\n        hits\n          .trading\n          .length,\n    },\n\n    evidence:\n      hits,\n\n    safety: {\n      readOnlySourceAudit:\n        true,\n\n      producerExecuted:\n        false,\n\n      subprocessExecuted:\n        false,\n\n      networkCalls:\n        0,\n\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      filesWrittenByProducer:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      realTradingEnabled:\n        false,\n    },\n\n    nextGate:\n      readiness ===\n      \"EXPLICIT_PROBE_OR_DRY_RUN_SURFACE_PRESENT\"\n        ? \"VERIFY_PRODUCER_EXPLICIT_PROBE_MODE_CONTRACT_BEFORE_REAL_SUBPROCESS\"\n        : readiness ===\n          \"NO_EXPLICIT_PROBE_MODE_BUT_NO_OBVIOUS_DB_OR_ORDER_WRITE_SURFACE\"\n        ? \"VERIFY_PRODUCER_OUTPUT_WRITE_BOUNDARY_AND_SAFE_TEMP_ISOLATION_V1\"\n        : \"DESIGN_ISOLATED_PRODUCER_PROBE_BOUNDARY_BEFORE_REAL_SUBPROCESS\",\n  };\n\n  fs.mkdirSync(\n    path.join(\n      ROOT,\n      \"logs\",\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-real-producer-safety-surface-audit-v1.json\",\n    ),\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          report.status,\n\n        readiness:\n          report.readiness,\n\n        checks:\n          report.checks,\n\n        counts:\n          report.counts,\n\n        nextGate:\n          report.nextGate,\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode = 0;\n}\n",
    "utf8",
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8",
        ),
      );
  } catch (
    error
  ) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error,
          ),
      },
    );
  }

  if (
    pkg
  ) {
    pkg.scripts ||= {};

    pkg.scripts[
      "test:true-forward-oos-real-producer-safety"
    ] =
      "node ./scripts/true-forward-oos-real-producer-safety-surface-audit-v1.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2,
      ) + "\n",
      "utf8",
    );

    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_PRODUCER_SAFETY_SURFACE_AUDIT_V1_INSTALLED",

          generatedFile:
            "scripts/true-forward-oos-real-producer-safety-surface-audit-v1.cjs",

          packageScript:
            "npm run test:true-forward-oos-real-producer-safety",

          mode:
            "READ_ONLY_PRODUCER_SOURCE_AUDIT",

          productSourceChanges:
            0,

          safety: {
            producerExecution:
              false,

            subprocessExecution:
              false,

            networkCalls:
              0,

            databaseReads:
              0,

            databaseWrites:
              0,

            ordersCreated:
              0,

            positionsChanged:
              0,

            realTradingEnabled:
              false,
          },

          nextAction:
            "RUN_COMPACT_REAL_PRODUCER_SAFETY_SURFACE_AUDIT",
        },
        null,
        2,
      ),
    );
  }
}
