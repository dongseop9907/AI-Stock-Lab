import fs from "node:fs";
import path from "node:path";

import {
  getKisAccessToken,
} from "../lib/kis/client";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const REQUEST_DELAY_MS = 700;
const MARKET_OPEN = "090000";
const MARKET_CLOSE = "153000";
const MAX_PAGES_PER_SESSION = 6;

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms),
  );
}

function digitsDate(sqlDate: string) {
  return sqlDate.replace(/-/g, "");
}

function sqlDate(digits: string) {
  return (
    `${digits.slice(0, 4)}-` +
    `${digits.slice(4, 6)}-` +
    `${digits.slice(6, 8)}`
  );
}

function previousMinute(hhmmss: string) {
  const hh = Number(hhmmss.slice(0, 2));
  const mm = Number(hhmmss.slice(2, 4));

  let total = hh * 60 + mm - 1;

  if (total < 0) {
    total = 0;
  }

  const nextH = Math.floor(total / 60);
  const nextM = total % 60;

  return (
    `${String(nextH).padStart(2, "0")}` +
    `${String(nextM).padStart(2, "0")}` +
    "00"
  );
}

function toNumber(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(
    String(value).replaceAll(",", ""),
  );

  return Number.isFinite(n)
    ? n
    : null;
}

function toObservedAt(
  businessDate: string,
  time: string,
) {
  const date = sqlDate(businessDate);

  const local =
    `${date}T` +
    `${time.slice(0, 2)}:` +
    `${time.slice(2, 4)}:` +
    `${time.slice(4, 6)}+09:00`;

  return new Date(local).toISOString();
}

async function fetchPage(
  stockCode: string,
  targetDate: string,
  inputHour: string,
  accessToken: string,
) {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  const baseUrl =
    process.env.KIS_BASE_URL ??
    "https://openapi.koreainvestment.com:9443";

  if (!appKey || !appSecret) {
    throw new Error(
      "KIS_APP_KEY_OR_SECRET_MISSING",
    );
  }

  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: stockCode,
    FID_INPUT_HOUR_1: inputHour,
    FID_INPUT_DATE_1: targetDate,
    FID_PW_DATA_INCU_YN: "Y",
    FID_FAKE_TICK_INCU_YN: "",
  });

  const response = await fetch(
    `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice?${params}`,
    {
      method: "GET",
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        authorization:
          `Bearer ${accessToken}`,
        appkey: appKey,
        appsecret: appSecret,
        tr_id: "FHKST03010230",
        custtype: "P",
      },
      cache: "no-store",
    },
  );

  const body =
    await response.json() as
      Record<string, any>;

  if (!response.ok) {
    throw new Error(
      `KIS_INTRADAY_HTTP_${response.status}:${body.msg_cd ?? "UNKNOWN"}:${body.msg1 ?? "UNKNOWN"}`,
    );
  }

  if (
    body.rt_cd !== undefined &&
    body.rt_cd !== "0"
  ) {
    throw new Error(
      `KIS_INTRADAY_API_ERROR:${body.rt_cd}:${body.msg_cd ?? "UNKNOWN"}:${body.msg1 ?? "UNKNOWN"}`,
    );
  }

  return Array.isArray(body.output2)
    ? body.output2
    : [];
}

async function fetchFullSession(
  stockCode: string,
  sqlTargetDate: string,
  accessToken: string,
) {
  const targetDate =
    digitsDate(sqlTargetDate);

  const unique = new Map<
    string,
    Record<string, any>
  >();

  let anchor = MARKET_CLOSE;
  let pageCount = 0;
  let requestCount = 0;
  let noProgress = false;

  while (
    pageCount <
    MAX_PAGES_PER_SESSION
  ) {
    pageCount += 1;
    requestCount += 1;

    const page =
      await fetchPage(
        stockCode,
        targetDate,
        anchor,
        accessToken,
      );

    const filtered =
      page.filter(
        (row: any) =>
          String(
            row.stck_bsop_date ??
            "",
          ) === targetDate &&
          /^\d{6}$/.test(
            String(
              row.stck_cntg_hour ??
              "",
            ),
          ),
      );

    for (const row of filtered) {
      const time =
        String(
          row.stck_cntg_hour,
        );

      if (
        time < MARKET_OPEN ||
        time > MARKET_CLOSE
      ) {
        continue;
      }

      unique.set(
        `${targetDate}|${time}`,
        row,
      );
    }

    const times =
      filtered
        .map(
          (row: any) =>
            String(
              row.stck_cntg_hour,
            ),
        )
        .filter(
          (time: string) =>
            /^\d{6}$/.test(time),
        )
        .sort();

    if (!times.length) {
      break;
    }

    const earliest =
      times[0];

    if (
      earliest <= MARKET_OPEN
    ) {
      break;
    }

    const nextAnchor =
      previousMinute(
        earliest,
      );

    if (
      nextAnchor >= anchor
    ) {
      noProgress = true;
      break;
    }

    anchor =
      nextAnchor;

    await sleep(
      REQUEST_DELAY_MS,
    );
  }

  const rows =
    [...unique.values()]
      .sort(
        (a, b) =>
          String(
            a.stck_cntg_hour,
          ).localeCompare(
            String(
              b.stck_cntg_hour,
            ),
          ),
      );

  const transformed: Array<
    Record<string, any>
  > = [];

  let sessionOpen: number | null =
    null;

  let runningHigh: number | null =
    null;

  let runningLow: number | null =
    null;

  let cumulativeVolume = 0;

  for (const row of rows) {
    const time =
      String(
        row.stck_cntg_hour,
      );

    const close =
      toNumber(
        row.stck_prpr,
      );

    const minuteOpen =
      toNumber(
        row.stck_oprc,
      );

    const minuteHigh =
      toNumber(
        row.stck_hgpr,
      );

    const minuteLow =
      toNumber(
        row.stck_lwpr,
      );

    const intervalVolume =
      toNumber(
        row.cntg_vol,
      );

    if (
      close === null ||
      minuteOpen === null ||
      minuteHigh === null ||
      minuteLow === null ||
      intervalVolume === null ||
      intervalVolume < 0
    ) {
      continue;
    }

    if (
      sessionOpen === null
    ) {
      sessionOpen =
        minuteOpen;
    }

    runningHigh =
      runningHigh === null
        ? minuteHigh
        : Math.max(
            runningHigh,
            minuteHigh,
          );

    runningLow =
      runningLow === null
        ? minuteLow
        : Math.min(
            runningLow,
            minuteLow,
          );

    cumulativeVolume +=
      intervalVolume;

    transformed.push({
      stock_code:
        stockCode,

      observed_at:
        toObservedAt(
          targetDate,
          time,
        ),

      open_price:
        sessionOpen,

      high_price:
        runningHigh,

      low_price:
        runningLow,

      close_price:
        close,

      volume:
        cumulativeVolume,

      raw_payload: {
        source:
          "KIS_HISTORICAL_INTRADAY_RECONSTRUCTED",

        source_version:
          "FHKST03010230_ALPHA_V2_BACKFILL_V1",

        market_date:
          sqlTargetDate,

        minute_time:
          time,

        interval_volume:
          intervalVolume,

        reconstructed_cumulative_volume:
          cumulativeVolume,

        minute_bar:
          row,
      },
    });
  }

  const sourceTimes =
    rows.map(
      (row: any) =>
        String(
          row.stck_cntg_hour,
        ),
    );

  const earliestTime =
    sourceTimes[0] ??
    null;

  const latestTime =
    sourceTimes.at(-1) ??
    null;

  const regularCoverageReady =
    rows.length >= 300 &&
    earliestTime !== null &&
    earliestTime <= "090100" &&
    latestTime !== null &&
    latestTime >= "153000" &&
    transformed.length >= 300 &&
    !noProgress;

  return {
    stockCode,
    targetSessionDate:
      sqlTargetDate,
    requestCount,
    pageCount,
    sourceRowCount:
      rows.length,
    transformedRowCount:
      transformed.length,
    earliestTime,
    latestTime,
    noProgress,
    regularCoverageReady,
    totalIntervalVolume:
      transformed.at(-1)
        ?.volume ??
        0,
    rows:
      transformed,
  };
}

async function main() {
  const root = process.cwd();

  const coverage =
    JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          "logs",
          "alpha-v2-entry-target-session-coverage.json",
        ),
        "utf8",
      ),
    );

  /*
   * Only sessions that were missing from the original
   * target-session coverage are considered.
   *
   * Multiple Alpha signals may map to the same
   * targetSessionDate + stockCode, so deduplicate.
   */
  const uniqueTargets =
    new Map<
      string,
      {
        stockCode: string;
        targetSessionDate: string;
      }
    >();

  for (
    const row
    of coverage.missingRows ??
      []
  ) {
    if (
      !row.stockCode ||
      !row.targetSessionDate
    ) {
      continue;
    }

    const target = {
      stockCode:
        String(
          row.stockCode,
        ),

      targetSessionDate:
        String(
          row.targetSessionDate,
        ),
    };

    uniqueTargets.set(
      `${target.targetSessionDate}|${target.stockCode}`,
      target,
    );
  }

  const targets =
    [...uniqueTargets.values()]
      .sort(
        (a, b) =>
          `${a.targetSessionDate}|${a.stockCode}`
            .localeCompare(
              `${b.targetSessionDate}|${b.stockCode}`,
            ),
      );

  if (!targets.length) {
    throw new Error(
      "NO_MISSING_TARGET_SESSIONS_TO_PLAN",
    );
  }

  const accessToken =
    await getKisAccessToken();

  const sessionResults:
    Array<Record<string, any>> =
    [];

  const desiredRows:
    Array<Record<string, any>> =
    [];

  let totalKisRequests = 0;

  for (
    let index = 0;
    index <
    targets.length;
    index += 1
  ) {
    const target =
      targets[index];

    try {
      const session =
        await fetchFullSession(
          target.stockCode,
          target.targetSessionDate,
          accessToken,
        );

      totalKisRequests +=
        session.requestCount;

      sessionResults.push({
        stockCode:
          session.stockCode,

        targetSessionDate:
          session.targetSessionDate,

        requestCount:
          session.requestCount,

        sourceRowCount:
          session.sourceRowCount,

        transformedRowCount:
          session.transformedRowCount,

        earliestTime:
          session.earliestTime,

        latestTime:
          session.latestTime,

        totalIntervalVolume:
          session.totalIntervalVolume,

        regularCoverageReady:
          session.regularCoverageReady,

        error:
          null,
      });

      desiredRows.push(
        ...session.rows,
      );
    } catch (error) {
      sessionResults.push({
        stockCode:
          target.stockCode,

        targetSessionDate:
          target.targetSessionDate,

        requestCount:
          null,

        sourceRowCount:
          0,

        transformedRowCount:
          0,

        earliestTime:
          null,

        latestTime:
          null,

        totalIntervalVolume:
          0,

        regularCoverageReady:
          false,

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
      targets.length - 1
    ) {
      await sleep(
        REQUEST_DELAY_MS,
      );
    }
  }

  const supabase =
    createSupabaseServerClient();

  const existingChecks =
    [];

  for (const target of targets) {
    const start =
      `${target.targetSessionDate}T00:00:00+09:00`;

    const end =
      `${target.targetSessionDate}T23:59:59+09:00`;

    const query =
      await supabase
        .from(
          "market_snapshots",
        )
        .select(
          "stock_code,observed_at",
          {
            count: "exact",
            head: true,
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

    if (query.error) {
      throw query.error;
    }

    existingChecks.push({
      ...target,
      existingRowCount:
        query.count ??
        0,
    });
  }

  const allSessionsReady =
    sessionResults.length >
      0 &&
    sessionResults.every(
      (row: any) =>
        row.regularCoverageReady ===
          true &&
        !row.error,
    );

  const noExistingRows =
    existingChecks.every(
      (row) =>
        row.existingRowCount ===
          0,
    );

  const duplicateKeys =
    desiredRows.length -
    new Set(
      desiredRows.map(
        (row) =>
          `${row.stock_code}|${row.observed_at}`,
      ),
    ).size;

  const safeToPrepareApply =
    allSessionsReady &&
    noExistingRows &&
    duplicateKeys === 0;

  const report = {
    status:
      "ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_PLAN_COMPLETE",

    writeEnabled:
      false,

    targetCount:
      targets.length,

    targets,

    source: {
      endpoint:
        "/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice",

      trId:
        "FHKST03010230",

      dateParameter:
        "FID_INPUT_DATE_1",

      hourParameter:
        "FID_INPUT_HOUR_1",

      pagination:
        "walk backward by earliest returned minute until market open",

      sourceVolume:
        "cntg_vol interval volume",
    },

    reconstruction: {
      open_price:
        "first minute open of session",

      high_price:
        "running max of minute highs",

      low_price:
        "running min of minute lows",

      close_price:
        "current minute close",

      volume:
        "running cumulative sum of cntg_vol",

      purpose:
        "match existing live market_snapshots field semantics",
    },

    counts: {
      totalKisRequests,

      desiredSnapshotRows:
        desiredRows.length,

      readySessions:
        sessionResults.filter(
          (row: any) =>
            row.regularCoverageReady,
        ).length,

      failedOrIncompleteSessions:
        sessionResults.filter(
          (row: any) =>
            !row.regularCoverageReady,
        ).length,

      duplicateDesiredKeys:
        duplicateKeys,

      sessionsWithExistingRows:
        existingChecks.filter(
          (row) =>
            row.existingRowCount >
              0,
        ).length,
    },

    sessions:
      sessionResults,

    existingChecks,

    safeToPrepareApply,

    safety: {
      databaseReadsOnly:
        true,

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
      safeToPrepareApply
        ? "BUILD_CONTROLLED_INTRADAY_BACKFILL_APPLY"
        : "REVIEW_INTRADAY_BACKFILL_PLAN_GAPS_BEFORE_WRITE",
  };

  fs.mkdirSync(
    path.join(
      root,
      "logs",
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-controlled-intraday-backfill-plan.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  /*
   * Desired rows are kept in a separate local artifact.
   * Still no database write.
   */
  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-controlled-intraday-backfill-desired-rows.json",
    ),
    JSON.stringify(
      {
        generatedAt:
          new Date()
            .toISOString(),

        rows:
          desiredRows,
      },
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

        writeEnabled:
          report.writeEnabled,

        targetCount:
          report.targetCount,

        counts:
          report.counts,

        sessions:
          report.sessions,

        existingChecks:
          report.existingChecks,

        safeToPrepareApply:
          report.safeToPrepareApply,

        nextGate:
          report.nextGate,

        outputFiles: [
          "logs/alpha-v2-controlled-intraday-backfill-plan.json",
          "logs/alpha-v2-controlled-intraday-backfill-desired-rows.json",
        ],
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
            "ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_PLAN_FAILED",

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

    process.exitCode =
      2;
  },
);
