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

const REQUEST_DELAY_MS = 700;
const MARKET_OPEN = "090000";
const MARKET_CLOSE = "153000";
const MAX_PAGES_PER_SESSION = 6;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const n = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
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
    const row = value as Record<string, unknown>;

    for (const key of [
      "threshold",
      "scoreThreshold",
      "entryScoreThreshold",
      "value",
    ]) {
      const n = Number(row[key]);

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

function digitsDate(sqlDate: string) {
  return sqlDate.replace(/-/g, "");
}

function toObservedAt(
  businessDate: string,
  time: string,
) {
  const date =
    `${businessDate.slice(0, 4)}-` +
    `${businessDate.slice(4, 6)}-` +
    `${businessDate.slice(6, 8)}`;

  return new Date(
    `${date}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00`,
  ).toISOString();
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
        "Content-Type": "application/json; charset=utf-8",
        authorization: `Bearer ${accessToken}`,
        appkey: appKey,
        appsecret: appSecret,
        tr_id: "FHKST03010230",
        custtype: "P",
      },
      cache: "no-store",
    },
  );

  const body =
    await response.json() as Record<string, any>;

  if (!response.ok) {
    throw new Error(
      `KIS_HTTP_${response.status}:${body.msg_cd ?? "UNKNOWN"}:${body.msg1 ?? "UNKNOWN"}`,
    );
  }

  if (
    body.rt_cd !== undefined &&
    body.rt_cd !== "0"
  ) {
    throw new Error(
      `KIS_API_ERROR:${body.rt_cd}:${body.msg_cd ?? "UNKNOWN"}:${body.msg1 ?? "UNKNOWN"}`,
    );
  }

  return Array.isArray(body.output2)
    ? body.output2
    : [];
}

async function fetchFullMinuteSession(
  stockCode: string,
  sqlDate: string,
  accessToken: string,
) {
  const targetDate = digitsDate(sqlDate);
  const unique = new Map<string, any>();

  let anchor = MARKET_CLOSE;
  let requestCount = 0;

  for (
    let page = 0;
    page < MAX_PAGES_PER_SESSION;
    page += 1
  ) {
    requestCount += 1;

    const output = await fetchPage(
      stockCode,
      targetDate,
      anchor,
      accessToken,
    );

    const rows = output
      .filter(
        (row: any) =>
          String(row.stck_bsop_date ?? "") === targetDate &&
          /^\d{6}$/.test(
            String(row.stck_cntg_hour ?? ""),
          ),
      );

    for (const row of rows) {
      const time = String(row.stck_cntg_hour);

      if (
        time >= MARKET_OPEN &&
        time <= MARKET_CLOSE
      ) {
        unique.set(
          `${targetDate}|${time}`,
          row,
        );
      }
    }

    const times = rows
      .map((row: any) =>
        String(row.stck_cntg_hour),
      )
      .filter((time: string) =>
        /^\d{6}$/.test(time),
      )
      .sort();

    if (!times.length) {
      break;
    }

    const earliest = times[0];

    if (earliest <= MARKET_OPEN) {
      break;
    }

    const nextAnchor = previousMinute(earliest);

    if (nextAnchor >= anchor) {
      break;
    }

    anchor = nextAnchor;

    await sleep(REQUEST_DELAY_MS);
  }

  const minuteBars =
    [...unique.values()]
      .sort(
        (a, b) =>
          String(a.stck_cntg_hour)
            .localeCompare(
              String(b.stck_cntg_hour),
            ),
      );

  let sessionOpen: number | null = null;
  let runningHigh: number | null = null;
  let runningLow: number | null = null;
  let cumulativeVolume = 0;

  const snapshots: any[] = [];

  for (const row of minuteBars) {
    const minuteOpen =
      toNumber(row.stck_oprc);

    const minuteHigh =
      toNumber(row.stck_hgpr);

    const minuteLow =
      toNumber(row.stck_lwpr);

    const close =
      toNumber(row.stck_prpr);

    const intervalVolume =
      toNumber(row.cntg_vol);

    if (
      minuteOpen === null ||
      minuteHigh === null ||
      minuteLow === null ||
      close === null ||
      intervalVolume === null ||
      intervalVolume < 0
    ) {
      continue;
    }

    if (sessionOpen === null) {
      sessionOpen = minuteOpen;
    }

    runningHigh =
      runningHigh === null
        ? minuteHigh
        : Math.max(runningHigh, minuteHigh);

    runningLow =
      runningLow === null
        ? minuteLow
        : Math.min(runningLow, minuteLow);

    cumulativeVolume += intervalVolume;

    snapshots.push({
      stock_code: stockCode,
      observed_at: toObservedAt(
        targetDate,
        String(row.stck_cntg_hour),
      ),
      open_price: sessionOpen,
      high_price: runningHigh,
      low_price: runningLow,
      close_price: close,
      volume: cumulativeVolume,
      raw_payload: {
        minute_bar: row,
        interval_volume: intervalVolume,
      },
    });
  }

  return {
    requestCount,
    minuteBars,
    snapshots,
    earliestTime:
      minuteBars[0]?.stck_cntg_hour ?? null,
    latestTime:
      minuteBars.at(-1)?.stck_cntg_hour ?? null,
  };
}

function correctedSignal(
  snapshots: any[],
  threshold: number,
) {
  if (snapshots.length < 2) {
    return null;
  }

  const latest = snapshots.at(-1);
  const previous = snapshots.at(-2);

  const latestClose =
    toNumber(latest.close_price);

  const previousClose =
    toNumber(previous.close_price);

  if (
    latestClose === null ||
    previousClose === null ||
    latestClose <= 0 ||
    previousClose <= 0
  ) {
    return null;
  }

  const latestOpen =
    toNumber(latest.open_price);

  const latestHigh =
    toNumber(latest.high_price);

  const latestLow =
    toNumber(latest.low_price);

  const momentumRate =
    latestClose / previousClose - 1;

  const intradayRate =
    latestOpen !== null &&
    latestOpen > 0
      ? latestClose / latestOpen - 1
      : 0;

  const rangePosition =
    latestHigh !== null &&
    latestLow !== null &&
    latestHigh > latestLow
      ? clamp(
          (latestClose - latestLow) /
            (latestHigh - latestLow),
        )
      : 0.5;

  const cumulativeVolumes =
    snapshots.map(
      (row) =>
        toNumber(row.volume),
    );

  const deltas: number[] = [];

  for (
    let i = 1;
    i < cumulativeVolumes.length;
    i += 1
  ) {
    const cur = cumulativeVolumes[i];
    const prev = cumulativeVolumes[i - 1];

    if (
      cur !== null &&
      prev !== null &&
      cur >= prev
    ) {
      deltas.push(cur - prev);
    }
  }

  const latestDelta =
    deltas.length
      ? deltas.at(-1)!
      : null;

  const priorDeltas =
    deltas.slice(
      Math.max(0, deltas.length - 6),
      -1,
    );

  const priorAvg =
    avg(priorDeltas);

  const volumeRatio =
    latestDelta !== null &&
    priorAvg !== null &&
    priorAvg > 0
      ? latestDelta / priorAvg
      : 1;

  const momentumScore =
    clamp(
      (momentumRate + 0.01) / 0.03,
    );

  const intradayScore =
    clamp(
      (intradayRate + 0.01) / 0.025,
    );

  const rangeScore =
    clamp(rangePosition);

  const volumeScore =
    clamp(
      (volumeRatio - 0.8) / 1.2,
    );

  const score =
    momentumScore * 0.4 +
    intradayScore * 0.25 +
    rangeScore * 0.2 +
    volumeScore * 0.15;

  const qualifies =
    score >= threshold &&
    momentumRate > 0 &&
    intradayRate > -0.005;

  return {
    observedAt: latest.observed_at,
    entryPrice: latestClose,
    score,
    qualifies,
  };
}

function firstQualified(
  snapshots: any[],
  threshold: number,
) {
  for (
    let i = 0;
    i < snapshots.length;
    i += 1
  ) {
    const signal =
      correctedSignal(
        snapshots.slice(0, i + 1),
        threshold,
      );

    if (signal?.qualifies) {
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
    new Date(signalObservedAt).getTime();

  for (const row of snapshots) {
    const observedMs =
      new Date(row.observed_at).getTime();

    if (observedMs < signalMs) {
      continue;
    }

    const minute =
      row.raw_payload?.minute_bar;

    if (!minute) {
      continue;
    }

    const minuteOpen =
      toNumber(minute.stck_oprc);

    const minuteLow =
      toNumber(minute.stck_lwpr);

    if (
      minuteOpen === null ||
      minuteLow === null
    ) {
      continue;
    }

    if (minuteOpen <= limitPrice) {
      return {
        filled: true,
        fillPrice: minuteOpen,
        observedAt: row.observed_at,
      };
    }

    if (minuteLow <= limitPrice) {
      return {
        filled: true,
        fillPrice: limitPrice,
        observedAt: row.observed_at,
      };
    }
  }

  return {
    filled: false,
    fillPrice: null,
    observedAt: null,
  };
}

async function main() {
  const root = process.cwd();

  const coverage = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        "logs",
        "alpha-v2-entry-target-session-coverage.json",
      ),
      "utf8",
    ),
  );

  if (
    coverage.version !==
    "V2_EXACT_COUNT_PER_TARGET_SESSION"
  ) {
    throw new Error(
      "ROW_CAP_FIXED_COVERAGE_REQUIRED",
    );
  }

  const dedup = new Map<string, any>();

  for (
    const row
    of coverage.replayableRows ?? []
  ) {
    const key =
      `${row.targetSessionDate}|${row.stockCode}`;

    const current =
      dedup.get(key);

    if (
      !current ||
      new Date(row.decisionAt).getTime() >
        new Date(current.decisionAt).getTime()
    ) {
      dedup.set(key, row);
    }
  }

  const sessions =
    [...dedup.values()]
      .sort(
        (a, b) =>
          `${a.targetSessionDate}|${a.stockCode}`
            .localeCompare(
              `${b.targetSessionDate}|${b.stockCode}`,
            ),
      );

  const threshold =
    normalizeThreshold(
      await getActiveEntryThreshold(),
    );

  const accessToken =
    await getKisAccessToken();

  const stockCodes =
    [
      ...new Set(
        sessions.map(
          (row: any) =>
            row.stockCode,
        ),
      ),
    ];

  const firstDate =
    sessions[0]
      .targetSessionDate;

  const supabase =
    createSupabaseServerClient();

  const {
    data:
      dailyBars,
    error:
      dailyBarError,
  } =
    await supabase
      .from("market_daily_bars")
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
        firstDate,
      )
      .lte(
        "trading_date",
        "2026-10-31",
      )
      .order("stock_code")
      .order("trading_date")
      .limit(10000);

  if (dailyBarError) {
    throw dailyBarError;
  }

  const barsByStock =
    new Map<string, any[]>();

  for (const row of dailyBars ?? []) {
    const open =
      Number(row.open_price);

    const close =
      Number(row.close_price);

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      close <= 0
    ) {
      continue;
    }

    const code =
      String(row.stock_code);

    const arr =
      barsByStock.get(code) ??
      [];

    arr.push({
      date:
        String(row.trading_date),
      open,
      close,
    });

    barsByStock.set(code, arr);
  }

  const premiumCaps = [
    0.0025,
    0.005,
    0.0075,
    0.01,
  ];

  const results: any[] = [];

  let totalKisRequests = 0;

  for (
    let index = 0;
    index < sessions.length;
    index += 1
  ) {
    const session =
      sessions[index];

    const minute =
      await fetchFullMinuteSession(
        session.stockCode,
        session.targetSessionDate,
        accessToken,
      );

    totalKisRequests +=
      minute.requestCount;

    const fullCoverage =
      minute.snapshots.length === 381 &&
      minute.earliestTime === "090000" &&
      minute.latestTime === "153000";

    const signal =
      firstQualified(
        minute.snapshots,
        threshold,
      );

    const forward =
      (
        barsByStock.get(
          session.stockCode,
        ) ??
        []
      ).filter(
        (bar) =>
          bar.date >=
          session.targetSessionDate,
      );

    const b1 = forward[0];
    const b3 = forward[2];
    const b5 = forward[4];

    const directRet = (
      bar: any,
    ) =>
      signal &&
      bar
        ? bar.close /
            signal.entryPrice -
          1
        : null;

    const limitPolicies =
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
              returns: {
                r1: null,
                r3: null,
                r5: null,
              },
            };
          }

          const limitPrice =
            sessionOpen *
            (1 + cap);

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
              r1: ret(b1),
              r3: ret(b3),
              r5: ret(b5),
            },
          };
        },
      );

    results.push({
      alphaDate:
        session.alphaDate,

      stockCode:
        session.stockCode,

      targetSessionDate:
        session.targetSessionDate,

      sourceRows:
        minute.snapshots.length,

      earliestTime:
        minute.earliestTime,

      latestTime:
        minute.latestTime,

      fullCoverage,

      correctedSignal:
        signal
          ? {
              qualified: true,
              observedAt:
                signal.observedAt,
              entryPrice:
                signal.entryPrice,
              score:
                signal.score,
              directReturns: {
                r1:
                  directRet(b1),
                r3:
                  directRet(b3),
                r5:
                  directRet(b5),
              },
            }
          : {
              qualified: false,
              observedAt: null,
              entryPrice: null,
              score: null,
              directReturns: {
                r1: null,
                r3: null,
                r5: null,
              },
            },

      limitPolicies,
    });

    if (
      index <
      sessions.length - 1
    ) {
      await sleep(
        REQUEST_DELAY_MS,
      );
    }
  }

  const full =
    results.filter(
      (row) =>
        row.fullCoverage,
    );

  const qualified =
    full.filter(
      (row) =>
        row.correctedSignal
          .qualified,
    );

  const directSummary = {
    candidateSessions:
      full.length,

    qualifiedSessions:
      qualified.length,

    qualificationRate:
      full.length
        ? qualified.length /
          full.length
        : null,

    meanReturn: {
      r1:
        avg(
          qualified
            .map(
              (row) =>
                row.correctedSignal
                  .directReturns.r1,
            )
            .filter(
              Number.isFinite,
            ),
        ),

      r3:
        avg(
          qualified
            .map(
              (row) =>
                row.correctedSignal
                  .directReturns.r3,
            )
            .filter(
              Number.isFinite,
            ),
        ),

      r5:
        avg(
          qualified
            .map(
              (row) =>
                row.correctedSignal
                  .directReturns.r5,
            )
            .filter(
              Number.isFinite,
            ),
        ),
    },
  };

  const limitSummaries =
    premiumCaps.map(
      (cap) => {
        const policies =
          qualified
            .map(
              (row) =>
                row.limitPolicies.find(
                  (policy: any) =>
                    policy.maxPremium ===
                    cap,
                ),
            )
            .filter(Boolean);

        const filled =
          policies.filter(
            (policy: any) =>
              policy.filled,
          );

        const meanReturn = (
          horizon:
            | "r1"
            | "r3"
            | "r5",
        ) =>
          avg(
            filled
              .map(
                (policy: any) =>
                  policy.returns[
                    horizon
                  ],
              )
              .filter(
                Number.isFinite,
              ),
          );

        return {
          maxPremium:
            cap,

          candidateSessions:
            policies.length,

          filledSessions:
            filled.length,

          fillRate:
            policies.length
              ? filled.length /
                policies.length
              : null,

          meanReturn: {
            r1:
              meanReturn("r1"),
            r3:
              meanReturn("r3"),
            r5:
              meanReturn("r5"),
          },
        };
      },
    );

  const result = {
    status:
      "ALPHA_V2_ALL_18_KIS_MINUTE_LIMIT_REPLAY_COMPLETE",

    entryScoreThreshold:
      threshold,

    counts: {
      uniqueTargetSessions:
        sessions.length,

      full381KisSessions:
        full.length,

      incompleteKisSessions:
        results.length -
        full.length,

      correctedQualifiedSessions:
        qualified.length,

      totalKisRequests,
    },

    directCorrectedEntry:
      directSummary,

    limitPolicies:
      limitSummaries,

    results,

    methodology: {
      intradaySource:
        "KIS FHKST03010230 historical 1-minute bars for every target session",

      databaseSnapshotMixing:
        false,

      correctedEntry:
        "minimum 2 snapshots + previous-close momentum + interval-volume delta",

      limitExecution:
        "after corrected signal, cap buy price at session open plus premium",

      productionParameterSelectionAllowed:
        false,

      reason:
        "Still a small 18-session sample; use for direction selection, not final production calibration.",
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

      productionChanged:
        false,
    },

    nextGate:
      "DECIDE_ENTRY_V3_DIRECTION_FROM_UNIFORM_18_SESSION_MINUTE_REPLAY",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-all-18-kis-minute-limit-replay.json",
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
      {
        status:
          result.status,

        entryScoreThreshold:
          result.entryScoreThreshold,

        counts:
          result.counts,

        directCorrectedEntry:
          result.directCorrectedEntry,

        limitPolicies:
          result.limitPolicies,

        nextGate:
          result.nextGate,

        outputFile:
          "logs/alpha-v2-all-18-kis-minute-limit-replay.json",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V2_ALL_18_KIS_MINUTE_LIMIT_REPLAY_FAILED",

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
});
