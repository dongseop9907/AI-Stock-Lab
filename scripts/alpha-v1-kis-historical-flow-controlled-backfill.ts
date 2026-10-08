import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const VERSION =
  "ALPHA_V1_KIS_HISTORICAL_FLOW_CONTROLLED_BACKFILL";

const INPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs",
    "alpha-v1-kis-historical-flow-coverage-read-only.json",
  );

const WRITE_ENABLED =
  process.argv.includes(
    "--write",
  );

const RANGE_START =
  "20260730";

const RANGE_END =
  "20261002";

function compactDate(
  value: string,
) {
  return value
    .replace(
      /-/g,
      "",
    )
    .trim();
}

function isoDate(
  value: string,
) {
  const normalized =
    compactDate(
      value,
    );

  return `${normalized.slice(0,4)}-${normalized.slice(4,6)}-${normalized.slice(6,8)}`;
}

async function main() {
  const report =
    JSON.parse(
      fs.readFileSync(
        INPUT_FILE,
        "utf8",
      ),
    );

  if (
    report
      ?.backfillDecision
      ?.historicalFlowCoverageProven !==
    true
  ) {
    throw new Error(
      "HISTORICAL_FLOW_COVERAGE_NOT_PROVEN",
    );
  }

  const sourceRows =
    Array.isArray(
      report.normalizedRows,
    )
      ? report.normalizedRows
      : [];

  const unique =
    new Map<
      string,
      any
    >();

  for (
    const row
    of sourceRows
  ) {
    const stockCode =
      String(
        row.stockCode ??
        "",
      );

    const tradingDate =
      String(
        row.tradingDate ??
        "",
      );

    if (
      !/^\d{6}$/.test(
        stockCode,
      ) ||
      !/^\d{8}$/.test(
        tradingDate,
      )
    ) {
      continue;
    }

    if (
      tradingDate <
        RANGE_START ||
      tradingDate >
        RANGE_END
    ) {
      continue;
    }

    unique.set(
      `${stockCode}|${tradingDate}`,
      {
        stock_code:
          stockCode,

        trading_date:
          isoDate(
            tradingDate,
          ),

        close_price:
          row.closePrice ??
          null,

        accumulated_volume:
          row.accumulatedVolume ??
          null,

        accumulated_trading_value:
          row.accumulatedTradingValue ??
          null,

        individual_net_buy_quantity:
          row.individualNetBuyQuantity ??
          null,

        foreign_net_buy_quantity:
          row.foreignNetBuyQuantity ??
          null,

        institution_net_buy_quantity:
          row.institutionNetBuyQuantity ??
          null,

        individual_net_buy_amount:
          row.individualNetBuyAmount ??
          null,

        foreign_net_buy_amount:
          row.foreignNetBuyAmount ??
          null,

        institution_net_buy_amount:
          row.institutionNetBuyAmount ??
          null,

        source:
          "KIS_INVESTOR_TRADE_BY_STOCK_DAILY",

        source_version:
          "FHPTJ04160001",

        raw_payload:
          row,
      },
    );
  }

  const rows =
    [...unique.values()]
      .sort(
        (
          a,
          b,
        ) =>
          `${a.stock_code}|${a.trading_date}`
            .localeCompare(
              `${b.stock_code}|${b.trading_date}`,
            ),
      );

  const result: any = {
    status:
      WRITE_ENABLED
        ? "ALPHA_V1_KIS_HISTORICAL_FLOW_BACKFILL_COMPLETE"
        : "ALPHA_V1_KIS_HISTORICAL_FLOW_BACKFILL_DRY_RUN_COMPLETE",

    version:
      VERSION,

    writeEnabled:
      WRITE_ENABLED,

    inputRows:
      sourceRows.length,

    eligibleUniqueRows:
      rows.length,

    range: {
      start:
        RANGE_START,

      end:
        RANGE_END,
    },

    safety: {
      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },
  };

  if (
    !WRITE_ENABLED
  ) {
    console.log(
      JSON.stringify(
        result,
        null,
        2,
      ),
    );

    return;
  }

  const supabase =
    createSupabaseServerClient();

  const chunkSize =
    200;

  let written =
    0;

  for (
    let index =
      0;
    index <
      rows.length;
    index +=
      chunkSize
  ) {
    const chunk =
      rows.slice(
        index,
        index +
        chunkSize,
      );

    const write =
      await supabase
        .from(
          "kis_investor_flow_daily",
        )
        .upsert(
          chunk,
          {
            onConflict:
              "stock_code,trading_date",

            ignoreDuplicates:
              false,
          },
        );

    if (
      write.error
    ) {
      throw new Error(
        `HISTORICAL_FLOW_UPSERT_FAILED:${write.error.message}`,
      );
    }

    written +=
      chunk.length;
  }

  result.writtenRows =
    written;

  result.safety.databaseWrites =
    written;

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );
}

main().catch(
  (
    error,
  ) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V1_KIS_HISTORICAL_FLOW_BACKFILL_FAILED",

          version:
            VERSION,

          writeEnabled:
            WRITE_ENABLED,

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          ordersCreated:
            0,

          positionsChanged:
            0,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
