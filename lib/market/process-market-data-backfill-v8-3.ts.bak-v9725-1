import {
  randomUUID,
} from "crypto";

import {
  getDomesticDailyStockPrices,
  getKisAccessToken,
  type KisDomesticDailyPriceOutput,
} from "@/lib/kis/client";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

interface ClaimedTask {
  id:
    string;

  run_id:
    string;

  stock_code:
    string;

  stock_name:
    string;

  market:
    string | null;

  start_date:
    string;

  end_date:
    string;

  attempt_count:
    number;
}

interface RunRow {
  id:
    string;

  adjusted_price:
    boolean;

  request_delay_ms:
    number;

  max_attempts:
    number;

  status:
    string;
}

function sleep(
  milliseconds:
    number,
) {
  if (
    milliseconds <=
      0
  ) {
    return Promise.resolve();
  }

  return new Promise<void>(
    (
      resolve,
    ) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function toNumber(
  value:
    string |
    number |
    null |
    undefined,
) {
  if (
    value ===
      null ||
    value ===
      undefined ||
    value ===
      ""
  ) {
    return null;
  }

  const parsed =
    Number(
      String(
        value,
      )
        .replaceAll(
          ",",
          "",
        ),
    );

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
}

function toCompactDate(
  sqlDate:
    string,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      sqlDate,
    )
  ) {
    throw new Error(
      `INVALID_SQL_DATE: ${sqlDate}`,
    );
  }

  return sqlDate
    .replaceAll(
      "-",
      "",
    );
}

function toSqlDate(
  compactDate:
    string,
) {
  return (
    `${compactDate.slice(0, 4)}-` +
    `${compactDate.slice(4, 6)}-` +
    `${compactDate.slice(6, 8)}`
  );
}

function convertDailyBar(
  stockCode:
    string,

  row:
    KisDomesticDailyPriceOutput,

  adjustedPrice:
    boolean,
) {
  const open =
    toNumber(
      row.stck_oprc,
    );

  const high =
    toNumber(
      row.stck_hgpr,
    );

  const low =
    toNumber(
      row.stck_lwpr,
    );

  const close =
    toNumber(
      row.stck_clpr,
    );

  const volume =
    toNumber(
      row.acml_vol,
    ) ??
    0;

  const tradingValue =
    toNumber(
      row.acml_tr_pbmn,
    );

  if (
    !row.stck_bsop_date ||
    !/^\d{8}$/.test(
      row.stck_bsop_date,
    )
  ) {
    return null;
  }

  if (
    open ===
      null ||
    high ===
      null ||
    low ===
      null ||
    close ===
      null
  ) {
    return null;
  }

  if (
    open <=
      0 ||
    high <=
      0 ||
    low <=
      0 ||
    close <=
      0
  ) {
    return null;
  }

  if (
    high <
      low ||
    open >
      high ||
    open <
      low ||
    close >
      high ||
    close <
      low
  ) {
    return null;
  }

  const now =
    new Date()
      .toISOString();

  return {
    stock_code:
      stockCode,

    trading_date:
      toSqlDate(
        row
          .stck_bsop_date,
      ),

    open_price:
      open,

    high_price:
      high,

    low_price:
      low,

    close_price:
      close,

    volume,

    trading_value:
      tradingValue,

    source:
      "KIS_DAILY_V8_3",

    adjusted_price:
      adjustedPrice,

    raw_payload:
      row,

    collected_at:
      now,

    updated_at:
      now,
  };
}

async function refreshRun(
  runId:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .rpc(
        "refresh_market_data_backfill_run_v8_3",
        {
          p_run_id:
            runId,
        },
      );

  if (
    error
  ) {
    throw new Error(
      `v8.3 run refresh failed: ${error.message}`,
    );
  }

  return (
    data?.[0] ??
    null
  ) as Record<
    string,
    unknown
  > | null;
}

export async function processMarketDataBackfillV83(
  input: {
    runId:
      string;

    maxTasks?:
      number;

    workerId?:
      string;

    leaseSeconds?:
      number;

    requestDelayMs?:
      number;
  },
) {
  const supabase =
    createSupabaseServerClient();

  const runId =
    input
      .runId
      .trim();

  if (
    !runId
  ) {
    throw new Error(
      "V8_3_RUN_ID_REQUIRED",
    );
  }

  const {
    data: runData,
    error: runError,
  } =
    await supabase
      .from(
        "market_data_backfill_runs",
      )
      .select(`
        id,
        adjusted_price,
        request_delay_ms,
        max_attempts,
        status
      `)
      .eq(
        "id",
        runId,
      )
      .maybeSingle();

  if (
    runError
  ) {
    throw new Error(
      `v8.3 run load failed: ${runError.message}`,
    );
  }

  if (
    !runData
  ) {
    throw new Error(
      `V8_3_RUN_NOT_FOUND: ${runId}`,
    );
  }

  const run =
    runData as RunRow;

  if (
    run.status !==
      "RUNNING"
  ) {
    return {
      version:
        "SCALABLE_MARKET_DATA_BACKFILL_WORKER_V8_3",

      runId,

      processedTasks:
        0,

      reason:
        `RUN_NOT_ACTIVE_${run.status}`,

      progress:
        await refreshRun(
          runId,
        ),

      productionApplied:
        false,
    };
  }

  const maxTasks =
    Math.min(
      100,
      Math.max(
        1,
        Math.floor(
          input
            .maxTasks ??
          10,
        ),
      ),
    );

  const workerId =
    input
      .workerId
      ?.trim() ||
    `V8_3_${process.pid}_${randomUUID()}`;

  const leaseSeconds =
    Math.min(
      1800,
      Math.max(
        30,
        Math.floor(
          input
            .leaseSeconds ??
          180,
        ),
      ),
    );

  const requestDelayMs =
    Math.min(
      10000,
      Math.max(
        0,
        Math.floor(
          input
            .requestDelayMs ??
          run.request_delay_ms ??
          1500,
        ),
      ),
    );

  const accessToken =
    await getKisAccessToken();

  const taskResults:
    Array<
      Record<
        string,
        unknown
      >
    > = [];

  for (
    let index =
      0;
    index <
      maxTasks;
    index +=
      1
  ) {
    const {
      data: claimData,
      error: claimError,
    } =
      await supabase
        .rpc(
          "claim_market_data_backfill_task_v8_3",
          {
            p_run_id:
              runId,

            p_worker_id:
              workerId,

            p_lease_seconds:
              leaseSeconds,
          },
        );

    if (
      claimError
    ) {
      throw new Error(
        `v8.3 task claim failed: ${claimError.message}`,
      );
    }

    const task =
      (
        claimData?.[0] ??
        null
      ) as ClaimedTask | null;

    if (
      !task
    ) {
      break;
    }

    let receivedRows =
      0;

    let savedRows =
      0;

    try {
      const startCompact =
        toCompactDate(
          task.start_date,
        );

      const endCompact =
        toCompactDate(
          task.end_date,
        );

      const response =
        await getDomesticDailyStockPrices(
          {
            stockCode:
              task.stock_code,

            startDate:
              startCompact,

            endDate:
              endCompact,

            period:
              "D",

            adjustedPrice:
              run.adjusted_price,
          },
          accessToken,
        );

      const rawRows =
        response.output2 ??
        [];

      receivedRows =
        rawRows.length;

      const converted =
        rawRows
          .map(
            (
              row,
            ) =>
              convertDailyBar(
                task.stock_code,
                row,
                run.adjusted_price,
              ),
          )
          .filter(
            (
              row,
            ): row is NonNullable<
              ReturnType<
                typeof convertDailyBar
              >
            > =>
              row !==
              null,
          )
          .filter(
            (
              row,
            ) => {
              const compact =
                row
                  .trading_date
                  .replaceAll(
                    "-",
                    "",
                  );

              return (
                compact >=
                  startCompact &&
                compact <=
                  endCompact
              );
            },
          );

      if (
        converted.length >
        0
      ) {
        const {
          error: saveError,
        } =
          await supabase
            .from(
              "market_daily_bars",
            )
            .upsert(
              converted,
              {
                onConflict:
                  "stock_code,trading_date",
              },
            );

        if (
          saveError
        ) {
          throw new Error(
            saveError.message,
          );
        }

        savedRows =
          converted.length;
      }

      const {
        error: taskUpdateError,
      } =
        await supabase
          .from(
            "market_data_backfill_tasks",
          )
          .update({
            status:
              "SUCCESS",

            received_rows:
              receivedRows,

            saved_rows:
              savedRows,

            worker_id:
              workerId,

            lease_expires_at:
              null,

            finished_at:
              new Date()
                .toISOString(),

            updated_at:
              new Date()
                .toISOString(),

            last_error:
              null,

            metadata: {
              version:
                "SCALABLE_MARKET_DATA_BACKFILL_WORKER_V8_3",

              output2Rows:
                receivedRows,

              convertedRows:
                converted.length,

              emptyResponse:
                receivedRows ===
                0,

              adjustedPrice:
                run.adjusted_price,
            },
          })
          .eq(
            "id",
            task.id);

      if (
        taskUpdateError
      ) {
        throw new Error(
          `task success update failed: ${taskUpdateError.message}`,
        );
      }

      taskResults.push({
        taskId:
          task.id,

        stockCode:
          task.stock_code,

        stockName:
          task.stock_name,

        attempt:
          task.attempt_count,

        ok:
          true,

        receivedRows,
        savedRows,
      });
    } catch (
      error
    ) {
      const message =
        error instanceof Error
          ? error.message
          : "UNKNOWN_V8_3_TASK_ERROR";

      const {
        error: failureUpdateError,
      } =
        await supabase
          .from(
            "market_data_backfill_tasks",
          )
          .update({
            status:
              "FAILED",

            received_rows:
              receivedRows,

            saved_rows:
              savedRows,

            worker_id:
              workerId,

            lease_expires_at:
              null,

            finished_at:
              new Date()
                .toISOString(),

            updated_at:
              new Date()
                .toISOString(),

            last_error:
              message,
          })
          .eq(
            "id",
            task.id,
          );

      if (
        failureUpdateError
      ) {
        throw new Error(
          `v8.3 task failure persistence failed: ${failureUpdateError.message}; original=${message}`,
        );
      }

      taskResults.push({
        taskId:
          task.id,

        stockCode:
          task.stock_code,

        stockName:
          task.stock_name,

        attempt:
          task.attempt_count,

        ok:
          false,

        error:
          message,
      });
    }

    if (
      index <
      maxTasks -
        1
    ) {
      await sleep(
        requestDelayMs,
      );
    }
  }

  const progress =
    await refreshRun(
      runId,
    );

  return {
    version:
      "SCALABLE_MARKET_DATA_BACKFILL_WORKER_V8_3",

    runId,

    workerId,

    requestDelayMs,

    processedTasks:
      taskResults.length,

    successes:
      taskResults.filter(
        (
          result,
        ) =>
          result.ok ===
          true,
      ).length,

    failures:
      taskResults.filter(
        (
          result,
        ) =>
          result.ok !==
          true,
      ).length,

    taskResults,

    progress,

    safety: {
      productionApplied:
        false,

      ordersChanged:
        false,

      riskChanged:
        false,

      universeMembershipChanged:
        false,

      marketDailyBarsOnly:
        true,

      resumable:
        true,
    },
  };
}
