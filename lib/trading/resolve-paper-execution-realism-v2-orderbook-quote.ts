import {
  getDomesticStockOrderbook,
  getKisAccessToken,
  type KisDomesticOrderbookOutput,
} from "@/lib/kis/client";

import type {
  PaperQuoteSnapshot,
} from "@/lib/trading/paper-execution-realism-v2";

import {
  KRX_TIME_ZONE,
  resolveKrxRegularTradingSessionState,
  type KrxRegularTradingSessionState,
} from "@/lib/trading/krx-trading-calendar";

export type PaperExecutionOrderbookQuoteSource =
  | "KIS_DOMESTIC_ORDERBOOK_REST"
  | "KIS_ORDERBOOK_EMPTY"
  | "KIS_ORDERBOOK_READ_FAILED"
  | "KRX_SESSION_CLOSED"
  | "KIS_ORDERBOOK_SERVER_TIME_UNAVAILABLE"
  | "KIS_ORDERBOOK_STALE";

export interface PaperExecutionOrderbookQuoteResult {
  quote:
    | PaperQuoteSnapshot
    | null;

  source:
    PaperExecutionOrderbookQuoteSource;

  error:
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
}

export const PAPER_ORDERBOOK_MAX_SERVER_AGE_MS =
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
    !/^\d{6}$/.test(
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

function toPositiveNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(
      String(value)
        .replaceAll(
          ",",
          "",
        ),
    );

  return (
    Number.isFinite(
      parsed,
    ) &&
    parsed > 0
  )
    ? parsed
    : null;
}

function toNonNegativeInteger(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(
      String(value)
        .replaceAll(
          ",",
          "",
        ),
    );

  return (
    Number.isFinite(
      parsed,
    ) &&
    parsed >= 0
  )
    ? Math.floor(
        parsed,
      )
    : null;
}

export function buildPaperQuoteSnapshotFromKisOrderbook(
  output:
    | KisDomesticOrderbookOutput
    | null
    | undefined,
  observedAt:
    string | Date,
): PaperQuoteSnapshot | null {
  if (
    !output
  ) {
    return null;
  }

  const bestAskPrice =
    toPositiveNumber(
      output.askp1,
    );

  const bestBidPrice =
    toPositiveNumber(
      output.bidp1,
    );

  if (
    bestAskPrice === null &&
    bestBidPrice === null
  ) {
    return null;
  }

  return {
    observedAt,

    bestAskPrice,
    bestBidPrice,

    bestAskQuantity:
      toNonNegativeInteger(
        output.askp_rsqn1,
      ),

    bestBidQuantity:
      toNonNegativeInteger(
        output.bidp_rsqn1,
      ),
  };
}

export async function resolvePaperExecutionRealismV2OrderbookQuote(
  input: {
    stockCode: string;
    now?:
      | string
      | Date;
  },
): Promise<PaperExecutionOrderbookQuoteResult> {
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
        `PAPER_ORDERBOOK_SESSION_GATE:${session.reason}`,
      session,
      freshnessBlocker:
        "KRX_SESSION_CLOSED",
      serverAcceptedHour:
        null,
      serverQuoteAgeMs:
        null,
    };
  }

  try {
    const accessToken =
      await getKisAccessToken();

    const response =
      await getDomesticStockOrderbook(
        input.stockCode,
        accessToken,
      );

    const observedAt =
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
          `KIS_ORDERBOOK_STALE:${serverQuoteAgeMs}`,
        session,
        freshnessBlocker:
          "KIS_ORDERBOOK_STALE",
        serverAcceptedHour,
        serverQuoteAgeMs,
      };
    }

    const quote =
      buildPaperQuoteSnapshotFromKisOrderbook(
        response.output1,
        observedAt,
      );

    if (
      !quote
    ) {
      return {
        quote:
          null,
        source:
          "KIS_ORDERBOOK_EMPTY",
        error:
          null,
        session,
        freshnessBlocker:
          null,
        serverAcceptedHour,
        serverQuoteAgeMs,
      };
    }

    return {
      quote,
      source:
        "KIS_DOMESTIC_ORDERBOOK_REST",
      error:
        null,
      session,
      freshnessBlocker:
        null,
      serverAcceptedHour,
      serverQuoteAgeMs,
    };
  }
  catch (
    error
  ) {
    return {
      quote:
        null,
      source:
        "KIS_ORDERBOOK_READ_FAILED",
      error:
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
    };
  }
}
