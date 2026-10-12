const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function read(rel) {
  const full =
    path.join(ROOT, rel);

  return fs.existsSync(full)
    ? fs.readFileSync(
        full,
        "utf8",
      )
    : null;
}

function extractFunction(
  source,
  functionName,
) {
  if (!source) {
    return null;
  }

  const needle =
    "create or replace function public." +
    functionName +
    "(";

  const start =
    source.lastIndexOf(
      needle,
    );

  if (start < 0) {
    return null;
  }

  const bodyStart =
    source.indexOf(
      "as $$",
      start,
    );

  if (bodyStart < 0) {
    return null;
  }

  const end =
    source.indexOf(
      "$$;",
      bodyStart + 5,
    );

  if (end < 0) {
    return null;
  }

  return source.slice(
    start,
    end + 3,
  );
}

function compactLines(
  source,
  patterns,
  limit = 60,
) {
  if (!source) {
    return [];
  }

  const lines =
    source.split(/\r?\n/);

  const out = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line =
      lines[i];

    if (
      patterns.some(
        (pattern) =>
          pattern.test(line),
      )
    ) {
      out.push({
        line:
          i + 1,

        text:
          line.trim(),
      });

      if (
        out.length >= limit
      ) {
        break;
      }
    }
  }

  return out;
}

const targets = {
  policy:
    "lib/trading/policy.ts",

  riskManager:
    "lib/trading/risk-manager.ts",

  paperOrderService:
    "lib/trading/paper-order-service.ts",

  committedRiskReservation:
    "lib/trading/committed-risk-reservation.ts",
};

const source = {};

for (const [
  key,
  rel,
] of Object.entries(targets)) {
  source[key] =
    read(rel);
}

const migDir =
  path.join(
    ROOT,
    "supabase",
    "migrations",
  );

const migrationFiles =
  fs.existsSync(migDir)
    ? fs.readdirSync(migDir)
        .filter(
          (name) =>
            name.endsWith(".sql"),
        )
        .sort()
    : [];

const createFnName =
  "create_paper_buy_order_with_committed_risk_v3";

const createDefinitions = [];

for (const name of migrationFiles) {
  const rel =
    "supabase/migrations/" +
    name;

  const text =
    read(rel);

  if (
    !text ||
    !text.includes(
      "create or replace function public." +
      createFnName +
      "(",
    )
  ) {
    continue;
  }

  const block =
    extractFunction(
      text,
      createFnName,
    );

  if (block) {
    createDefinitions.push({
      migration:
        rel,

      block,
    });
  }
}

const latestCreate =
  createDefinitions.length
    ? createDefinitions[
        createDefinitions.length - 1
      ]
    : null;

const fn =
  latestCreate
    ? latestCreate.block
    : "";

const appPatterns = {
  position:
    /POSITION_LIMIT_EXCEEDED|maxPositionAmount|currentStockExposureAmount|maxPositionRate/,

  sector:
    /SECTOR_LIMIT_EXCEEDED|maxSectorAmount|currentSectorExposureAmount|maxSectorExposureRate/,

  portfolio:
    /PORTFOLIO_LIMIT_EXCEEDED|maxPortfolioAmount|currentInvestedAmount|maxPortfolioExposureRate/,

  dailyLoss:
    /DAILY_LOSS|maxDailyLoss|dailyRealizedPnl|daily_realized_pnl/i,
};

const appEvidence = {};

for (const [
  dimension,
  pattern,
] of Object.entries(
  appPatterns,
)) {
  appEvidence[dimension] = {
    riskManager:
      compactLines(
        source.riskManager,
        [pattern],
      ),

    policy:
      compactLines(
        source.policy,
        [pattern],
      ),

    paperOrderService:
      compactLines(
        source.paperOrderService,
        [pattern],
      ),

    committedRiskReservation:
      compactLines(
        source.committedRiskReservation,
        [pattern],
      ),
  };
}

const dbSignals = {
  hasFunction:
    Boolean(latestCreate),

  functionMigration:
    latestCreate
      ? latestCreate.migration
      : null,

  queriesPaperPositions:
    /\bpaper_positions\b/i.test(
      fn,
    ),

  queriesStocks:
    /\bstocks\b/i.test(
      fn,
    ),

  referencesSector:
    /\bsector\b/i.test(
      fn,
    ),

  aggregatesExposure:
    /\bsum\s*\(/i.test(
      fn,
    ) &&
    (
      /quantity/i.test(fn) ||
      /average_price/i.test(fn) ||
      /entry_price/i.test(fn)
    ),

  referencesPositionLimit:
    /POSITION_LIMIT_EXCEEDED|max_position|maxPosition|position_limit/i
      .test(fn),

  referencesSectorLimit:
    /SECTOR_LIMIT_EXCEEDED|max_sector|maxSector|sector_limit/i
      .test(fn),

  referencesPortfolioLimit:
    /PORTFOLIO_LIMIT_EXCEEDED|max_portfolio|maxPortfolio|portfolio_limit/i
      .test(fn),

  referencesDailyLoss:
    /daily_realized_pnl|DAILY_LOSS|max_daily_loss|daily_loss/i
      .test(fn),

  referencesReservedRisk:
    /reserved_risk_amount/i
      .test(fn),

  locksAccount:
    /from\s+public\.paper_accounts[\s\S]{0,300}for\s+update/i
      .test(fn),

  locksOrChecksPositions:
    /from\s+public\.paper_positions[\s\S]{0,300}for\s+update/i
      .test(fn),

  insertsOrder:
    /insert\s+into\s+public\.paper_order_requests/i
      .test(fn),

  hasFailClosedExceptions:
    /raise\s+exception/i
      .test(fn),

  killSwitchGuard:
    /kill[_\s-]*switch|emergency[_\s-]*stop|paper[_\s-]*order[_\s-]*enabled/i
      .test(fn),

  freshnessGuard:
    /freshness|stale|market_snapshot/i
      .test(fn),
};

const dbEvidence =
  compactLines(
    fn,
    [
      /paper_positions/i,
      /\bstocks\b/i,
      /\bsector\b/i,
      /\bsum\s*\(/i,
      /POSITION_LIMIT/i,
      /SECTOR_LIMIT/i,
      /PORTFOLIO_LIMIT/i,
      /daily_realized_pnl/i,
      /reserved_risk_amount/i,
      /raise exception/i,
      /for update/i,
      /insert into public\.paper_order_requests/i,
      /kill[_\s-]*switch/i,
      /paper[_\s-]*order[_\s-]*enabled/i,
      /freshness/i,
      /market_snapshot/i,
    ],
    100,
  );

function appFound(
  dimension,
) {
  const evidence =
    appEvidence[
      dimension
    ];

  return Object.values(
    evidence,
  ).some(
    (arr) =>
      arr.length > 0,
  );
}

const dimensions = {
  tickerExposure: {
    appGuard:
      appFound(
        "position",
      ),

    dbGuard:
      dbSignals.referencesPositionLimit ||
      (
        dbSignals.queriesPaperPositions &&
        dbSignals.aggregatesExposure &&
        /stock_code/i.test(fn)
      ),
  },

  sectorExposure: {
    appGuard:
      appFound(
        "sector",
      ),

    dbGuard:
      dbSignals.referencesSectorLimit ||
      (
        dbSignals.queriesPaperPositions &&
        dbSignals.queriesStocks &&
        dbSignals.referencesSector &&
        dbSignals.aggregatesExposure
      ),
  },

  portfolioExposure: {
    appGuard:
      appFound(
        "portfolio",
      ),

    dbGuard:
      dbSignals.referencesPortfolioLimit ||
      (
        dbSignals.queriesPaperPositions &&
        dbSignals.aggregatesExposure &&
        !dbSignals.referencesSector
      ),
  },

  dailyLoss: {
    appGuard:
      appFound(
        "dailyLoss",
      ),

    dbGuard:
      dbSignals.referencesDailyLoss,
  },
};

for (const value of Object.values(
  dimensions,
)) {
  value.classification =
    value.appGuard &&
    value.dbGuard
      ? "APP_AND_DB_DEFENSE_IN_DEPTH"
      : value.appGuard
        ? "APP_GUARD_ONLY_DB_GUARD_NOT_PROVEN"
        : value.dbGuard
          ? "DB_GUARD_ONLY_APP_GUARD_NOT_PROVEN"
          : "GUARD_NOT_PROVEN";
}

const exposureDbGuardsProven =
  dimensions.tickerExposure.dbGuard &&
  dimensions.sectorExposure.dbGuard &&
  dimensions.portfolioExposure.dbGuard;

const missing = [];

for (const [
  name,
  value,
] of Object.entries(
  dimensions,
)) {
  if (
    name !== "dailyLoss" &&
    !value.dbGuard
  ) {
    missing.push(
      name,
    );
  }
}

let nextGate;

if (
  exposureDbGuardsProven
) {
  nextGate =
    "BUILD_DB_LEVEL_EXPOSURE_STRESS_USING_EXISTING_GUARDS";
}
else if (
  latestCreate
) {
  nextGate =
    "DESIGN_MINIMAL_DB_EXPOSURE_GUARD_FOR_COMMITTED_RISK_ORDER_CREATE";
}
else {
  nextGate =
    "REPAIR_OR_LOCATE_COMMITTED_RISK_ORDER_CREATE_RPC_FIRST";
}

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_RISK_EXPOSURE_DB_BINDING_DETAIL_PROBE_V1_COMPLETE",

      classification:
        exposureDbGuardsProven
          ? "EXPOSURE_DB_GUARDS_PROVEN"
          : "EXPOSURE_DB_DEFENSE_IN_DEPTH_GAP_CONFIRMED_OR_PARTIAL",

      files: {
        policy: {
          path:
            targets.policy,

          exists:
            source.policy !== null,
        },

        riskManager: {
          path:
            targets.riskManager,

          exists:
            source.riskManager !== null,
        },

        paperOrderService: {
          path:
            targets.paperOrderService,

          exists:
            source.paperOrderService !== null,
        },

        committedRiskReservation: {
          path:
            targets.committedRiskReservation,

          exists:
            source.committedRiskReservation !== null,
        },
      },

      createOrderRpc: {
        function:
          createFnName,

        definitionCount:
          createDefinitions.length,

        latestMigration:
          latestCreate
            ? latestCreate.migration
            : null,

        signals:
          dbSignals,

        evidence:
          dbEvidence,
      },

      appEvidence,
      dimensions,

      missingDbExposureGuards:
        missing,

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
