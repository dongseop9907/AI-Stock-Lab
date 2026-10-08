import fs from "node:fs";
import path from "node:path";

import {
  getKisAccessToken,
} from "../lib/kis/client";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const VERSION =
  "ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_COLLECTOR_V1";

const HISTORICAL_CUTOFF =
  "2026-10-07";

const FROZEN_ENTRY_THRESHOLD =
  0.66;

const FROZEN_PREMIUM_CAP =
  0.01;

const REQUEST_DELAY_MS =
  1200;

const MARKET_OPEN =
  "090000";

const MARKET_CLOSE =
  "153000";

const MAX_PAGES_PER_SESSION =
  6;

const MAX_RETRIES =
  3;

const FORWARD_TOP1_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-forward-top1-sessions.json",
  );

const FROZEN_STATE_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-entry-v3-forward-shadow-oos-state.json",
  );

const OBSERVATION_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-entry-v3-forward-oos-observations.json",
  );

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


function kstClock(
  now:
    Date = new Date(),
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "Asia/Seoul",
        year:
          "numeric",
        month:
          "2-digit",
        day:
          "2-digit",
        hour:
          "2-digit",
        minute:
          "2-digit",
        hourCycle:
          "h23",
      },
    ).formatToParts(
      now,
    );

  const map =
    new Map(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );

  return {
    date:
      `${map.get("year")}-${map.get("month")}-${map.get("day")}`,

    hour:
      Number(
        map.get("hour") ??
        0,
      ),

    minute:
      Number(
        map.get("minute") ??
        0,
      ),
  };
}

export function targetSessionReadyForEntryCollection(
  targetSessionDate:
    string,
  now:
    Date = new Date(),
) {
  const clock =
    kstClock(
      now,
    );

  if (
    targetSessionDate <
    clock.date
  ) {
    return true;
  }

  if (
    targetSessionDate >
    clock.date
  ) {
    return false;
  }

  return (
    clock.hour * 60 +
      clock.minute >=
    15 * 60 +
      40
  );
}

function readJson(
  file:
    string,
) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8",
    ),
  );
}

function writeJsonAtomic(
  file:
    string,
  value:
    unknown,
) {
  fs.mkdirSync(
    path.dirname(
      file,
    ),
    {
      recursive:
        true,
    },
  );

  const temp =
    `${file}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  fs.renameSync(
    temp,
    file,
  );
}

function validateFrozenContract() {
  if (
    !fs.existsSync(
      FROZEN_STATE_FILE,
    )
  ) {
    throw new Error(
      "FORWARD_OOS_FROZEN_STATE_NOT_FOUND",
    );
  }

  const state =
    readJson(
      FROZEN_STATE_FILE,
    );

  if (
    state.historicalCutoff !==
      HISTORICAL_CUTOFF ||
    Number(
      state.selectedCap,
    ) !==
      FROZEN_PREMIUM_CAP ||
    Number(
      state.entryScoreThreshold,
    ) !==
      FROZEN_ENTRY_THRESHOLD ||
    state.frozen !==
      true
  ) {
    throw new Error(
      "FORWARD_OOS_FROZEN_CONTRACT_MISMATCH",
    );
  }

  return state;
}

function readObservationDataset() {
  if (
    !fs.existsSync(
      OBSERVATION_FILE,
    )
  ) {
    return {
      version:
        VERSION,

      contract: {
        historicalCutoff:
          HISTORICAL_CUTOFF,

        selectedCap:
          FROZEN_PREMIUM_CAP,

        entryScoreThreshold:
          FROZEN_ENTRY_THRESHOLD,

        retuningAllowed:
          false,

        candidateSource:
          "logs/alpha-v3-forward-top1-sessions.json",

        historicalCheckpointMutable:
          false,
      },

      observations:
        [],
    };
  }

  const dataset =
    readJson(
      OBSERVATION_FILE,
    );

  if (
    dataset.version !==
    VERSION
  ) {
    throw new Error(
      "FORWARD_ENTRY_DATASET_VERSION_MISMATCH",
    );
  }

  dataset.observations =
    Array.isArray(
      dataset.observations,
    )
      ? dataset.observations
      : [];

  return dataset;
}

async function readForwardDailyBars(
  stockCode:
    string,
  targetSessionDate:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(
        "trading_date,open_price,close_price,adjusted_price",
      )
      .eq(
        "stock_code",
        stockCode,
      )
      .eq(
        "adjusted_price",
        true,
      )
      .gte(
        "trading_date",
        targetSessionDate,
      )
      .order(
        "trading_date",
        {
          ascending:
            true,
        },
      )
      .limit(
        10,
      );

  if (
    error
  ) {
    throw new Error(
      `FORWARD_DAILY_BARS_READ_FAILED:${error.message}`,
    );
  }

  return (
    data ??
    []
  ).map(
    (row: any) => ({
      date:
        String(
          row.trading_date,
        ),

      open:
        toNumber(
          row.open_price,
        ),

      close:
        toNumber(
          row.close_price,
        ),
    }),
  );
}

function computeReturn(
  denominator:
    number | null,
  bar:
    {
      close:
        number | null;
    } | undefined,
) {
  if (
    denominator ===
      null ||
    denominator <=
      0 ||
    !bar ||
    bar.close ===
      null
  ) {
    return null;
  }

  return (
    bar.close /
      denominator -
    1
  );
}

async function enrichMaturedLabels(
  observation:
    any,
) {
  const bars =
    await readForwardDailyBars(
      String(
        observation.stockCode,
      ),
      String(
        observation.targetSessionDate,
      ),
    );

  const b1 =
    bars[0];

  const b3 =
    bars[2];

  const b5 =
    bars[4];

  const entryPrice =
    toNumber(
      observation.correctedEntry
        ?.entryPrice,
    );

  const fillPrice =
    toNumber(
      observation.selectedPolicy
        ?.fillPrice,
    );

  observation.correctedEntry =
    observation.correctedEntry ??
    {};

  observation.correctedEntry.directReturns = {
    r1:
      computeReturn(
        entryPrice,
        b1,
      ),

    r3:
      computeReturn(
        entryPrice,
        b3,
      ),

    r5:
      computeReturn(
        entryPrice,
        b5,
      ),
  };

  observation.selectedPolicy =
    observation.selectedPolicy ??
    {};

  observation.selectedPolicy.returns = {
    r1:
      computeReturn(
        fillPrice,
        b1,
      ),

    r3:
      computeReturn(
        fillPrice,
        b3,
      ),

    r5:
      computeReturn(
        fillPrice,
        b5,
      ),
  };

  observation.maturity = {
    r1:
      Boolean(
        b1,
      ),

    r3:
      Boolean(
        b3,
      ),

    r5:
      Boolean(
        b5,
      ),

    latestAvailableTradingDate:
      bars.at(-1)
        ?.date ??
      null,

    refreshedAt:
      new Date()
        .toISOString(),
  };

  return {
    bars,
    observation,
  };
}

export async function runTrueForwardEntryCollector(
  now:
    Date = new Date(),
) {
  validateFrozenContract();

  if (
    !fs.existsSync(
      FORWARD_TOP1_FILE,
    )
  ) {
    throw new Error(
      "FORWARD_TOP1_FILE_NOT_FOUND",
    );
  }

  const forward =
    readJson(
      FORWARD_TOP1_FILE,
    );

  const sessions =
    Array.isArray(
      forward.sessions,
    )
      ? forward.sessions
      : [];

  const dataset =
    readObservationDataset();

  const byKey =
    new Map(
      dataset.observations.map(
        (row: any) => [
          `${row.sourceTradingDate}|${row.targetSessionDate}|${row.stockCode}`,
          row,
        ],
      ),
    );

  let labelsUpdated =
    0;

  for (
    const observation of
      dataset.observations
  ) {
    const before =
      JSON.stringify({
        direct:
          observation.correctedEntry
            ?.directReturns ??
          null,

        policy:
          observation.selectedPolicy
            ?.returns ??
          null,

        maturity:
          observation.maturity ??
          null,
      });

    await enrichMaturedLabels(
      observation,
    );

    const after =
      JSON.stringify({
        direct:
          observation.correctedEntry
            ?.directReturns ??
          null,

        policy:
          observation.selectedPolicy
            ?.returns ??
          null,

        maturity:
          observation.maturity ??
          null,
      });

    if (
      before !==
      after
    ) {
      labelsUpdated +=
        1;
    }
  }

  const eligible =
    sessions
      .filter(
        (session: any) =>
          session.frozen ===
            true &&
          String(
            session.sourceTradingDate,
          ) >
            HISTORICAL_CUTOFF &&
          targetSessionReadyForEntryCollection(
            String(
              session.targetSessionDate,
            ),
            now,
          ),
      )
      .filter(
        (session: any) => {
          const key =
            `${session.sourceTradingDate}|${session.targetSessionDate}|${session.top1?.stockCode}`;

          return !byKey.has(
            key,
          );
        },
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

  const maxSessions =
    Math.max(
      1,
      Math.min(
        5,
        Number(
          process.env.FORWARD_OOS_COLLECT_MAX_SESSIONS ??
          3,
        ) ||
        3,
      ),
    );

  const batch =
    eligible.slice(
      0,
      maxSessions,
    );

  if (
    batch.length ===
    0
  ) {
    if (
      labelsUpdated >
      0
    ) {
      writeJsonAtomic(
        OBSERVATION_FILE,
        dataset,
      );
    }

    return {
      status:
        "ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_NO_ELIGIBLE_TARGET_SESSION",

      counts: {
        frozenCandidateSessions:
          sessions.length,

        observations:
          dataset.observations.length,

        labelsUpdated,

        eligibleUnobservedSessions:
          0,
      },

      kisRequests:
        0,

      outputFile:
        "logs/alpha-v3-entry-v3-forward-oos-observations.json",

      nextGate:
        sessions.length ===
        0
          ? "RUN_FORWARD_TOP1_PRODUCER_IN_CAPTURE_WINDOW"
          : "WAIT_FOR_TARGET_SESSION_CLOSE_OR_LABEL_MATURITY",

      safety: {
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        productionChanged:
          false,
        thresholdChanged:
          false,
      },
    };
  }

  const accessToken =
    await getKisAccessToken();

  let kisRequests =
    0;

  const completed:
    any[] =
    [];

  const deferred:
    any[] =
    [];

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

    const dailyBars =
      await readForwardDailyBars(
        stockCode,
        targetSessionDate,
      );

    const b1 =
      dailyBars[0];

    if (
      !b1 ||
      b1.date !==
        targetSessionDate ||
      b1.open ===
        null
    ) {
      deferred.push({
        sourceTradingDate:
          session.sourceTradingDate,

        targetSessionDate,

        stockCode,

        reason:
          "TARGET_DAILY_BAR_NOT_READY",
      });

      continue;
    }

    const minute =
      await fetchFullMinuteSession(
        stockCode,
        targetSessionDate,
        accessToken,
      );

    kisRequests +=
      minute.requestCount;

    const fullCoverage =
      minute.snapshots.length ===
        381 &&
      minute.earliestTime ===
        "090000" &&
      minute.latestTime ===
        "153000";

    if (
      !fullCoverage
    ) {
      deferred.push({
        sourceTradingDate:
          session.sourceTradingDate,

        targetSessionDate,

        stockCode,

        reason:
          "INCOMPLETE_381_MINUTE_COVERAGE",

        sourceRows:
          minute.snapshots.length,

        earliestTime:
          minute.earliestTime,

        latestTime:
          minute.latestTime,
      });

      continue;
    }

    const signal =
      firstQualified(
        minute.snapshots,
        FROZEN_ENTRY_THRESHOLD,
      );

    const sessionOpen =
      b1.open;

    let selectedPolicy:
      any = {
        maxPremium:
          FROZEN_PREMIUM_CAP,

        limitPrice:
          null,

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

    if (
      signal
    ) {
      const limitPrice =
        sessionOpen *
        (
          1 +
          FROZEN_PREMIUM_CAP
        );

      selectedPolicy = {
        maxPremium:
          FROZEN_PREMIUM_CAP,

        limitPrice,

        ...simulateLimitFill(
          minute.snapshots,
          signal.observedAt,
          limitPrice,
        ),

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

    const observation = {
      sourceTradingDate:
        String(
          session.sourceTradingDate,
        ),

      targetSessionDate,

      stockCode,

      stockName:
        session.top1.stockName,

      candidateCapturedAt:
        session.capturedAt,

      sourceDataCutoffAtCollection:
        session.sourceDataCutoffAtCollection,

      alphaV2EffectiveScore:
        session.top1.effectiveScore,

      alphaV2RawPriceVolumeScore:
        session.top1.rawPriceVolumeScore,

      frozenEntryScoreThreshold:
        FROZEN_ENTRY_THRESHOLD,

      frozenPremiumCap:
        FROZEN_PREMIUM_CAP,

      entryObservedAt:
        now.toISOString(),

      minuteCoverage: {
        sourceRows:
          minute.snapshots.length,

        earliestTime:
          minute.earliestTime,

        latestTime:
          minute.latestTime,

        fullCoverage:
          true,
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
                  null,
                r3:
                  null,
                r5:
                  null,
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

      selectedPolicy,

      maturity: {
        r1:
          false,
        r3:
          false,
        r5:
          false,
        latestAvailableTradingDate:
          null,
        refreshedAt:
          null,
      },

      immutableEvidence: {
        candidateFrozenBeforeTargetOpen:
          true,

        historicalCheckpointTouched:
          false,

        retuningAllowed:
          false,
      },
    };

    await enrichMaturedLabels(
      observation,
    );

    dataset.observations.push(
      observation,
    );

    byKey.set(
      `${observation.sourceTradingDate}|${observation.targetSessionDate}|${observation.stockCode}`,
      observation,
    );

    completed.push(
      observation,
    );

    writeJsonAtomic(
      OBSERVATION_FILE,
      dataset,
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

  writeJsonAtomic(
    OBSERVATION_FILE,
    dataset,
  );

  return {
    status:
      completed.length >
      0
        ? "ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_COLLECTION_COMPLETE"
        : "ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_COLLECTION_DEFERRED",

    counts: {
      frozenCandidateSessions:
        sessions.length,

      previousObservations:
        dataset.observations.length -
        completed.length,

      newlyObservedSessions:
        completed.length,

      deferredSessions:
        deferred.length,

      totalObservations:
        dataset.observations.length,

      labelsUpdated,
    },

    kisRequests,

    completed:
      completed.map(
        (row) => ({
          sourceTradingDate:
            row.sourceTradingDate,

          targetSessionDate:
            row.targetSessionDate,

          stockCode:
            row.stockCode,

          qualified:
            row.correctedEntry
              .qualified,

          filled:
            row.selectedPolicy
              .filled,

          maturity:
            row.maturity,
        }),
      ),

    deferred,

    outputFile:
      "logs/alpha-v3-entry-v3-forward-oos-observations.json",

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

      thresholdChanged:
        false,

      historicalCheckpointTouched:
        false,
    },

    nextGate:
      "RUN_TRUE_FORWARD_OOS_EVALUATOR_AND_CONTINUE_DAILY_COLLECTION",
  };
}

async function main() {
  const result =
    await runTrueForwardEntryCollector();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );
}

if (
  require.main ===
  module
) {
  main().catch(
    (error) => {
      console.error(
        JSON.stringify(
          {
            status:
              "ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_COLLECTOR_FAILED",

            error:
              error instanceof Error
                ? error.message
                : String(
                    error,
                  ),

            safety: {
              databaseWrites:
                0,

              ordersCreated:
                0,

              positionsChanged:
                0,

              productionChanged:
                false,

              historicalCheckpointTouched:
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
}
