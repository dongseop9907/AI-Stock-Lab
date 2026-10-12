const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const FILES = {
  krx: path.join(
    ROOT,
    "lib",
    "trading",
    "krx-trading-calendar.ts"
  ),

  adapter: path.join(
    ROOT,
    "lib",
    "trading",
    "resolve-paper-execution-realism-v2-orderbook-quote.ts"
  ),

  buy: path.join(
    ROOT,
    "lib",
    "trading",
    "execute-paper-order.ts"
  ),

  sell: path.join(
    ROOT,
    "lib",
    "trading",
    "resolve-protective-sell-execution-realism-v2.ts"
  ),
};

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups",
  "paper-orderbook-krx-session-freshness-v1"
);

function die(code, detail) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_ORDERBOOK_KRX_SESSION_FRESHNESS_V1_PATCH_FAILED",
        code,
        detail,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
  throw new Error(`${code}:${detail}`);
}

function read(file) {
  if (!fs.existsSync(file)) {
    die(
      "TARGET_NOT_FOUND",
      path.relative(ROOT, file)
    );
  }

  return fs.readFileSync(
    file,
    "utf8"
  );
}

function backup(file, text) {
  fs.mkdirSync(
    BACKUP_DIR,
    {
      recursive: true,
    }
  );

  const rel = path.relative(
    ROOT,
    file
  );

  const out = path.join(
    BACKUP_DIR,
    rel.replace(/[\\/]/g, "__")
  );

  if (!fs.existsSync(out)) {
    fs.writeFileSync(
      out,
      text,
      "utf8"
    );
  }
}

function replaceOnce(
  text,
  before,
  after,
  label
) {
  const first =
    text.indexOf(before);

  if (first < 0) {
    die(
      "ANCHOR_NOT_FOUND",
      label
    );
  }

  const second =
    text.indexOf(
      before,
      first + before.length
    );

  if (second >= 0) {
    die(
      "ANCHOR_NOT_UNIQUE",
      label
    );
  }

  return (
    text.slice(0, first) +
    after +
    text.slice(first + before.length)
  );
}

function writeChanged(file, before, after) {
  if (before === after) {
    return false;
  }

  backup(
    file,
    before
  );

  fs.writeFileSync(
    file,
    after,
    "utf8"
  );

  return true;
}

const changed = [];

//
// 1. Canonical KRX regular-session helper
//
{
  const file = FILES.krx;
  const before = read(file);
  let after = before;

  const marker =
    "export function resolveKrxRegularTradingSessionState(";

  if (!after.includes(marker)) {
    const anchor =
      "export function getBuiltInVerifiedKrxOverrides():";

    const insertion = `export const KRX_REGULAR_SESSION_VERSION =
  "KRX_REGULAR_SESSION_V1_0900_1530" as const;

export type KrxRegularTradingSessionReason =
  | "OPEN"
  | "NON_TRADING_DATE"
  | "PRE_OPEN"
  | "AFTER_CLOSE";

export type KrxRegularTradingSessionState = {
  version:
    typeof KRX_REGULAR_SESSION_VERSION;
  timeZone:
    typeof KRX_TIME_ZONE;
  date: string;
  hour: number;
  minute: number;
  isTradingDate: boolean;
  isRegularSession: boolean;
  reason:
    KrxRegularTradingSessionReason;
  opensAtKst: "09:00";
  closesAtKst: "15:30";
};

export function resolveKrxRegularTradingSessionState(
  now: Date = new Date(),
): KrxRegularTradingSessionState {
  const clock =
    kstClock(
      now,
    );

  const isTradingDate =
    isKrxTradingDate(
      clock.date,
    );

  const minuteOfDay =
    clock.hour * 60 +
    clock.minute;

  const openMinute =
    9 * 60;

  const closeMinute =
    15 * 60 + 30;

  let reason:
    KrxRegularTradingSessionReason =
      "OPEN";

  if (!isTradingDate) {
    reason =
      "NON_TRADING_DATE";
  }
  else if (
    minuteOfDay <
    openMinute
  ) {
    reason =
      "PRE_OPEN";
  }
  else if (
    minuteOfDay >=
    closeMinute
  ) {
    reason =
      "AFTER_CLOSE";
  }

  return {
    version:
      KRX_REGULAR_SESSION_VERSION,
    timeZone:
      KRX_TIME_ZONE,
    date:
      clock.date,
    hour:
      clock.hour,
    minute:
      clock.minute,
    isTradingDate,
    isRegularSession:
      reason ===
      "OPEN",
    reason,
    opensAtKst:
      "09:00",
    closesAtKst:
      "15:30",
  };
}

`;

    after = replaceOnce(
      after,
      anchor,
      insertion + anchor,
      "krx_regular_session_insert"
    );
  }

  if (
    writeChanged(
      file,
      before,
      after
    )
  ) {
    changed.push(
      path.relative(ROOT, file)
    );
  }
}

//
// 2. Orderbook adapter: session + server-time freshness
//
{
  const file = FILES.adapter;
  const before = read(file);
  let after = before;

  const importMarker =
    'from "@/lib/trading/krx-trading-calendar";';

  if (!after.includes(importMarker)) {
    const anchor =
      'import type {\n  PaperQuoteSnapshot,\n} from "@/lib/trading/paper-execution-realism-v2";';

    const block = `${anchor}

import {
  KRX_TIME_ZONE,
  resolveKrxRegularTradingSessionState,
  type KrxRegularTradingSessionState,
} from "@/lib/trading/krx-trading-calendar";`;

    after = replaceOnce(
      after,
      anchor,
      block,
      "adapter_krx_import"
    );
  }

  if (
    !after.includes(
      '"KRX_SESSION_CLOSED"'
    )
  ) {
    after = replaceOnce(
      after,
      '  | "KIS_ORDERBOOK_READ_FAILED";',
      `  | "KIS_ORDERBOOK_READ_FAILED"
  | "KRX_SESSION_CLOSED"
  | "KIS_ORDERBOOK_SERVER_TIME_UNAVAILABLE"
  | "KIS_ORDERBOOK_STALE";`,
      "adapter_source_union"
    );
  }

  if (
    !after.includes(
      "freshnessBlocker:"
    )
  ) {
    after = replaceOnce(
      after,
      `  error:
    | string
    | null;
}`,
      `  error:
    | string
    | null;

  session:
    KrxRegularTradingSessionState;

  freshnessBlocker:
    | "KRX_SESSION_CLOSED"
    | "KIS_ORDERBOOK_SERVER_TIME_UNAVAILABLE"
    | "KIS_ORDERBOOK_STALE"
    | null;

  serverAcceptedHour:
    | string
    | null;

  serverQuoteAgeMs:
    | number
    | null;
}`,
      "adapter_result_shape"
    );
  }

  if (
    !after.includes(
      "PAPER_ORDERBOOK_MAX_SERVER_AGE_MS"
    )
  ) {
    const anchor =
      "function toPositiveNumber(";

    const helper = `export const PAPER_ORDERBOOK_MAX_SERVER_AGE_MS =
  30_000 as const;

function normalizeNow(
  now:
    | string
    | Date
    | undefined,
): Date {
  const parsed =
    now instanceof Date
      ? new Date(
          now.getTime(),
        )
      : now
        ? new Date(
            now,
          )
        : new Date();

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    throw new Error(
      "INVALID_PAPER_ORDERBOOK_NOW",
    );
  }

  return parsed;
}

function kstSecondsOfDay(
  now: Date,
): number {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          KRX_TIME_ZONE,
        hour:
          "2-digit",
        minute:
          "2-digit",
        second:
          "2-digit",
        hourCycle:
          "h23",
      },
    ).formatToParts(
      now,
    );

  const values =
    new Map(
      parts.map(
        part => [
          part.type,
          part.value,
        ],
      ),
    );

  const hour =
    Number(
      values.get(
        "hour",
      ),
    );

  const minute =
    Number(
      values.get(
        "minute",
      ),
    );

  const second =
    Number(
      values.get(
        "second",
      ),
    );

  if (
    !Number.isFinite(
      hour,
    ) ||
    !Number.isFinite(
      minute,
    ) ||
    !Number.isFinite(
      second,
    )
  ) {
    throw new Error(
      "PAPER_ORDERBOOK_KST_CLOCK_UNAVAILABLE",
    );
  }

  return (
    hour * 3600 +
    minute * 60 +
    second
  );
}

function parseServerAcceptedHourSeconds(
  value: unknown,
): number | null {
  const raw =
    String(
      value ?? "",
    )
      .trim()
      .replace(
        /[^0-9]/g,
        "",
      );

  if (
    !/^\\d{6}$/.test(
      raw,
    )
  ) {
    return null;
  }

  const hour =
    Number(
      raw.slice(
        0,
        2,
      ),
    );

  const minute =
    Number(
      raw.slice(
        2,
        4,
      ),
    );

  const second =
    Number(
      raw.slice(
        4,
        6,
      ),
    );

  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  return (
    hour * 3600 +
    minute * 60 +
    second
  );
}

export function resolvePaperOrderbookServerQuoteAgeMs(
  input: {
    now:
      | string
      | Date;
    serverAcceptedHour:
      unknown;
  },
): number | null {
  const now =
    normalizeNow(
      input.now,
    );

  const serverSeconds =
    parseServerAcceptedHourSeconds(
      input.serverAcceptedHour,
    );

  if (
    serverSeconds ===
    null
  ) {
    return null;
  }

  return (
    Math.abs(
      kstSecondsOfDay(
        now,
      ) -
        serverSeconds,
    ) *
    1000
  );
}

`;

    after = replaceOnce(
      after,
      anchor,
      helper + anchor,
      "adapter_freshness_helpers"
    );
  }

  if (
    !after.includes(
      "now?:"
    ) ||
    !after.includes(
      "PAPER_ORDERBOOK_SESSION_GATE"
    )
  ) {
    after = replaceOnce(
      after,
      `  input: {
    stockCode: string;
  },`,
      `  input: {
    stockCode: string;
    now?:
      | string
      | Date;
  },`,
      "adapter_input_now"
    );

    after = replaceOnce(
      after,
      `): Promise<PaperExecutionOrderbookQuoteResult> {
  try {`,
      `): Promise<PaperExecutionOrderbookQuoteResult> {
  const now =
    normalizeNow(
      input.now,
    );

  const session =
    resolveKrxRegularTradingSessionState(
      now,
    );

  if (
    !session.isRegularSession
  ) {
    return {
      quote:
        null,
      source:
        "KRX_SESSION_CLOSED",
      error:
        \`PAPER_ORDERBOOK_SESSION_GATE:\${session.reason}\`,
      session,
      freshnessBlocker:
        "KRX_SESSION_CLOSED",
      serverAcceptedHour:
        null,
      serverQuoteAgeMs:
        null,
    };
  }

  try {`,
      "adapter_session_gate"
    );

    after = replaceOnce(
      after,
      `    const observedAt =
      new Date().toISOString();

    const quote =`,
      `    const observedAt =
      now.toISOString();

    const serverAcceptedHour =
      String(
        (
          response.output1 as
            unknown as
            Record<
              string,
              unknown
            >
        )?.aspr_acpt_hour ??
          "",
      ).trim() ||
      null;

    const serverQuoteAgeMs =
      resolvePaperOrderbookServerQuoteAgeMs({
        now,
        serverAcceptedHour,
      });

    if (
      serverQuoteAgeMs ===
      null
    ) {
      return {
        quote:
          null,
        source:
          "KIS_ORDERBOOK_SERVER_TIME_UNAVAILABLE",
        error:
          "KIS_ORDERBOOK_SERVER_TIME_UNAVAILABLE",
        session,
        freshnessBlocker:
          "KIS_ORDERBOOK_SERVER_TIME_UNAVAILABLE",
        serverAcceptedHour,
        serverQuoteAgeMs:
          null,
      };
    }

    if (
      serverQuoteAgeMs >
      PAPER_ORDERBOOK_MAX_SERVER_AGE_MS
    ) {
      return {
        quote:
          null,
        source:
          "KIS_ORDERBOOK_STALE",
        error:
          \`KIS_ORDERBOOK_STALE:\${serverQuoteAgeMs}\`,
        session,
        freshnessBlocker:
          "KIS_ORDERBOOK_STALE",
        serverAcceptedHour,
        serverQuoteAgeMs,
      };
    }

    const quote =`,
      "adapter_server_freshness"
    );

    after = replaceOnce(
      after,
      `        error:
          null,
      };`,
      `        error:
          null,
        session,
        freshnessBlocker:
          null,
        serverAcceptedHour,
        serverQuoteAgeMs,
      };`,
      "adapter_empty_return"
    );

    after = replaceOnce(
      after,
      `      error:
        null,
    };`,
      `      error:
        null,
      session,
      freshnessBlocker:
        null,
      serverAcceptedHour,
      serverQuoteAgeMs,
    };`,
      "adapter_success_return"
    );

    after = replaceOnce(
      after,
      `      error:
        String(
          error instanceof
            Error
            ? error.message
            : error,
        ),
    };`,
      `      error:
        String(
          error instanceof
            Error
            ? error.message
            : error,
        ),
      session,
      freshnessBlocker:
        null,
      serverAcceptedHour:
        null,
      serverQuoteAgeMs:
        null,
    };`,
      "adapter_catch_return"
    );

    after = after.replace(
      /PAPER_ORDERBOOK_SESSION_GATE/g,
      "PAPER_ORDERBOOK_SESSION_GATE"
    );
  }

  if (
    writeChanged(
      file,
      before,
      after
    )
  ) {
    changed.push(
      path.relative(ROOT, file)
    );
  }
}

//
// 3. BUY: reuse existing safe failure transition
//
{
  const file = FILES.buy;
  const before = read(file);
  let after = before;

  const marker =
    "PAPER_EXECUTION_ORDERBOOK_FRESHNESS_BLOCKED";

  if (!after.includes(marker)) {
    const anchor = `  const realismDecision =
    evaluatePaperExecutionRealismV2({`;

    const insertion = `  if (
    orderbookQuote.freshnessBlocker
  ) {
    const failedOrder =
      await failUnsafePaperBuyExecution({
        orderId:
          order.id,

        executionPrice:
          safeExecution.executionPrice,

        executionObservedAt:
          safeExecution.executionPriceObservedAt,

        reason:
          \`PAPER_EXECUTION_ORDERBOOK_FRESHNESS_BLOCKED:\${orderbookQuote.freshnessBlocker}\`,

        riskSnapshot: {
          safeExecution,
          orderbookQuote,
        },
      });

    return {
      status:
        "PAPER_BUY_EXECUTION_BLOCKED",

      orderId:
        order.id,

      stockCode:
        order.stock_code,

      execution:
        safeExecution,

      orderbookQuote,

      order:
        failedOrder,
    };
  }

`;

    after = replaceOnce(
      after,
      anchor,
      insertion + anchor,
      "buy_freshness_block"
    );
  }

  if (
    writeChanged(
      file,
      before,
      after
    )
  ) {
    changed.push(
      path.relative(ROOT, file)
    );
  }
}

//
// 4. Protective SELL: session/freshness blockers are not fail-open liquidity cases
//
{
  const file = FILES.sell;
  const before = read(file);
  let after = before;

  const marker =
    "PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED";

  if (!after.includes(marker)) {
    const anchor = `  let decision =
    evaluatePaperExecutionRealismV2({`;

    const insertion = `  if (
    orderbookQuote.freshnessBlocker
  ) {
    throw new Error(
      \`PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED:\${orderbookQuote.freshnessBlocker}\`,
    );
  }

`;

    after = replaceOnce(
      after,
      anchor,
      insertion + anchor,
      "sell_freshness_block"
    );
  }

  if (
    writeChanged(
      file,
      before,
      after
    )
  ) {
    changed.push(
      path.relative(ROOT, file)
    );
  }
}

const post = {
  krx:
    read(FILES.krx),
  adapter:
    read(FILES.adapter),
  buy:
    read(FILES.buy),
  sell:
    read(FILES.sell),
};

const checks = {
  krxSessionHelper:
    post.krx.includes(
      "resolveKrxRegularTradingSessionState"
    ),

  sessionIsCanonical:
    post.adapter.includes(
      'from "@/lib/trading/krx-trading-calendar"'
    ) &&
    post.adapter.includes(
      "resolveKrxRegularTradingSessionState"
    ),

  adapterBlocksClosedSessionBeforeKisToken:
    post.adapter.indexOf(
      "KRX_SESSION_CLOSED"
    ) >= 0 &&
    post.adapter.indexOf(
      "KRX_SESSION_CLOSED"
    ) <
      post.adapter.indexOf(
        "getKisAccessToken()"
      ),

  serverAcceptedHourBound:
    post.adapter.includes(
      "aspr_acpt_hour"
    ),

  staleQuoteBlocker:
    post.adapter.includes(
      "KIS_ORDERBOOK_STALE"
    ),

  missingServerTimeBlocker:
    post.adapter.includes(
      "KIS_ORDERBOOK_SERVER_TIME_UNAVAILABLE"
    ),

  buyReusesSafeFailureTransition:
    post.buy.includes(
      "PAPER_EXECUTION_ORDERBOOK_FRESHNESS_BLOCKED"
    ) &&
    post.buy.includes(
      "failUnsafePaperBuyExecution"
    ),

  protectiveSellDoesNotFallbackFreshness:
    post.sell.includes(
      "PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED"
    ),

  noRealTradingEnable:
    !Object.values(post).some(
      text =>
        /REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
          text
        )
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_KRX_SESSION_FRESHNESS_V1_PATCHED"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_KRX_SESSION_FRESHNESS_V1_PATCH_REVIEW",

      changed,

      policy: {
        timeZone:
          "Asia/Seoul",
        regularSession:
          "09:00<=KST<15:30",
        serverQuoteMaxAgeMs:
          30000,
        closedSession:
          "FAIL_CLOSED",
        missingServerTime:
          "FAIL_CLOSED",
        staleServerTime:
          "FAIL_CLOSED",
        kisReadFailureDuringOpenSession:
          "EXISTING_SYNTHETIC_FALLBACK_PRESERVED",
        protectiveSellLiquidityFallback:
          "PRESERVED_EXCEPT_SESSION_OR_FRESHNESS_BLOCKERS",
      },

      checks,
      failed,

      safety: {
        databaseWritesByFixer:
          0,
        migrationsAdded:
          0,
        ordersCreatedByFixer:
          0,
        ordersExecutedByFixer:
          0,
        positionsChangedByFixer:
          0,
        syntheticTradesCreated:
          0,
        realTradingEnabled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "RUN_CONTRACT_STATIC_TSC"
          : "REVIEW_PATCH",
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
