const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET_REL =
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts";

const TARGET =
  path.join(
    ROOT,
    TARGET_REL,
  );

function lineHits(
  text,
  regex,
  limit = 40,
) {
  const lines =
    text.split(/\r?\n/);

  const out = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (
      regex.test(
        lines[i],
      )
    ) {
      out.push({
        line:
          i + 1,
        text:
          lines[i].trim(),
      });

      if (
        out.length >=
        limit
      ) {
        break;
      }
    }

    regex.lastIndex = 0;
  }

  return out;
}

function bool(
  value,
) {
  return value ===
    true;
}

if (
  !fs.existsSync(
    TARGET,
  )
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_PRODUCER_SAFETY_SURFACE_AUDIT_V1_FAILED",

        reason:
          "PRODUCER_NOT_FOUND",
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      TARGET,
      "utf8",
    );

  const hits = {
    dryRunLike:
      lineHits(
        source,
        /(dry.?run|probe.?only|read.?only|no.?write|preview|smoke)/i,
      ),

    fileWrites:
      lineHits(
        source,
        /(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|rename|copyFile|unlink)/i,
      ),

    dbWrites:
      lineHits(
        source,
        /\.(insert|update|upsert|delete)\s*\(|\b(insert|update|upsert|delete)\b/i,
      ),

    dbReads:
      lineHits(
        source,
        /\.(select|from)\s*\(/i,
      ),

    network:
      lineHits(
        source,
        /\bfetch\s*\(|axios\.|https?\.request|https?\.get/i,
      ),

    supabase:
      lineHits(
        source,
        /supabase|createClient|createSupabase/i,
      ),

    mainExecution:
      lineHits(
        source,
        /(main\s*\(|await\s+main\s*\(|process\.exit|process\.exitCode)/i,
      ),

    forwardOutput:
      lineHits(
        source,
        /(forward|oos|candidate|targetSession|checkpoint|json)/i,
        60,
      ),

    trading:
      lineHits(
        source,
        /(order|position|real.?trading|live.?trading|paper.?order|submit|execute)/i,
        60,
      ),
  };

  const checks = {
    producerExists:
      true,

    hasExplicitDryRunOrProbeMode:
      hits
        .dryRunLike
        .length >
      0,

    hasFileWriteSurface:
      hits
        .fileWrites
        .length >
      0,

    hasDatabaseWriteSurface:
      hits
        .dbWrites
        .length >
      0,

    hasDatabaseReadSurface:
      hits
        .dbReads
        .length >
      0,

    hasNetworkSurface:
      hits
        .network
        .length >
      0,

    hasSupabaseSurface:
      hits
        .supabase
        .length >
      0,

    autoExecutesMain:
      /(?:^|\n)\s*(?:void\s+)?main\s*\(\s*\)|await\s+main\s*\(\s*\)/m.test(
        source,
      ) ||
      /main\s*\(\s*\)\s*\.catch/m.test(
        source,
      ),

    hasOrderCreationLikeSurface:
      /(create.*order|place.*order|submit.*order|execute.*order|paper.*order)/i.test(
        source,
      ),

    hasRealTradingEnableSurface:
      /(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)/.test(
        source,
      ),
  };

  let readiness;

  if (
    checks
      .hasExplicitDryRunOrProbeMode
  ) {
    readiness =
      "EXPLICIT_PROBE_OR_DRY_RUN_SURFACE_PRESENT";
  } else if (
    !checks
      .hasDatabaseWriteSurface &&
    !checks
      .hasOrderCreationLikeSurface
  ) {
    readiness =
      "NO_EXPLICIT_PROBE_MODE_BUT_NO_OBVIOUS_DB_OR_ORDER_WRITE_SURFACE";
  } else {
    readiness =
      "NO_SAFE_REAL_PRODUCER_EXECUTION_YET_NEEDS_ISOLATED_PROBE_BOUNDARY";
  }

  const report = {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_PRODUCER_SAFETY_SURFACE_AUDIT_V1_COMPLETE",

    readiness,

    checks,

    counts: {
      dryRunLike:
        hits
          .dryRunLike
          .length,

      fileWrites:
        hits
          .fileWrites
          .length,

      dbWrites:
        hits
          .dbWrites
          .length,

      dbReads:
        hits
          .dbReads
          .length,

      network:
        hits
          .network
          .length,

      supabase:
        hits
          .supabase
          .length,

      trading:
        hits
          .trading
          .length,
    },

    evidence:
      hits,

    safety: {
      readOnlySourceAudit:
        true,

      producerExecuted:
        false,

      subprocessExecuted:
        false,

      networkCalls:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      filesWrittenByProducer:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    nextGate:
      readiness ===
      "EXPLICIT_PROBE_OR_DRY_RUN_SURFACE_PRESENT"
        ? "VERIFY_PRODUCER_EXPLICIT_PROBE_MODE_CONTRACT_BEFORE_REAL_SUBPROCESS"
        : readiness ===
          "NO_EXPLICIT_PROBE_MODE_BUT_NO_OBVIOUS_DB_OR_ORDER_WRITE_SURFACE"
        ? "VERIFY_PRODUCER_OUTPUT_WRITE_BOUNDARY_AND_SAFE_TEMP_ISOLATION_V1"
        : "DESIGN_ISOLATED_PRODUCER_PROBE_BOUNDARY_BEFORE_REAL_SUBPROCESS",
  };

  fs.mkdirSync(
    path.join(
      ROOT,
      "logs",
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "true-forward-oos-real-producer-safety-surface-audit-v1.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        readiness:
          report.readiness,

        checks:
          report.checks,

        counts:
          report.counts,

        nextGate:
          report.nextGate,
      },
      null,
      2,
    ),
  );

  process.exitCode = 0;
}
