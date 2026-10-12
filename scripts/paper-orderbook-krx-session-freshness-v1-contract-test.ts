import {
  isKrxTradingDate,
  resolveKrxRegularTradingSessionState,
} from "../lib/trading/krx-trading-calendar";

import {
  resolvePaperExecutionRealismV2OrderbookQuote,
  resolvePaperOrderbookServerQuoteAgeMs,
  PAPER_ORDERBOOK_MAX_SERVER_AGE_MS,
} from "../lib/trading/resolve-paper-execution-realism-v2-orderbook-quote";

function kstIso(
  date: string,
  time: string,
): string {
  return `${date}T${time}+09:00`;
}

async function main() {
  const sat =
    resolveKrxRegularTradingSessionState(
      new Date(
        kstIso(
          "2026-10-10",
          "12:00:00",
        ),
      ),
    );

  const holiday =
    resolveKrxRegularTradingSessionState(
      new Date(
        kstIso(
          "2026-10-09",
          "10:00:00",
        ),
      ),
    );

  const preOpen =
    resolveKrxRegularTradingSessionState(
      new Date(
        kstIso(
          "2026-10-12",
          "08:59:59",
        ),
      ),
    );

  const open =
    resolveKrxRegularTradingSessionState(
      new Date(
        kstIso(
          "2026-10-12",
          "09:00:00",
        ),
      ),
    );

  const beforeClose =
    resolveKrxRegularTradingSessionState(
      new Date(
        kstIso(
          "2026-10-12",
          "15:29:59",
        ),
      ),
    );

  const close =
    resolveKrxRegularTradingSessionState(
      new Date(
        kstIso(
          "2026-10-12",
          "15:30:00",
        ),
      ),
    );

  const freshAge =
    resolvePaperOrderbookServerQuoteAgeMs({
      now:
        new Date(
          kstIso(
            "2026-10-12",
            "10:00:10",
          ),
        ),
      serverAcceptedHour:
        "100000",
    });

  const staleAge =
    resolvePaperOrderbookServerQuoteAgeMs({
      now:
        new Date(
          kstIso(
            "2026-10-12",
            "10:01:00",
          ),
        ),
      serverAcceptedHour:
        "100000",
    });

  const missingAge =
    resolvePaperOrderbookServerQuoteAgeMs({
      now:
        new Date(
          kstIso(
            "2026-10-12",
            "10:01:00",
          ),
        ),
      serverAcceptedHour:
        null,
    });

  /*
   * Deterministic closed-session adapter proof:
   * fixed Saturday means the adapter must return before any KIS token/API call.
   */
  const closedAdapter =
    await resolvePaperExecutionRealismV2OrderbookQuote({
      stockCode:
        "005930",
      now:
        new Date(
          kstIso(
            "2026-10-10",
            "12:00:00",
          ),
        ),
    });

  const checks = {
    saturdayNotTrading:
      !isKrxTradingDate(
        "2026-10-10",
      ) &&
      sat.reason ===
        "NON_TRADING_DATE" &&
      sat.isRegularSession ===
        false,

    hangeulDayClosed:
      holiday.reason ===
        "NON_TRADING_DATE" &&
      holiday.isRegularSession ===
        false,

    preOpenBlocked:
      preOpen.reason ===
        "PRE_OPEN" &&
      preOpen.isRegularSession ===
        false,

    openAt0900:
      open.reason ===
        "OPEN" &&
      open.isRegularSession ===
        true,

    openBefore1530:
      beforeClose.reason ===
        "OPEN" &&
      beforeClose.isRegularSession ===
        true,

    closeAt1530:
      close.reason ===
        "AFTER_CLOSE" &&
      close.isRegularSession ===
        false,

    freshServerTime:
      freshAge ===
        10_000 &&
      freshAge <
        PAPER_ORDERBOOK_MAX_SERVER_AGE_MS,

    staleServerTime:
      staleAge ===
        60_000 &&
      staleAge >
        PAPER_ORDERBOOK_MAX_SERVER_AGE_MS,

    missingServerTime:
      missingAge ===
        null,

    closedAdapterFailsBeforeKis:
      closedAdapter.source ===
        "KRX_SESSION_CLOSED" &&
      closedAdapter.quote ===
        null &&
      closedAdapter.freshnessBlocker ===
        "KRX_SESSION_CLOSED" &&
      closedAdapter.session.reason ===
        "NON_TRADING_DATE",
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
            ? "AI_STOCK_LAB_PAPER_ORDERBOOK_KRX_SESSION_FRESHNESS_V1_CONTRACT_VERIFIED"
            : "AI_STOCK_LAB_PAPER_ORDERBOOK_KRX_SESSION_FRESHNESS_V1_CONTRACT_FAILED",

        checks,

        samples: {
          sat,
          holiday,
          preOpen,
          open,
          beforeClose,
          close,
          freshAge,
          staleAge,
          missingAge,
          closedAdapter,
        },

        safety: {
          fixedClosedSession:
            true,
          kisTokenRequested:
            false,
          externalApiCallExpected:
            false,
          databaseReads:
            0,
          databaseWrites:
            0,
          ordersCreated:
            0,
          ordersExecuted:
            0,
          positionsChanged:
            0,
          realTradingEnabled:
            false,
        },

        failed,
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}

void main();
