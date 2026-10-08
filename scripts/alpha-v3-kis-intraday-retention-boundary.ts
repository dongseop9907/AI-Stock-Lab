import fs from "node:fs";
import path from "node:path";

import {
  getKisAccessToken,
} from "../lib/kis/client";

const REQUEST_DELAY_MS = 700;

function sleep(ms: number) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms),
  );
}

function digitsDate(sqlDate: string) {
  return sqlDate.replace(/-/g, "");
}

async function probeDate(
  stockCode: string,
  targetDate: string,
  accessToken: string,
) {
  const appKey =
    process.env.KIS_APP_KEY;

  const appSecret =
    process.env.KIS_APP_SECRET;

  const baseUrl =
    process.env.KIS_BASE_URL ??
    "https://openapi.koreainvestment.com:9443";

  if (!appKey || !appSecret) {
    throw new Error(
      "KIS_APP_KEY_OR_SECRET_MISSING",
    );
  }

  const params =
    new URLSearchParams({
      FID_COND_MRKT_DIV_CODE:
        "J",

      FID_INPUT_ISCD:
        stockCode,

      FID_INPUT_HOUR_1:
        "153000",

      FID_INPUT_DATE_1:
        digitsDate(
          targetDate,
        ),

      FID_PW_DATA_INCU_YN:
        "Y",

      FID_FAKE_TICK_INCU_YN:
        "",
    });

  const response =
    await fetch(
      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice?${params}`,
      {
        method:
          "GET",

        headers: {
          "Content-Type":
            "application/json; charset=utf-8",

          authorization:
            `Bearer ${accessToken}`,

          appkey:
            appKey,

          appsecret:
            appSecret,

          tr_id:
            "FHKST03010230",

          custtype:
            "P",
        },

        cache:
          "no-store",
      },
    );

  const body =
    await response.json() as
      Record<string, any>;

  const rows =
    Array.isArray(
      body.output2,
    )
      ? body.output2
      : [];

  const requestedDate =
    digitsDate(
      targetDate,
    );

  const requestedRows =
    rows.filter(
      (row: any) =>
        String(
          row.stck_bsop_date ??
          "",
        ) ===
        requestedDate,
    );

  const times =
    requestedRows
      .map(
        (row: any) =>
          String(
            row.stck_cntg_hour ??
            "",
          ),
      )
      .filter(
        (value: string) =>
          /^\d{6}$/.test(
            value,
          ),
      )
      .sort();

  return {
    httpStatus:
      response.status,

    rtCd:
      body.rt_cd ??
      null,

    msgCd:
      body.msg_cd ??
      null,

    msg:
      body.msg1 ??
      null,

    requestedDatePresent:
      requestedRows.length > 0,

    requestedDateRows:
      requestedRows.length,

    earliestTime:
      times[0] ??
      null,

    latestTime:
      times.at(-1) ??
      null,
  };
}

function diffCalendarDays(
  fromDate: string,
  toDate: string,
) {
  const from =
    new Date(
      `${fromDate}T00:00:00Z`,
    ).getTime();

  const to =
    new Date(
      `${toDate}T00:00:00Z`,
    ).getTime();

  return Math.round(
    (to - from) /
    (24 * 60 * 60 * 1000),
  );
}

async function main() {
  const root =
    process.cwd();

  const inputPath =
    path.join(
      root,
      "logs",
      "alpha-v3-extended-pricevolume-top1-history.json",
    );

  if (!fs.existsSync(inputPath)) {
    throw new Error(
      "EXTENDED_TOP1_HISTORY_LOG_NOT_FOUND",
    );
  }

  const report =
    JSON.parse(
      fs.readFileSync(
        inputPath,
        "utf8",
      ),
    );

  const rows =
    (report.top1Rows ?? [])
      .filter(
        (row: any) =>
          row?.targetSessionDate &&
          row?.top1?.stockCode,
      )
      .sort(
        (a: any, b: any) =>
          String(
            a.targetSessionDate,
          ).localeCompare(
            String(
              b.targetSessionDate,
            ),
          ),
      );

  if (!rows.length) {
    throw new Error(
      "NO_EXTENDED_TOP1_ROWS",
    );
  }

  const accessToken =
    await getKisAccessToken();

  const cache =
    new Map<
      number,
      any
    >();

  let requestCount = 0;

  const probeIndex =
    async (
      index: number,
    ) => {
      if (
        cache.has(
          index,
        )
      ) {
        return cache.get(
          index,
        );
      }

      const row =
        rows[index];

      const probe =
        await probeDate(
          String(
            row.top1.stockCode,
          ),
          String(
            row.targetSessionDate,
          ),
          accessToken,
        );

      requestCount += 1;

      const result = {
        index,

        sourceTradingDate:
          row.sourceTradingDate,

        targetSessionDate:
          row.targetSessionDate,

        stockCode:
          row.top1.stockCode,

        stockName:
          row.top1.stockName,

        available:
          probe.requestedDatePresent,

        probe,
      };

      cache.set(
        index,
        result,
      );

      await sleep(
        REQUEST_DELAY_MS,
      );

      return result;
    };

  /*
   * Confirm endpoints first.
   */
  const oldest =
    await probeIndex(0);

  const newest =
    await probeIndex(
      rows.length - 1,
    );

  if (!newest.available) {
    throw new Error(
      "NEWEST_TARGET_SESSION_NOT_AVAILABLE_UNEXPECTED",
    );
  }

  let earliestAvailableIndex:
    number;

  let latestUnavailableIndex:
    number | null;

  if (oldest.available) {
    earliestAvailableIndex = 0;
    latestUnavailableIndex = null;
  } else {
    let low = 0;
    let high =
      rows.length - 1;

    /*
     * Invariant:
     * low is unavailable,
     * high is available.
     */
    while (
      high - low > 1
    ) {
      const mid =
        Math.floor(
          (low + high) /
          2,
        );

      const probe =
        await probeIndex(
          mid,
        );

      if (
        probe.available
      ) {
        high = mid;
      } else {
        low = mid;
      }
    }

    latestUnavailableIndex =
      low;

    earliestAvailableIndex =
      high;
  }

  /*
   * Validate neighbors around boundary.
   */
  const neighborIndexes =
    new Set<number>();

  for (
    let delta = -3;
    delta <= 3;
    delta += 1
  ) {
    const index =
      earliestAvailableIndex +
      delta;

    if (
      index >= 0 &&
      index < rows.length
    ) {
      neighborIndexes.add(
        index,
      );
    }
  }

  for (
    const index
    of [
      ...neighborIndexes,
    ].sort(
      (a, b) =>
        a - b,
    )
  ) {
    await probeIndex(
      index,
    );
  }

  const probes =
    [
      ...cache.values(),
    ].sort(
      (a, b) =>
        a.index -
        b.index,
    );

  const boundaryWindow =
    probes.filter(
      (row) =>
        Math.abs(
          row.index -
          earliestAvailableIndex,
        ) <= 3,
    );

  const monotonicBoundaryValid =
    boundaryWindow.every(
      (row) =>
        row.index <
        earliestAvailableIndex
          ? row.available ===
            false
          : row.available ===
            true,
    );

  const earliestAvailable =
    cache.get(
      earliestAvailableIndex,
    ) ??
    await probeIndex(
      earliestAvailableIndex,
    );

  const latestUnavailable =
    latestUnavailableIndex !==
      null
      ? (
          cache.get(
            latestUnavailableIndex,
          ) ??
          await probeIndex(
            latestUnavailableIndex,
          )
        )
      : null;

  const newestDate =
    String(
      rows.at(-1)
        .targetSessionDate,
    );

  const retentionCalendarDays =
    diffCalendarDays(
      String(
        earliestAvailable.targetSessionDate,
      ),
      newestDate,
    );

  const usableRows =
    rows.slice(
      earliestAvailableIndex,
    );

  const result = {
    status:
      "ALPHA_V3_KIS_INTRADAY_RETENTION_BOUNDARY_COMPLETE",

    counts: {
      extendedTop1Dates:
        rows.length,

      probeRequests:
        requestCount,

      earliestAvailableIndex,

      usableTop1DatesFromBoundary:
        usableRows.length,
    },

    boundary: {
      latestUnavailable:
        latestUnavailable
          ? {
              index:
                latestUnavailable.index,

              targetSessionDate:
                latestUnavailable.targetSessionDate,

              stockCode:
                latestUnavailable.stockCode,

              stockName:
                latestUnavailable.stockName,
            }
          : null,

      earliestAvailable: {
        index:
          earliestAvailable.index,

        targetSessionDate:
          earliestAvailable.targetSessionDate,

        stockCode:
          earliestAvailable.stockCode,

        stockName:
          earliestAvailable.stockName,
      },

      newestAvailableTargetSessionDate:
        newestDate,

      approximateRetentionCalendarDays:
        retentionCalendarDays,

      monotonicBoundaryValid,
    },

    boundaryWindow,

    usableRange: {
      start:
        earliestAvailable.targetSessionDate,

      end:
        newestDate,

      top1SessionCount:
        usableRows.length,
    },

    safety: {
      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionChanged:
        false,
    },

    nextGate:
      monotonicBoundaryValid
        ? "BUILD_EXTENDED_ENTRY_V3_KIS_MINUTE_REPLAY_BATCHER"
        : "REVIEW_NON_MONOTONIC_KIS_INTRADAY_AVAILABILITY",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v3-kis-intraday-retention-boundary.json",
    ),
    JSON.stringify(
      result,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      result,
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
            "ALPHA_V3_KIS_INTRADAY_RETENTION_BOUNDARY_FAILED",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          databaseWrites:
            0,

          ordersCreated:
            0,
        },
        null,
        2,
      ),
    );

    process.exitCode = 2;
  },
);
