import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const EXPECTED_TARGET_COUNT =
  12;

const EXPECTED_ROW_COUNT =
  4572;

const CHUNK_SIZE =
  500;

type DesiredRow = {
  stock_code: string;
  observed_at: string;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number | null;
  volume: number | null;
  raw_payload: Record<string, unknown>;
};

function keyOf(
  row: {
    stock_code: string;
    observed_at: string;
  },
) {
  return (
    `${row.stock_code}|` +
    `${row.observed_at}`
  );
}

function kstDate(
  iso: string,
) {
  const d =
    new Date(
      new Date(
        iso,
      ).getTime() +
      9 *
        60 *
        60 *
        1000,
    );

  return d
    .toISOString()
    .slice(
      0,
      10,
    );
}

function assertFiniteOrNull(
  value: unknown,
  label: string,
) {
  if (
    value !== null &&
    !Number.isFinite(
      Number(
        value,
      ),
    )
  ) {
    throw new Error(
      `INVALID_NUMERIC_VALUE:${label}:${String(value)}`,
    );
  }
}

async function main() {
  const root =
    process.cwd();

  const planPath =
    path.join(
      root,
      "logs",
      "alpha-v2-controlled-intraday-backfill-plan.json",
    );

  const desiredPath =
    path.join(
      root,
      "logs",
      "alpha-v2-controlled-intraday-backfill-desired-rows.json",
    );

  if (
    !fs.existsSync(
      planPath,
    ) ||
    !fs.existsSync(
      desiredPath,
    )
  ) {
    throw new Error(
      "BACKFILL_PLAN_OR_DESIRED_ROWS_FILE_MISSING",
    );
  }

  const plan =
    JSON.parse(
      fs.readFileSync(
        planPath,
        "utf8",
      ),
    );

  const desiredFile =
    JSON.parse(
      fs.readFileSync(
        desiredPath,
        "utf8",
      ),
    );

  if (
    plan.status !==
      "ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_PLAN_COMPLETE" ||
    plan.safeToPrepareApply !==
      true
  ) {
    throw new Error(
      "BACKFILL_PLAN_NOT_APPROVED_FOR_APPLY",
    );
  }

  const rows =
    (
      desiredFile.rows ??
      []
    ) as DesiredRow[];

  const targets =
    (
      plan.targets ??
      []
    ) as Array<{
      stockCode: string;
      targetSessionDate: string;
    }>;

  if (
    targets.length !==
    EXPECTED_TARGET_COUNT
  ) {
    throw new Error(
      `TARGET_COUNT_MISMATCH:${targets.length}:${EXPECTED_TARGET_COUNT}`,
    );
  }

  if (
    rows.length !==
    EXPECTED_ROW_COUNT
  ) {
    throw new Error(
      `ROW_COUNT_MISMATCH:${rows.length}:${EXPECTED_ROW_COUNT}`,
    );
  }

  const uniqueKeys =
    new Set(
      rows.map(
        keyOf,
      ),
    );

  if (
    uniqueKeys.size !==
    rows.length
  ) {
    throw new Error(
      `DUPLICATE_DESIRED_KEYS:${rows.length - uniqueKeys.size}`,
    );
  }

  const targetKeys =
    new Set(
      targets.map(
        (target) =>
          `${target.targetSessionDate}|${target.stockCode}`,
      ),
    );

  const rowsByTarget =
    new Map<
      string,
      DesiredRow[]
    >();

  for (
    const row
    of rows
  ) {
    if (
      !/^\d{6}$/.test(
        row.stock_code,
      )
    ) {
      throw new Error(
        `INVALID_STOCK_CODE:${row.stock_code}`,
      );
    }

    if (
      !row.observed_at ||
      Number.isNaN(
        new Date(
          row.observed_at,
        ).getTime(),
      )
    ) {
      throw new Error(
        `INVALID_OBSERVED_AT:${row.observed_at}`,
      );
    }

    assertFiniteOrNull(
      row.open_price,
      "open_price",
    );

    assertFiniteOrNull(
      row.high_price,
      "high_price",
    );

    assertFiniteOrNull(
      row.low_price,
      "low_price",
    );

    assertFiniteOrNull(
      row.close_price,
      "close_price",
    );

    assertFiniteOrNull(
      row.volume,
      "volume",
    );

    if (
      row.open_price === null ||
      row.high_price === null ||
      row.low_price === null ||
      row.close_price === null ||
      row.volume === null
    ) {
      throw new Error(
        `NULL_REQUIRED_FIELD:${keyOf(row)}`,
      );
    }

    if (
      row.open_price <= 0 ||
      row.high_price <= 0 ||
      row.low_price <= 0 ||
      row.close_price <= 0 ||
      row.volume < 0
    ) {
      throw new Error(
        `INVALID_PRICE_OR_VOLUME:${keyOf(row)}`,
      );
    }

    if (
      row.high_price <
        row.low_price ||
      row.high_price <
        row.open_price ||
      row.high_price <
        row.close_price ||
      row.low_price >
        row.open_price ||
      row.low_price >
        row.close_price
    ) {
      throw new Error(
        `OHLC_INVARIANT_FAILED:${keyOf(row)}`,
      );
    }

    const sessionDate =
      kstDate(
        row.observed_at,
      );

    const targetKey =
      `${sessionDate}|${row.stock_code}`;

    if (
      !targetKeys.has(
        targetKey,
      )
    ) {
      throw new Error(
        `ROW_OUTSIDE_TARGET_SCOPE:${keyOf(row)}:${targetKey}`,
      );
    }

    const raw =
      row.raw_payload ??
      {};

    if (
      raw.source !==
      "KIS_HISTORICAL_INTRADAY_RECONSTRUCTED" ||
      raw.source_version !==
      "FHKST03010230_ALPHA_V2_BACKFILL_V1"
    ) {
      throw new Error(
        `INVALID_LINEAGE:${keyOf(row)}`,
      );
    }

    const arr =
      rowsByTarget.get(
        targetKey,
      ) ??
      [];

    arr.push(
      row,
    );

    rowsByTarget.set(
      targetKey,
      arr,
    );
  }

  for (
    const target
    of targets
  ) {
    const targetKey =
      `${target.targetSessionDate}|${target.stockCode}`;

    const targetRows =
      (
        rowsByTarget.get(
          targetKey,
        ) ??
        []
      )
        .sort(
          (a, b) =>
            new Date(
              a.observed_at,
            ).getTime() -
            new Date(
              b.observed_at,
            ).getTime(),
        );

    if (
      targetRows.length !==
      381
    ) {
      throw new Error(
        `TARGET_ROW_COUNT_NOT_381:${targetKey}:${targetRows.length}`,
      );
    }

    let previousVolume =
      -1;

    for (
      const row
      of targetRows
    ) {
      if (
        row.volume! <
        previousVolume
      ) {
        throw new Error(
          `CUMULATIVE_VOLUME_DECREASE:${keyOf(row)}`,
        );
      }

      previousVolume =
        row.volume!;
    }
  }

  const supabase =
    createSupabaseServerClient();

  /*
   * Re-check immediately before writing.
   * If anything appeared since the plan was generated,
   * abort the entire apply.
   */
  const existingBefore:
    Array<{
      stockCode: string;
      targetSessionDate: string;
      count: number;
    }> =
    [];

  for (
    const target
    of targets
  ) {
    const start =
      `${target.targetSessionDate}T00:00:00+09:00`;

    const end =
      `${target.targetSessionDate}T23:59:59+09:00`;

    const result =
      await supabase
        .from(
          "market_snapshots",
        )
        .select(
          "stock_code,observed_at",
          {
            count:
              "exact",
            head:
              true,
          },
        )
        .eq(
          "stock_code",
          target.stockCode,
        )
        .gte(
          "observed_at",
          start,
        )
        .lte(
          "observed_at",
          end,
        );

    if (
      result.error
    ) {
      throw result.error;
    }

    existingBefore.push({
      stockCode:
        target.stockCode,

      targetSessionDate:
        target.targetSessionDate,

      count:
        result.count ??
        0,
    });
  }

  const conflictBefore =
    existingBefore.filter(
      (row) =>
        row.count >
        0,
    );

  if (
    conflictBefore.length >
    0
  ) {
    throw new Error(
      `PRE_APPLY_EXISTING_ROWS_DETECTED:${JSON.stringify(conflictBefore)}`,
    );
  }

  let inserted =
    0;

  for (
    let index = 0;
    index <
    rows.length;
    index +=
      CHUNK_SIZE
  ) {
    const chunk =
      rows.slice(
        index,
        index +
          CHUNK_SIZE,
      );

    const result =
      await supabase
        .from(
          "market_snapshots",
        )
        .insert(
          chunk,
        );

    if (
      result.error
    ) {
      throw new Error(
        `INTRADAY_BACKFILL_INSERT_FAILED_AT_${index}:${result.error.message}`,
      );
    }

    inserted +=
      chunk.length;
  }

  if (
    inserted !==
    EXPECTED_ROW_COUNT
  ) {
    throw new Error(
      `INSERT_COUNT_MISMATCH:${inserted}:${EXPECTED_ROW_COUNT}`,
    );
  }

  const afterRows:
    Array<{
      stock_code: string;
      observed_at: string;
      raw_payload: Record<string, unknown> | null;
    }> =
    [];

  for (
    const target
    of targets
  ) {
    const start =
      `${target.targetSessionDate}T00:00:00+09:00`;

    const end =
      `${target.targetSessionDate}T23:59:59+09:00`;

    const result =
      await supabase
        .from(
          "market_snapshots",
        )
        .select(
          "stock_code,observed_at,raw_payload",
        )
        .eq(
          "stock_code",
          target.stockCode,
        )
        .gte(
          "observed_at",
          start,
        )
        .lte(
          "observed_at",
          end,
        )
        .order(
          "observed_at",
          {
            ascending:
              true,
          },
        )
        .limit(
          1000,
        );

    if (
      result.error
    ) {
      throw result.error;
    }

    afterRows.push(
      ...(
        result.data ??
        []
      ),
    );
  }

  const afterKeys =
    new Set(
      afterRows.map(
        keyOf,
      ),
    );

  const desiredKeys =
    new Set(
      rows.map(
        keyOf,
      ),
    );

  const allDesiredPresent =
    [
      ...desiredKeys,
    ].every(
      (key) =>
        afterKeys.has(
          key,
        ),
    );

  const allRowsCanonical =
    afterRows.every(
      (row) =>
        row.raw_payload
          ?.source ===
          "KIS_HISTORICAL_INTRADAY_RECONSTRUCTED" &&
        row.raw_payload
          ?.source_version ===
          "FHKST03010230_ALPHA_V2_BACKFILL_V1",
    );

  const finalCount =
    afterRows.length;

  if (
    finalCount !==
      EXPECTED_ROW_COUNT ||
    !allDesiredPresent ||
    !allRowsCanonical
  ) {
    throw new Error(
      [
        "POST_APPLY_VERIFICATION_FAILED",
        `finalCount=${finalCount}`,
        `expected=${EXPECTED_ROW_COUNT}`,
        `allDesiredPresent=${allDesiredPresent}`,
        `allRowsCanonical=${allRowsCanonical}`,
      ].join(
        "|",
      ),
    );
  }

  const report = {
    status:
      "ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_APPLY_COMPLETE",

    applied:
      true,

    counts: {
      targetSessions:
        targets.length,

      expectedRows:
        EXPECTED_ROW_COUNT,

      insertedRows:
        inserted,

      verifiedRows:
        finalCount,

      conflictsBefore:
        conflictBefore.length,

      duplicateDesiredKeys:
        rows.length -
        uniqueKeys.size,
    },

    lineage: {
      source:
        "KIS_HISTORICAL_INTRADAY_RECONSTRUCTED",

      sourceVersion:
        "FHKST03010230_ALPHA_V2_BACKFILL_V1",

      conflictPolicy:
        "INSERT_ONLY_ABORT_IF_ANY_TARGET_SESSION_ALREADY_HAS_ROWS",
    },

    safety: {
      ordersCreated:
        0,

      positionsChanged:
        0,

      productionTradingChanged:
        false,

      historicalMarketDataRowsInserted:
        inserted,
    },

    nextGate:
      "RERUN_ALPHA_V2_TARGET_SESSION_COVERAGE_AND_ENTRY_REPLAY",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-controlled-intraday-backfill-apply.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        applied:
          report.applied,

        counts:
          report.counts,

        lineage:
          report.lineage,

        safety:
          report.safety,

        nextGate:
          report.nextGate,

        outputFile:
          "logs/alpha-v2-controlled-intraday-backfill-apply.json",
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_APPLY_FAILED",

          applied:
            false,

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
