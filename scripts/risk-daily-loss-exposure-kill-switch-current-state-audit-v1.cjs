const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SEARCH_ROOTS = [
  "lib",
  "app",
  "supabase/migrations",
  "scripts",
];

const ALLOWED_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".cjs",
  ".mjs",
  ".sql",
  ".json",
]);

const SKIP_PARTS = new Set([
  "node_modules",
  ".next",
  ".git",
  "logs",
  "backups",
  "dist",
  "build",
  "coverage",
]);

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out = [];
  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();

    for (const entry of fs.readdirSync(
      current,
      { withFileTypes: true },
    )) {
      if (
        entry.name.startsWith(".") &&
        entry.name !== ".env"
      ) {
        continue;
      }

      if (SKIP_PARTS.has(entry.name)) {
        continue;
      }

      const full =
        path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }

      const ext =
        path.extname(entry.name);

      if (!ALLOWED_EXT.has(ext)) {
        continue;
      }

      out.push(full);
    }
  }

  return out;
}

function rel(file) {
  return path
    .relative(ROOT, file)
    .replace(/\\/g, "/");
}

const files =
  SEARCH_ROOTS.flatMap(
    (root) =>
      walk(
        path.join(ROOT, root),
      ),
  );

const uniqueFiles =
  [...new Set(files)];

const corpus =
  uniqueFiles.map(
    (file) => ({
      file:
        rel(file),

      text:
        fs.readFileSync(
          file,
          "utf8",
        ),
    }),
  );

function hitsFor(patterns) {
  const hits = [];

  for (const item of corpus) {
    const matched = [];

    for (const pattern of patterns) {
      if (pattern.test(item.text)) {
        matched.push(
          pattern.toString(),
        );
      }
    }

    if (matched.length) {
      hits.push({
        file:
          item.file,

        matched,
      });
    }
  }

  return hits;
}

function any(patterns) {
  return hitsFor(patterns).length > 0;
}

function filesOnly(patterns) {
  return hitsFor(patterns)
    .map((x) => x.file)
    .slice(0, 40);
}

const dailyLossPatterns = [
  /daily_realized_pnl/i,
  /daily[_\s-]*loss/i,
  /max[_\s-]*daily[_\s-]*(loss|drawdown)/i,
  /DAILY_LOSS/i,
  /DAILY_DRAWDOWN/i,
];

const tickerExposurePatterns = [
  /max[_\s-]*(position|ticker|symbol)/i,
  /position[_\s-]*limit/i,
  /ticker[_\s-]*exposure/i,
  /stock[_\s-]*exposure/i,
  /maxPositionAmount/i,
  /POSITION_LIMIT_EXCEEDED/i,
  /TICKER_EXPOSURE/i,
];

const sectorExposurePatterns = [
  /sector[_\s-]*exposure/i,
  /sector[_\s-]*limit/i,
  /max[_\s-]*sector/i,
  /maxSectorAmount/i,
  /SECTOR_LIMIT/i,
  /SECTOR_EXPOSURE/i,
];

const portfolioExposurePatterns = [
  /portfolio[_\s-]*exposure/i,
  /portfolio[_\s-]*limit/i,
  /maxPortfolioAmount/i,
  /MAX_PORTFOLIO/i,
];

const killSwitchPatterns = [
  /kill[_\s-]*switch/i,
  /emergency[_\s-]*stop/i,
  /trading[_\s-]*enabled/i,
  /paper[_\s-]*order[_\s-]*enabled/i,
  /TRADING_DISABLED/i,
  /KILL_SWITCH/i,
];

const dbGuardPatterns = [
  /create\s+or\s+replace\s+function/i,
  /create\s+trigger/i,
  /raise\s+exception/i,
  /for\s+update/i,
];

const stressPatterns = [
  /stress/i,
  /regression/i,
  /runtime[_\s-]*test/i,
  /rollback/i,
  /fixture/i,
  /concurrent/i,
];

const riskRpcPatterns = [
  /\.rpc\s*\(/i,
  /rpc\//i,
  /validate.*risk/i,
  /risk[_\s-]*decision/i,
];

const productionRuntimePatterns = [
  /lib\/trading/i,
  /app\/api/i,
];

const dailyHits =
  hitsFor(dailyLossPatterns);

const tickerHits =
  hitsFor(tickerExposurePatterns);

const sectorHits =
  hitsFor(sectorExposurePatterns);

const portfolioHits =
  hitsFor(portfolioExposurePatterns);

const killHits =
  hitsFor(killSwitchPatterns);

function intersectFiles(
  baseHits,
  requiredPatterns,
) {
  const byFile =
    new Map(
      corpus.map(
        (x) => [x.file, x.text],
      ),
    );

  return baseHits
    .filter((hit) => {
      const text =
        byFile.get(hit.file) || "";

      return requiredPatterns.some(
        (p) => p.test(text),
      );
    })
    .map((x) => x.file);
}

function unique(arr) {
  return [...new Set(arr)];
}

const dailyDbGuards =
  unique(
    intersectFiles(
      dailyHits,
      dbGuardPatterns,
    ),
  );

const tickerDbGuards =
  unique(
    intersectFiles(
      tickerHits,
      dbGuardPatterns,
    ),
  );

const sectorDbGuards =
  unique(
    intersectFiles(
      sectorHits,
      dbGuardPatterns,
    ),
  );

const killDbGuards =
  unique(
    intersectFiles(
      killHits,
      dbGuardPatterns,
    ),
  );

const dailyStress =
  unique(
    intersectFiles(
      dailyHits,
      stressPatterns,
    ),
  );

const tickerStress =
  unique(
    intersectFiles(
      tickerHits,
      stressPatterns,
    ),
  );

const sectorStress =
  unique(
    intersectFiles(
      sectorHits,
      stressPatterns,
    ),
  );

const killStress =
  unique(
    intersectFiles(
      killHits,
      stressPatterns,
    ),
  );

const runtimeRiskFiles =
  corpus
    .filter(
      (x) =>
        (
          x.file.startsWith("lib/trading/") ||
          x.file.startsWith("app/api/")
        ) &&
        (
          dailyLossPatterns.some(
            (p) => p.test(x.text),
          ) ||
          tickerExposurePatterns.some(
            (p) => p.test(x.text),
          ) ||
          sectorExposurePatterns.some(
            (p) => p.test(x.text),
          ) ||
          killSwitchPatterns.some(
            (p) => p.test(x.text),
          ) ||
          riskRpcPatterns.some(
            (p) => p.test(x.text),
          )
        ),
    )
    .map((x) => x.file);

const namedMigrationSignals = {
  killSwitchCreateFillGuard:
    corpus
      .filter(
        (x) =>
          /kill[_\s-]*switch/i.test(
            x.file,
          ) &&
          /create[_\s-]*fill[_\s-]*guards/i.test(
            x.file,
          ),
      )
      .map((x) => x.file),

  committedRiskReservation:
    corpus
      .filter(
        (x) =>
          /committed[_\s-]*risk[_\s-]*reservation/i.test(
            x.file,
          ),
      )
      .map((x) => x.file),

  riskValidation:
    corpus
      .filter(
        (x) =>
          /risk/i.test(x.file) &&
          (
            /validate/i.test(x.file) ||
            /validation/i.test(x.file)
          ),
      )
      .map((x) => x.file)
      .slice(0, 30),
};

function classify(
  hasSignals,
  dbGuards,
  stressFiles,
) {
  if (!hasSignals) {
    return "MISSING_OR_NOT_DISCOVERED";
  }

  if (
    dbGuards.length > 0 &&
    stressFiles.length > 0
  ) {
    return "IMPLEMENTED_WITH_STRESS_EVIDENCE";
  }

  if (dbGuards.length > 0) {
    return "IMPLEMENTED_DB_GUARD_STRESS_GAP";
  }

  if (stressFiles.length > 0) {
    return "SIGNALS_AND_TESTS_FOUND_DB_GUARD_NOT_PROVEN";
  }

  return "IMPLEMENTATION_SIGNALS_FOUND_STRESS_GAP";
}

const dimensions = {
  dailyLoss: {
    classification:
      classify(
        dailyHits.length > 0,
        dailyDbGuards,
        dailyStress,
      ),

    signalFiles:
      dailyHits
        .map((x) => x.file)
        .slice(0, 40),

    dbGuardFiles:
      dailyDbGuards.slice(0, 30),

    stressFiles:
      dailyStress.slice(0, 30),
  },

  tickerExposure: {
    classification:
      classify(
        tickerHits.length > 0,
        tickerDbGuards,
        tickerStress,
      ),

    signalFiles:
      tickerHits
        .map((x) => x.file)
        .slice(0, 40),

    dbGuardFiles:
      tickerDbGuards.slice(0, 30),

    stressFiles:
      tickerStress.slice(0, 30),
  },

  sectorExposure: {
    classification:
      classify(
        sectorHits.length > 0,
        sectorDbGuards,
        sectorStress,
      ),

    signalFiles:
      sectorHits
        .map((x) => x.file)
        .slice(0, 40),

    dbGuardFiles:
      sectorDbGuards.slice(0, 30),

    stressFiles:
      sectorStress.slice(0, 30),
  },

  portfolioExposure: {
    classification:
      classify(
        portfolioHits.length > 0,
        unique(
          intersectFiles(
            portfolioHits,
            dbGuardPatterns,
          ),
        ),
        unique(
          intersectFiles(
            portfolioHits,
            stressPatterns,
          ),
        ),
      ),

    signalFiles:
      portfolioHits
        .map((x) => x.file)
        .slice(0, 40),
  },

  killSwitch: {
    classification:
      classify(
        killHits.length > 0,
        killDbGuards,
        killStress,
      ),

    signalFiles:
      killHits
        .map((x) => x.file)
        .slice(0, 50),

    dbGuardFiles:
      killDbGuards.slice(0, 40),

    stressFiles:
      killStress.slice(0, 40),
  },
};

const gaps = [];

for (const [
  name,
  value,
] of Object.entries(dimensions)) {
  if (
    value.classification !==
    "IMPLEMENTED_WITH_STRESS_EVIDENCE"
  ) {
    gaps.push(
      name.toUpperCase() +
      ":" +
      value.classification,
    );
  }
}

const existingStressCount =
  [
    ...dailyStress,
    ...tickerStress,
    ...sectorStress,
    ...killStress,
  ].filter(
    (v, i, arr) =>
      arr.indexOf(v) === i,
  ).length;

let nextGate;

if (
  gaps.length === 0
) {
  nextGate =
    "RUN_EXISTING_RISK_STRESS_SUITE_AND_VERIFY_DB_FAIL_CLOSED";
}
else if (
  dailyDbGuards.length > 0 ||
  tickerDbGuards.length > 0 ||
  sectorDbGuards.length > 0 ||
  killDbGuards.length > 0
) {
  nextGate =
    "BUILD_ONLY_MISSING_DB_LEVEL_RISK_STRESS_HARNESSES";
}
else {
  nextGate =
    "PROBE_AND_BIND_MISSING_RISK_DB_GUARDS_BEFORE_STRESS";
}

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_RISK_DAILY_LOSS_EXPOSURE_KILL_SWITCH_CURRENT_STATE_AUDIT_V1_COMPLETE",

      classification:
        gaps.length === 0
          ? "RISK_STRESS_BASELINE_COMPLETE"
          : "RISK_STRESS_BASELINE_PARTIAL",

      scanned: {
        files:
          corpus.length,

        roots:
          SEARCH_ROOTS,
      },

      dimensions,

      productionRuntime: {
        relevantFiles:
          runtimeRiskFiles
            .slice(0, 60),

        riskRpcSignalsFound:
          any(riskRpcPatterns),
      },

      namedMigrationSignals,

      derived: {
        dailyLossSignals:
          dailyHits.length > 0,

        dailyLossDbGuard:
          dailyDbGuards.length > 0,

        dailyLossStress:
          dailyStress.length > 0,

        tickerExposureSignals:
          tickerHits.length > 0,

        tickerExposureDbGuard:
          tickerDbGuards.length > 0,

        tickerExposureStress:
          tickerStress.length > 0,

        sectorExposureSignals:
          sectorHits.length > 0,

        sectorExposureDbGuard:
          sectorDbGuards.length > 0,

        sectorExposureStress:
          sectorStress.length > 0,

        killSwitchSignals:
          killHits.length > 0,

        killSwitchDbGuard:
          killDbGuards.length > 0,

        killSwitchStress:
          killStress.length > 0,

        existingRiskStressFileCount:
          existingStressCount,
      },

      gaps,

      safety: {
        sourceOnly:
          true,

        databaseReads:
          0,

        databaseWrites:
          0,

        networkCalls:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        realTradingEnabled:
          false,
      },

      nextGate,
    },
    null,
    2,
  ),
);
