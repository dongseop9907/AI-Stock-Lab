import fs from "node:fs";
import path from "node:path";

import {
  getDomesticDailyStockPrices,
  getKisAccessToken,
} from "../lib/kis/client";

const VERSION =
  "ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE";

const TARGETS = [
  "005930",
  "035420",
  "035720",
];

const START_DATE =
  "20260601";

const END_DATE =
  "20261002";

const REQUEST_DELAY_MS =
  1200;

function sleep(
  milliseconds: number,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function toNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function compactRow(
  row: Record<string, unknown>,
) {
  return {
    tradingDate:
      String(
        row.stck_bsop_date ??
        "",
      ) || null,

    close:
      toNumber(
        row.stck_clpr,
      ),

    open:
      toNumber(
        row.stck_oprc,
      ),

    high:
      toNumber(
        row.stck_hgpr,
      ),

    low:
      toNumber(
        row.stck_lwpr,
      ),

    volume:
      toNumber(
        row.acml_vol,
      ),

    tradingValue:
      toNumber(
        row.acml_tr_pbmn,
      ),

    modified:
      row.mod_yn ??
      null,
  };
}

async function main() {
  const accessToken =
    await getKisAccessToken();

  const results:
    Array<Record<string, unknown>> =
    [];

  let successful = 0;
  let failed = 0;

  for (
    let index = 0;
    index < TARGETS.length;
    index += 1
  ) {
    const stockCode =
      TARGETS[index];

    try {
      const response =
        await getDomesticDailyStockPrices(
          {
            stockCode,

            startDate:
              START_DATE,

            endDate:
              END_DATE,

            period:
              "D",

            /**
             * Existing canonical contract:
             * adjustedPrice=true -> FID_ORG_ADJ_PRC=0
             */
            adjustedPrice:
              true,
          },
          accessToken,
        );

      const rows =
        Array.isArray(
          response.output2,
        )
          ? response.output2
          : [];

      const compact =
        rows
          .map(
            (
              row:
              Record<string, unknown>,
            ) =>
              compactRow(row),
          )
          .filter(
            (row) =>
              Boolean(
                row.tradingDate,
              ),
          )
          .sort(
            (a, b) =>
              String(
                b.tradingDate,
              ).localeCompare(
                String(
                  a.tradingDate,
                ),
              ),
          );

      const uniqueDates =
        new Set(
          compact.map(
            (row) =>
              row.tradingDate,
          ),
        );

      const invalidPriceRows =
        compact.filter(
          (row) =>
            row.close ===
              null ||
            row.close <=
              0 ||
            row.open ===
              null ||
            row.high ===
              null ||
            row.low ===
              null,
        ).length;

      successful += 1;

      results.push({
        stockCode,

        status:
          "OK",

        rtCd:
          response.rt_cd,

        msgCd:
          response.msg_cd,

        msg:
          response.msg1,

        rowCount:
          compact.length,

        uniqueDateCount:
          uniqueDates.size,

        duplicateDateCount:
          compact.length -
          uniqueDates.size,

        invalidPriceRows,

        latest:
          compact[0] ??
          null,

        oldest:
          compact.at(-1) ??
          null,

        sampleLatest:
          compact.slice(
            0,
            5,
          ),

        enoughFor20Day:
          compact.length >=
          20,

        enoughFor60Day:
          compact.length >=
          60,
      });
    } catch (error) {
      failed += 1;

      results.push({
        stockCode,

        status:
          "FAILED",

        error:
          String(
            error instanceof Error
              ? error.message
              : error,
          ),
      });
    }

    if (
      index <
      TARGETS.length - 1
    ) {
      await sleep(
        REQUEST_DELAY_MS,
      );
    }
  }

  const allUsable =
    results.every(
      (row) =>
        row.status ===
          "OK" &&
        row.enoughFor60Day ===
          true &&
        Number(
          row.invalidPriceRows ??
          1,
        ) ===
          0 &&
        Number(
          row.duplicateDateCount ??
          1,
        ) ===
          0,
    );

  const report = {
    status:
      allUsable
        ? "ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE_COMPLETE"
        : "ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE_COMPLETE_WITH_GAPS",

    version:
      VERSION,

    request: {
      targets:
        TARGETS,

      startDate:
        START_DATE,

      endDate:
        END_DATE,

      period:
        "D",

      adjustedPrice:
        true,

      canonicalKisMode:
        "FID_ORG_ADJ_PRC=0",
    },

    counts: {
      requested:
        TARGETS.length,

      successful,

      failed,

      usableFor60DayAlpha:
        results.filter(
          (row) =>
            row.status ===
              "OK" &&
            row.enoughFor60Day ===
              true &&
            Number(
              row.invalidPriceRows ??
              1,
            ) ===
              0 &&
            Number(
              row.duplicateDateCount ??
              1,
            ) ===
              0,
        ).length,
    },

    results,

    conclusion: {
      kisSurfaceAvailable:
        successful ===
        TARGETS.length,

      safeToPrepareControlledBackfill:
        allUsable,

      databaseWriteAllowedNow:
        false,

      reason:
        allUsable
          ? "KIS_ADJUSTED_DAILY_SURFACE_VALIDATED_FOR_ALL_MISSING_ALPHA_STOCKS"
          : "KIS_DAILY_SURFACE_MUST_BE_REVIEWED_BEFORE_ANY_BACKFILL",
    },

    safety: {
      databaseReads:
        0,

      databaseWrites:
        0,

      kisDailyRequests:
        TARGETS.length,

      tokenRequest:
        "GET_KIS_ACCESS_TOKEN_MAY_ISSUE_ONE_TOKEN_REQUEST",

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionDecisionApplied:
        false,
    },

    nextGate:
      allUsable
        ? "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN"
        : "REVIEW_KIS_MISSING_DAILY_BAR_SURFACE",
  };

  const outputFile =
    path.resolve(
      process.cwd(),
      "logs",
      "alpha-v1-missing-daily-bar-kis-probe.json",
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
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  if (
    successful === 0
  ) {
    process.exitCode =
      2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V1_MISSING_DAILY_BAR_KIS_PROBE_FAILED",

          version:
            VERSION,

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          safety: {
            databaseWrites:
              0,

            ordersCreated:
              0,

            productionDecisionApplied:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
