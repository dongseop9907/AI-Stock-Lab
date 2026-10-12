import {
  getDomesticStockOrderbook,
  getKisAccessToken,
} from "../lib/kis/client";

import {
  buildPaperQuoteSnapshotFromKisOrderbook,
} from "../lib/trading/resolve-paper-execution-realism-v2-orderbook-quote";

const stockCode =
  process.argv[2]?.trim() ||
  "005930";

async function main() {
  const token =
    await getKisAccessToken();

  const startedAt =
    new Date();

  const response =
    await getDomesticStockOrderbook(
      stockCode,
      token,
    );

  const observedAt =
    new Date().toISOString();

  const quote =
    buildPaperQuoteSnapshotFromKisOrderbook(
      response.output1,
      observedAt,
    );

  const apiOk =
    response.rt_cd === undefined ||
    response.rt_cd === "0";

  const hasQuote =
    quote !== null;

  const checks = {
    apiReturned:
      true,

    apiOk,

    output1Present:
      response.output1 !==
      undefined,

    quoteBuildSafe:
      true,

    tokenNotPrinted:
      true,
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, ok]) =>
          ok !== true,
      )
      .map(
        ([name]) =>
          name,
      );

  const state =
    failed.length >
      0
      ? "FAIL"
      : hasQuote
        ? "LIVE_ORDERBOOK_QUOTE_AVAILABLE"
        : "NORMAL_WAIT_EMPTY_OR_NON_TRADING_ORDERBOOK";

  console.log(
    JSON.stringify(
      {
        status:
          failed.length ===
            0
            ? "AI_STOCK_LAB_KIS_ORDERBOOK_RUNTIME_READONLY_PROBE_PASS"
            : "AI_STOCK_LAB_KIS_ORDERBOOK_RUNTIME_READONLY_PROBE_FAIL",

        target: {
          stockCode,
        },

        api: {
          rtCd:
            response.rt_cd ??
            null,

          msgCd:
            response.msg_cd ??
            null,

          msg1:
            response.msg1 ??
            null,

          elapsedMs:
            Date.now() -
            startedAt.getTime(),
        },

        topOfBook: {
          raw: {
            askp1:
              response.output1?.askp1 ??
              null,

            bidp1:
              response.output1?.bidp1 ??
              null,

            askp_rsqn1:
              response.output1?.askp_rsqn1 ??
              null,

            bidp_rsqn1:
              response.output1?.bidp_rsqn1 ??
              null,
          },

          normalized:
            quote,
        },

        interpretation: {
          state,

          quoteAvailable:
            hasQuote,

          ifQuoteAvailable:
            "PAPER BUY/SELL can consume real KIS top-of-book through the new binding.",

          ifEmpty:
            "Do not treat an empty top-of-book alone as a code failure. Recheck during a trading session before concluding the adapter is broken.",

          syntheticFallbackRequired:
            !hasQuote,
        },

        safety: {
          readOnlyKisCall:
            true,

          kisAccessTokenPrinted:
            false,

          databaseReads:
            0,

          databaseWrites:
            0,

          paperOrdersCreated:
            0,

          paperOrdersExecuted:
            0,

          positionsChanged:
            0,

          promotionExecuted:
            false,

          realTradingEnabled:
            false,
        },

        checks,
        failed,

        nextGate:
          failed.length ===
            0
            ? hasQuote
              ? "PAPER_ORDERBOOK_RUNTIME_V1_COMPLETE"
              : "RECHECK_ORDERBOOK_DURING_TRADING_SESSION"
            : "REVIEW_KIS_ORDERBOOK_RUNTIME_FAILURE",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length ===
      0
      ? 0
      : 1;
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_KIS_ORDERBOOK_RUNTIME_READONLY_PROBE_FAIL",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          safety: {
            readOnlyKisCall:
              true,

            kisAccessTokenPrinted:
              false,

            databaseReads:
              0,

            databaseWrites:
              0,

            paperOrdersCreated:
              0,

            paperOrdersExecuted:
              0,

            positionsChanged:
              0,

            promotionExecuted:
              false,

            realTradingEnabled:
              false,
          },

          nextGate:
            "REVIEW_KIS_ORDERBOOK_RUNTIME_FAILURE",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
