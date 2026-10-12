import * as freshnessModule
  from "../lib/market/get-market-data-freshness-v7-7";

import {
  isKrxTradingDate,
  nextKrxTradingDate,
  previousKrxTradingDate,
} from "../lib/trading/krx-trading-calendar";

function main() {
  const checks = {
    freshnessModuleImport:
      freshnessModule !== null &&
      typeof freshnessModule ===
        "object" &&
      Object.keys(
        freshnessModule,
      ).length > 0,

    hangeulDayClosed:
      isKrxTradingDate(
        "2026-10-09",
      ) === false,

    nextSession:
      nextKrxTradingDate(
        "2026-10-08",
      ) ===
        "2026-10-12",

    previousSession:
      previousKrxTradingDate(
        "2026-10-12",
      ) ===
        "2026-10-08",
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, value]) =>
          !value,
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
            ? "FRESHNESS_CANONICAL_IMPORT_SMOKE_VERIFIED"
            : "FRESHNESS_CANONICAL_IMPORT_SMOKE_REVIEW",

        checks,
        failed,

        exportedSymbols:
          Object.keys(
            freshnessModule,
          ).slice(0, 20),

        safety: {
          databaseReads: 0,
          databaseWrites: 0,
          networkCalls: 0,
          ordersCreated: 0,
          positionsChanged: 0,
          productionChanged: false,
        },

        nextGate:
          failed.length === 0
            ? "RUN_FORWARD_CONTRACT_AND_FRESHNESS_LIVE_READ_REGRESSION"
            : "REVIEW_FRESHNESS_IMPORT_BINDING",
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) {
    process.exitCode = 2;
  }
}

main();
