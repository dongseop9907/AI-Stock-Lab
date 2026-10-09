import {
  strict as assert,
} from "node:assert";

import {
  getBuiltInVerifiedKrxOverrides,
  isKrxTradingDate,
  mergeVerifiedKrxOverrides,
  nextKrxTradingDate,
  previousKrxTradingDate,
  resolveExpectedKrxMarketDate,
} from "../lib/trading/krx-trading-calendar";

function main() {
  const checks:
    Record<string, boolean> = {};

  checks.normalWeekdayOpen =
    isKrxTradingDate(
      "2026-10-08",
    ) ===
      true;

  checks.hangeulDayClosed =
    isKrxTradingDate(
      "2026-10-09",
    ) ===
      false;

  checks.weekendClosed =
    isKrxTradingDate(
      "2026-10-10",
    ) ===
      false &&
    isKrxTradingDate(
      "2026-10-11",
    ) ===
      false;

  checks.nextSessionSkipsHolidayAndWeekend =
    nextKrxTradingDate(
      "2026-10-08",
    ) ===
      "2026-10-12";

  checks.previousSessionSkipsHolidayAndWeekend =
    previousKrxTradingDate(
      "2026-10-12",
    ) ===
      "2026-10-08";

  checks.runtimeVerifiedClosureApplied =
    isKrxTradingDate(
      "2026-10-13",
      [
        {
          calendar_date:
            "2026-10-13",
          is_open:
            false,
          verified:
            true,
          reason:
            "TEST_VERIFIED_CLOSURE",
        },
      ],
    ) ===
      false;

  checks.unverifiedOverrideIgnored =
    isKrxTradingDate(
      "2026-10-13",
      [
        {
          calendar_date:
            "2026-10-13",
          is_open:
            false,
          verified:
            false,
        },
      ],
    ) ===
      true;

  checks.builtInClosureWinsConflict =
    isKrxTradingDate(
      "2026-10-09",
      [
        {
          calendar_date:
            "2026-10-09",
          is_open:
            true,
          verified:
            true,
        },
      ],
    ) ===
      false;

  checks.beforeReadyUsesPreviousSession =
    resolveExpectedKrxMarketDate({
      now:
        new Date(
          "2026-10-12T01:00:00.000Z",
        ),
    }) ===
      "2026-10-08";

  checks.afterReadyUsesSameSession =
    resolveExpectedKrxMarketDate({
      now:
        new Date(
          "2026-10-12T08:00:00.000Z",
        ),
    }) ===
      "2026-10-12";

  checks.holidayUsesPreviousSession =
    resolveExpectedKrxMarketDate({
      now:
        new Date(
          "2026-10-09T10:00:00.000Z",
        ),
    }) ===
      "2026-10-08";

  const merged =
    mergeVerifiedKrxOverrides([
      {
        date:
          "2026-10-13",
        isOpen:
          false,
        verified:
          true,
      },
    ]);

  checks.mergeContainsBuiltInAndRuntime =
    merged.some(
      (row) =>
        row.date ===
          "2026-10-09" &&
        row.isOpen ===
          false,
    ) &&
    merged.some(
      (row) =>
        row.date ===
          "2026-10-13" &&
        row.isOpen ===
          false,
    );

  checks.builtInCalendarPresent =
    getBuiltInVerifiedKrxOverrides()
      .some(
        (row) =>
          row.date ===
            "2026-10-09" &&
          row.isOpen ===
            false,
      );

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          !value,
      )
      .map(
        ([name]) =>
          name,
      );

  assert.equal(
    failed.length,
    0,
    `FAILED:${failed.join(",")}`,
  );

  console.log(
    JSON.stringify(
      {
        status:
          "KRX_CANONICAL_TRADING_CALENDAR_V1_CONTRACT_VERIFIED",

        checks,

        examples: {
          after20261008:
            nextKrxTradingDate(
              "2026-10-08",
            ),

          before20261012:
            previousKrxTradingDate(
              "2026-10-12",
            ),

          expectedOnHoliday:
            resolveExpectedKrxMarketDate({
              now:
                new Date(
                  "2026-10-09T10:00:00.000Z",
                ),
            }),
        },

        safety: {
          databaseReads: 0,
          databaseWrites: 0,
          networkCalls: 0,
          ordersCreated: 0,
          positionsChanged: 0,
          productionChanged: false,
        },

        nextGate:
          "BIND_FORWARD_AND_FRESHNESS_TO_CANONICAL_CALENDAR",
      },
      null,
      2,
    ),
  );
}

main();
