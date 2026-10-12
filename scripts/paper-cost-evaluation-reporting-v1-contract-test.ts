import {
  resolveCanonicalPaperTradePnl,
  resolveCanonicalPaperTradeReturn,
} from "../lib/trading/paper-cost-attribution-view";

const attributed = {
  realized_pnl:
    100_000,
  realized_return:
    0.1,
  gross_pnl:
    100_000,
  net_pnl:
    97_485,
  net_return:
    0.097485,
  total_transaction_cost:
    2_515,
  cost_attribution_complete:
    true,
};

const legacy = {
  realized_pnl:
    -25_000,
  realized_return:
    -0.025,
  gross_pnl:
    null,
  net_pnl:
    null,
  net_return:
    null,
  total_transaction_cost:
    null,
  cost_attribution_complete:
    false,
};

const incomplete = {
  realized_pnl:
    12_000,
  realized_return:
    0.012,
  gross_pnl:
    13_000,
  net_pnl:
    11_500,
  net_return:
    0.0115,
  total_transaction_cost:
    1_500,
  cost_attribution_complete:
    false,
};

const attributedPnl =
  resolveCanonicalPaperTradePnl(
    attributed,
  );

const attributedReturn =
  resolveCanonicalPaperTradeReturn(
    attributed,
  );

const legacyPnl =
  resolveCanonicalPaperTradePnl(
    legacy,
  );

const legacyReturn =
  resolveCanonicalPaperTradeReturn(
    legacy,
  );

const incompletePnl =
  resolveCanonicalPaperTradePnl(
    incomplete,
  );

const checks = {
  attributedUsesNetPnl:
    attributedPnl.pnl ===
    97_485,

  attributedGrossPreserved:
    attributedPnl.grossPnl ===
    100_000,

  attributedCostVisible:
    attributedPnl.totalTransactionCost ===
    2_515,

  attributedSource:
    attributedPnl.source ===
    "NET_PNL_COST_ATTRIBUTED",

  attributedUsesNetReturn:
    attributedReturn.value ===
    0.097485,

  legacyUsesRealizedPnl:
    legacyPnl.pnl ===
    -25_000,

  legacyUsesRealizedReturn:
    legacyReturn.value ===
    -0.025,

  legacySource:
    legacyPnl.source ===
    "LEGACY_REALIZED_PNL",

  incompleteFailsClosedToLegacy:
    incompletePnl.pnl ===
      12_000 &&
    incompletePnl.source ===
      "LEGACY_REALIZED_PNL",
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, ok]) =>
        ok !== true,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_CONTRACT_VERIFIED"
          : "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_CONTRACT_FAILED",

      checks,

      samples: {
        attributed: {
          pnl:
            attributedPnl,
          return:
            attributedReturn,
        },

        legacy: {
          pnl:
            legacyPnl,
          return:
            legacyReturn,
        },

        incomplete:
          incompletePnl,
      },

      policy: {
        canonical:
          "cost_attribution_complete=true + net_pnl non-null => net PnL",
        fallback:
          "otherwise realized_pnl",
        legacyCompatibility:
          true,
      },

      safety: {
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

      failed,
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
