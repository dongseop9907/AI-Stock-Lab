import fs from "node:fs";
import path from "node:path";

import {
  getKisAccessToken,
} from "../lib/kis/client";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  getActiveEntryThreshold,
} from "../lib/trading/get-active-entry-threshold";

const REQUEST_DELAY_MS = 1200;
const SESSION_BATCH_SIZE = 20;
const MARKET_OPEN = "090000";
const MARKET_CLOSE = "153000";
const MAX_PAGES_PER_SESSION = 6;
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms),
  );
}

function avg(values: number[]): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
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

function normalizeThreshold(value: unknown): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    const row =
      value as Record<string, unknown>;

    for (const key of [
      "threshold",
      "scoreThreshold",
      "entryScoreThreshold",
      "value",
    ]) {
      const n =
        Number(
          row[key],
        );

      if (Number.isFinite(n)) {
        return n;
      }
    }
  }

  throw new Error(
    `UNSUPPORTED_ENTRY_THRESHOLD_SHAPE:${JSON.stringify(value)}`,
  );
}

function previousMinute(hhmmss: string) {
  const hh =
    Number(
      hhmmss.slice(0, 2),
    );

  const mm =
    Number(
      hhmmss.slice(2, 4),
    );

  let total =
    hh * 60 +
    mm -
    1;

  if (total < 0) {
    total = 0;
  }

  return (
    `${String(
      Math.floor(total / 60),
    ).padStart(2, "0")}` +
    `${String(
      total % 60,
    ).padStart(2, "0")}` +
    "00"
  );
}

function digitsDate(sqlDate: string) {
  return sqlDate.replace(
    /-/g,
    "",
  );
}

function toObservedAt(
  businessDate: string,
  time: string,
) {
  const sqlDate =
    `${businessDate.slice(0, 4)}-` +
    `${businessDate.slice(4, 6)}-` +
    `${businessDate.slice(6, 8)}`;

  return new Date(
    `${sqlDate}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00`,
  ).toISOString();
}

async function fetchJsonWithRetry(
  url: string,
  headers: Record<string, string>,
) {
  let lastError:
    unknown =
    null;

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt += 1
  ) {
    try {
      const response =
        await fetch(
          url,
          {
            method: "GET",
            headers,
            cache: "no-store",
          },
        );

      const body =
        await response.json() as
          Record<string, any>;

      if (
        response.ok &&
        (
          body.rt_cd ===
            undefined ||
          body.rt_cd ===
            "0"
        )
      ) {
        return {
          response,
          body,
        };
      }

      const message =
        `HTTP_${response.status}:${body.msg_cd ?? "UNKNOWN"}:${body.msg1 ?? "UNKNOWN"}`;

      lastError =
        new Error(
          message,
        );
    } catch (error) {
      lastError =
        error;
    }

    if (
      attempt <
      MAX_RETRIES
    ) {
      await sleep(
        REQUEST_DELAY_MS *
        attempt,
      );
    }
  }

  throw lastError ??
    new Error(
      "KIS_REQUEST_FAILED",
    );
}

async function fetchPage(
  stockCode: string,
  targetDate: string,
  inputHour: string,
  accessToken: string,
) {
  const appKey =
    process.env.KIS_APP_KEY;

  const appSecret =
    process.env.KIS_APP_SECRET;

  const baseUrl =
    process.env.KIS_BASE_URL ??
    "https://openapi.koreainvestment.com:9443";

  if (
    !appKey ||
    !appSecret
  ) {
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
        inputHour,

      FID_INPUT_DATE_1:
        targetDate,

      FID_PW_DATA_INCU_YN:
        "Y",

      FID_FAKE_TICK_INCU_YN:
        "",
    });

  const {
    body,
  } =
    await fetchJsonWithRetry(
      `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice?${params}`,
      {
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
    );

  return Array.isArray(
    body.output2,
  )
    ? body.output2
    : [];
}

async function fetchFullMinuteSession(
  stockCode: string,
  sqlDate: string,
  accessToken: string,
) {
  const targetDate =
    digitsDate(
      sqlDate,
    );

  const unique =
    new Map<string, any>();

  let anchor =
    MARKET_CLOSE;

  let requestCount =
    0;

  for (
    let page = 0;
    page <
    MAX_PAGES_PER_SESSION;
    page += 1
  ) {
    requestCount +=
      1;

    const output =
      await fetchPage(
        stockCode,
        targetDate,
        anchor,
        accessToken,
      );

    const rows =
      output.filter(
        (row: any) =>
          String(
            row.stck_bsop_date ??
            "",
          ) ===
            targetDate &&
          /^\d{6}$/.test(
            String(
              row.stck_cntg_hour ??
              "",
            ),
          ),
      );

    for (const row of rows) {
      const time =
        String(
          row.stck_cntg_hour,
        );

      if (
        time >=
          MARKET_OPEN &&
        time <=
          MARKET_CLOSE
      ) {
        unique.set(
          `${targetDate}|${time}`,
          row,
        );
      }
    }

    const times =
      rows
        .map(
          (row: any) =>
            String(
              row.stck_cntg_hour,
            ),
        )
        .filter(
          (time: string) =>
            /^\d{6}$/.test(
              time,
            ),
        )
        .sort();

    if (
      !times.length
    ) {
      break;
    }

    const earliest =
      times[0];

    if (
      earliest <=
      MARKET_OPEN
    ) {
      break;
    }

    const nextAnchor =
      previousMinute(
        earliest,
      );

    if (
      nextAnchor >=
      anchor
    ) {
      break;
    }

    anchor =
      nextAnchor;

    await sleep(
      REQUEST_DELAY_MS,
    );
  }

  const minuteBars =
    [
      ...unique.values(),
    ].sort(
      (a, b) =>
        String(
          a.stck_cntg_hour,
        ).localeCompare(
          String(
            b.stck_cntg_hour,
          ),
        ),
    );

  let sessionOpen:
    number |
    null =
    null;

  let runningHigh:
    number |
    null =
    null;

  let runningLow:
    number |
    null =
    null;

  let cumulativeVolume =
    0;

  const snapshots:
    any[] =
    [];

  for (const row of minuteBars) {
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

    const close =
      toNumber(
        row.stck_prpr,
      );

    const intervalVolume =
      toNumber(
        row.cntg_vol,
      );

    if (
      minuteOpen ===
        null ||
      minuteHigh ===
        null ||
      minuteLow ===
        null ||
      close ===
        null ||
      intervalVolume ===
        null ||
      intervalVolume <
        0
    ) {
      continue;
    }

    if (
      sessionOpen ===
      null
    ) {
      sessionOpen =
        minuteOpen;
    }

    runningHigh =
      runningHigh ===
      null
        ? minuteHigh
        : Math.max(
            runningHigh,
            minuteHigh,
          );

    runningLow =
      runningLow ===
      null
        ? minuteLow
        : Math.min(
            runningLow,
            minuteLow,
          );

    cumulativeVolume +=
      intervalVolume;

    snapshots.push({
      stock_code:
        stockCode,

      observed_at:
        toObservedAt(
          targetDate,
          String(
            row.stck_cntg_hour,
          ),
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
        minute_bar:
          row,

        interval_volume:
          intervalVolume,
      },
    });
  }

  return {
    requestCount,

    minuteBars,

    snapshots,

    earliestTime:
      minuteBars[0]
        ?.stck_cntg_hour ??
      null,

    latestTime:
      minuteBars.at(-1)
        ?.stck_cntg_hour ??
      null,
  };
}

function correctedSignal(
  snapshots: any[],
  threshold: number,
) {
  if (
    snapshots.length <
    2
  ) {
    return null;
  }

  const latest =
    snapshots.at(-1);

  const previous =
    snapshots.at(-2);

  const latestClose =
    toNumber(
      latest.close_price,
    );

  const previousClose =
    toNumber(
      previous.close_price,
    );

  if (
    latestClose ===
      null ||
    previousClose ===
      null ||
    latestClose <=
      0 ||
    previousClose <=
      0
  ) {
    return null;
  }

  const latestOpen =
    toNumber(
      latest.open_price,
    );

  const latestHigh =
    toNumber(
      latest.high_price,
    );

  const latestLow =
    toNumber(
      latest.low_price,
    );

  const momentumRate =
    latestClose /
      previousClose -
    1;

  const intradayRate =
    latestOpen !==
      null &&
    latestOpen >
      0
      ? latestClose /
          latestOpen -
        1
      : 0;

  const rangePosition =
    latestHigh !==
      null &&
    latestLow !==
      null &&
    latestHigh >
      latestLow
      ? clamp(
          (
            latestClose -
            latestLow
          ) /
            (
              latestHigh -
              latestLow
            ),
        )
      : 0.5;

  const cumulativeVolumes =
    snapshots.map(
      (row) =>
        toNumber(
          row.volume,
        ),
    );

  const deltas:
    number[] =
    [];

  for (
    let i = 1;
    i <
    cumulativeVolumes.length;
    i += 1
  ) {
    const current =
      cumulativeVolumes[
        i
      ];

    const previousVolume =
      cumulativeVolumes[
        i - 1
      ];

    if (
      current !==
        null &&
      previousVolume !==
        null &&
      current >=
        previousVolume
    ) {
      deltas.push(
        current -
        previousVolume,
      );
    }
  }

  const latestDelta =
    deltas.length
      ? deltas.at(-1)!
      : null;

  const priorDeltas =
    deltas.slice(
      Math.max(
        0,
        deltas.length -
        6,
      ),
      -1,
    );

  const priorAverage =
    avg(
      priorDeltas,
    );

  const volumeRatio =
    latestDelta !==
      null &&
    priorAverage !==
      null &&
    priorAverage >
      0
      ? latestDelta /
        priorAverage
      : 1;

  const momentumScore =
    clamp(
      (
        momentumRate +
        0.01
      ) /
        0.03,
    );

  const intradayScore =
    clamp(
      (
        intradayRate +
        0.01
      ) /
        0.025,
    );

  const rangeScore =
    clamp(
      rangePosition,
    );

  const volumeScore =
    clamp(
      (
        volumeRatio -
        0.8
      ) /
        1.2,
    );

  const score =
    momentumScore *
      0.4 +
    intradayScore *
      0.25 +
    rangeScore *
      0.2 +
    volumeScore *
      0.15;

  return {
    observedAt:
      latest.observed_at,

    entryPrice:
      latestClose,

    score,

    qualifies:
      score >=
        threshold &&
      momentumRate >
        0 &&
      intradayRate >
        -0.005,
  };
}

function firstQualified(
  snapshots: any[],
  threshold: number,
) {
  for (
    let i = 0;
    i <
    snapshots.length;
    i += 1
  ) {
    const signal =
      correctedSignal(
        snapshots.slice(
          0,
          i + 1,
        ),
        threshold,
      );

    if (
      signal
        ?.qualifies
    ) {
      return signal;
    }
  }

  return null;
}

function simulateLimitFill(
  snapshots: any[],
  signalObservedAt: string,
  limitPrice: number,
) {
  const signalMs =
    new Date(
      signalObservedAt,
    ).getTime();

  for (const row of snapshots) {
    const observedMs =
      new Date(
        row.observed_at,
      ).getTime();

    if (
      observedMs <
      signalMs
    ) {
      continue;
    }

    const minute =
      row.raw_payload
        ?.minute_bar;

    if (!minute) {
      continue;
    }

    const minuteOpen =
      toNumber(
        minute.stck_oprc,
      );

    const minuteLow =
      toNumber(
        minute.stck_lwpr,
      );

    if (
      minuteOpen ===
        null ||
      minuteLow ===
        null
    ) {
      continue;
    }

    if (
      minuteOpen <=
      limitPrice
    ) {
      return {
        filled:
          true,

        fillPrice:
          minuteOpen,

        observedAt:
          row.observed_at,

        fillType:
          "OPEN_AT_OR_BELOW_LIMIT",
      };
    }

    if (
      minuteLow <=
      limitPrice
    ) {
      return {
        filled:
          true,

        fillPrice:
          limitPrice,

        observedAt:
          row.observed_at,

        fillType:
          "INTRAMINUTE_LIMIT_TOUCH",
      };
    }
  }

  return {
    filled:
      false,

    fillPrice:
      null,

    observedAt:
      null,

    fillType:
      null,
  };
}

function checkpointKey(
  row: any,
) {
  return (
    `${row.targetSessionDate}|` +
    `${row.top1.stockCode}`
  );
}

async function main() {
  const root =
    process.cwd();

  const historyPath =
    path.join(
      root,
      "logs",
      "alpha-v3-extended-pricevolume-top1-history.json",
    );

  const boundaryPath =
    path.join(
      root,
      "logs",
      "alpha-v3-kis-intraday-retention-boundary.json",
    );

  const checkpointPath =
    path.join(
      root,
      "logs",
      "alpha-v3-extended-entry-v3-replay-checkpoint.json",
    );

  if (
    !fs.existsSync(
      historyPath,
    ) ||
    !fs.existsSync(
      boundaryPath,
    )
  ) {
    throw new Error(
      "EXTENDED_HISTORY_OR_BOUNDARY_LOG_MISSING",
    );
  }

  const history =
    JSON.parse(
      fs.readFileSync(
        historyPath,
        "utf8",
      ),
    );

  const boundary =
    JSON.parse(
      fs.readFileSync(
        boundaryPath,
        "utf8",
      ),
    );

  if (
    boundary.status !==
    "ALPHA_V3_KIS_INTRADAY_RETENTION_BOUNDARY_COMPLETE"
  ) {
    throw new Error(
      "KIS_RETENTION_BOUNDARY_NOT_COMPLETE",
    );
  }

  if (
    boundary.boundary
      ?.monotonicBoundaryValid !==
    true
  ) {
    throw new Error(
      "KIS_RETENTION_BOUNDARY_NOT_MONOTONIC",
    );
  }

  const startDate =
    String(
      boundary.usableRange
        .start,
    );

  const endDate =
    String(
      boundary.usableRange
        .end,
    );

  const sessions =
    (
      history.top1Rows ??
      []
    )
      .filter(
        (row: any) =>
          String(
            row.targetSessionDate,
          ) >=
            startDate &&
          String(
            row.targetSessionDate,
          ) <=
            endDate,
      )
      .sort(
        (a: any, b: any) =>
          checkpointKey(
            a,
          ).localeCompare(
            checkpointKey(
              b,
            ),
          ),
      );

  if (
    sessions.length !==
    Number(
      boundary.usableRange
        .top1SessionCount,
    )
  ) {
    throw new Error(
      `USABLE_SESSION_COUNT_MISMATCH:${sessions.length}:${boundary.usableRange.top1SessionCount}`,
    );
  }

  let checkpoint:
    any = {
      version:
        "ALPHA_V3_EXTENDED_ENTRY_V3_REPLAY_CHECKPOINT_V1",

      usableRange: {
        start:
          startDate,

        end:
          endDate,
      },

      entryScoreThreshold:
        null,

      premiumCaps: [
        0.0025,
        0.005,
        0.0075,
        0.01,
      ],

      results: [],
    };

  if (
    fs.existsSync(
      checkpointPath,
    )
  ) {
    checkpoint =
      JSON.parse(
        fs.readFileSync(
          checkpointPath,
          "utf8",
        ),
      );

    if (
      checkpoint.version !==
      "ALPHA_V3_EXTENDED_ENTRY_V3_REPLAY_CHECKPOINT_V1"
    ) {
      throw new Error(
        "CHECKPOINT_VERSION_MISMATCH",
      );
    }

    if (
      checkpoint.usableRange
        ?.start !==
        startDate ||
      checkpoint.usableRange
        ?.end !==
        endDate
    ) {
      throw new Error(
        "CHECKPOINT_RANGE_MISMATCH",
      );
    }
  }

  const threshold =
    normalizeThreshold(
      await getActiveEntryThreshold(),
    );

  checkpoint.entryScoreThreshold =
    threshold;

  const completedKeys =
    new Set(
      (
        checkpoint.results ??
        []
      ).map(
        (row: any) =>
          `${row.targetSessionDate}|${row.stockCode}`,
      ),
    );

  const pending =
    sessions.filter(
      (row: any) =>
        !completedKeys.has(
          checkpointKey(
            row,
          ),
        ),
    );

  const batch =
    pending.slice(
      0,
      SESSION_BATCH_SIZE,
    );

  const supabase =
    createSupabaseServerClient();

  const stockCodes =
    [
      ...new Set(
        sessions.map(
          (row: any) =>
            String(
              row.top1.stockCode,
            ),
        ),
      ),
    ];

  const {
    data:
      dailyBarData,

    error:
      dailyBarError,
  } =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(
        "stock_code,trading_date,open_price,close_price,adjusted_price",
      )
      .in(
        "stock_code",
        stockCodes,
      )
      .eq(
        "adjusted_price",
        true,
      )
      .gte(
        "trading_date",
        startDate,
      )
      .lte(
        "trading_date",
        "2026-10-31",
      )
      .order(
        "stock_code",
      )
      .order(
        "trading_date",
      )
      .limit(
        10000,
      );

  if (
    dailyBarError
  ) {
    throw dailyBarError;
  }

  const barsByStock =
    new Map<string, any[]>();

  for (
    const row
    of dailyBarData ??
    []
  ) {
    const open =
      Number(
        row.open_price,
      );

    const close =
      Number(
        row.close_price,
      );

    if (
      !Number.isFinite(
        open,
      ) ||
      !Number.isFinite(
        close,
      ) ||
      open <=
        0 ||
      close <=
        0
    ) {
      continue;
    }

    const code =
      String(
        row.stock_code,
      );

    const arr =
      barsByStock.get(
        code,
      ) ??
      [];

    arr.push({
      date:
        String(
          row.trading_date,
        ),

      open,

      close,
    });

    barsByStock.set(
      code,
      arr,
    );
  }

  if (
    batch.length ===
    0
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_EXTENDED_ENTRY_V3_REPLAY_ALREADY_COMPLETE",

          counts: {
            totalSessions:
              sessions.length,

            completedSessions:
              completedKeys.size,

            remainingSessions:
              0,
          },

          checkpointFile:
            "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",

          nextGate:
            "ANALYZE_EXTENDED_ENTRY_V3_REPLAY",
        },
        null,
        2,
      ),
    );

    return;
  }

  const accessToken =
    await getKisAccessToken();

  let batchRequests =
    0;

  const premiumCaps =
    checkpoint.premiumCaps as
      number[];

  for (
    let index = 0;
    index <
    batch.length;
    index += 1
  ) {
    const session =
      batch[index];

    const stockCode =
      String(
        session.top1.stockCode,
      );

    const targetSessionDate =
      String(
        session.targetSessionDate,
      );

    const minute =
      await fetchFullMinuteSession(
        stockCode,
        targetSessionDate,
        accessToken,
      );

    batchRequests +=
      minute.requestCount;

    const fullCoverage =
      minute.snapshots.length ===
        381 &&
      minute.earliestTime ===
        "090000" &&
      minute.latestTime ===
        "153000";

    const signal =
      fullCoverage
        ? firstQualified(
            minute.snapshots,
            threshold,
          )
        : null;

    const forwardBars =
      (
        barsByStock.get(
          stockCode,
        ) ??
        []
      ).filter(
        (bar) =>
          bar.date >=
          targetSessionDate,
      );

    const b1 =
      forwardBars[0];

    const b3 =
      forwardBars[2];

    const b5 =
      forwardBars[4];

    const directReturn = (
      bar: any,
    ) =>
      signal &&
      bar
        ? bar.close /
            signal.entryPrice -
          1
        : null;

    const policies =
      premiumCaps.map(
        (cap) => {
          const sessionOpen =
            b1?.open ??
            null;

          if (
            !signal ||
            !sessionOpen
          ) {
            return {
              maxPremium:
                cap,

              filled:
                false,

              fillPrice:
                null,

              observedAt:
                null,

              fillType:
                null,

              returns: {
                r1:
                  null,

                r3:
                  null,

                r5:
                  null,
              },
            };
          }

          const limitPrice =
            sessionOpen *
            (
              1 +
              cap
            );

          const fill =
            simulateLimitFill(
              minute.snapshots,
              signal.observedAt,
              limitPrice,
            );

          const ret = (
            bar: any,
          ) =>
            fill.filled &&
            fill.fillPrice &&
            bar
              ? bar.close /
                  fill.fillPrice -
                1
              : null;

          return {
            maxPremium:
              cap,

            limitPrice,

            ...fill,

            returns: {
              r1:
                ret(
                  b1,
                ),

              r3:
                ret(
                  b3,
                ),

              r5:
                ret(
                  b5,
                ),
            },
          };
        },
      );

    checkpoint.results.push({
      sourceTradingDate:
        session.sourceTradingDate,

      targetSessionDate,

      stockCode,

      stockName:
        session.top1.stockName,

      alphaV2EffectiveScore:
        session.top1
          .effectiveScore,

      alphaV2RawPriceVolumeScore:
        session.top1
          .rawPriceVolumeScore,

      minuteCoverage: {
        sourceRows:
          minute.snapshots.length,

        earliestTime:
          minute.earliestTime,

        latestTime:
          minute.latestTime,

        fullCoverage,
      },

      correctedEntry:
        signal
          ? {
              qualified:
                true,

              observedAt:
                signal.observedAt,

              entryPrice:
                signal.entryPrice,

              score:
                signal.score,

              directReturns: {
                r1:
                  directReturn(
                    b1,
                  ),

                r3:
                  directReturn(
                    b3,
                  ),

                r5:
                  directReturn(
                    b5,
                  ),
              },
            }
          : {
              qualified:
                false,

              observedAt:
                null,

              entryPrice:
                null,

              score:
                null,

              directReturns: {
                r1:
                  null,

                r3:
                  null,

                r5:
                  null,
              },
            },

      limitPolicies:
        policies,
    });

    /*
     * Persist after every completed session so interruption is safe.
     */
    fs.writeFileSync(
      checkpointPath,
      JSON.stringify(
        checkpoint,
        null,
        2,
      ) + "\n",
      "utf8",
    );

    if (
      index <
      batch.length -
        1
    ) {
      await sleep(
        REQUEST_DELAY_MS,
      );
    }
  }

  const newCompletedCount =
    checkpoint.results.length;

  const remaining =
    Math.max(
      0,
      sessions.length -
      newCompletedCount,
    );

  const result = {
    status:
      remaining ===
      0
        ? "ALPHA_V3_EXTENDED_ENTRY_V3_REPLAY_COMPLETE"
        : "ALPHA_V3_EXTENDED_ENTRY_V3_REPLAY_BATCH_COMPLETE",

    counts: {
      totalSessions:
        sessions.length,

      previouslyCompletedSessions:
        completedKeys.size,

      batchProcessedSessions:
        batch.length,

      completedSessions:
        newCompletedCount,

      remainingSessions:
        remaining,

      batchKisRequests:
        batchRequests,
    },

    checkpointFile:
      "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",

    policy: {
      entryScoreThreshold:
        threshold,

      premiumCaps,

      sessionBatchSize:
        SESSION_BATCH_SIZE,

      checkpointAfterEverySession:
        true,

      productionChanged:
        false,

      databaseWrites:
        0,
    },

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },

    nextGate:
      remaining ===
      0
        ? "ANALYZE_EXTENDED_ENTRY_V3_REPLAY"
        : "RUN_NEXT_EXTENDED_ENTRY_V3_REPLAY_BATCH",
  };

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
            "ALPHA_V3_EXTENDED_ENTRY_V3_REPLAY_BATCH_FAILED",

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

          checkpointPreserved:
            true,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
