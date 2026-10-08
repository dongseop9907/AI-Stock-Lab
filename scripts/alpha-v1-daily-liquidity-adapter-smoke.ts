import {
  buildDailyLiquidityEvidence,
  type DailyAlphaBarLike,
} from "../lib/alpha/daily-market-adapters";

function makeRows(): DailyAlphaBarLike[] {
  const rows: DailyAlphaBarLike[] = [];

  for (let day = 1; day <= 20; day += 1) {
    const d =
      `2026-09-${String(day).padStart(2, "0")}`;

    rows.push(
      {
        stock_code: "005930",
        trading_date: d,
        open_price: 100,
        high_price: 101,
        low_price: 99,
        close_price: 100,
        volume: 1_000_000,
        trading_value: 100_000_000,
        adjusted_price: true,
      },
      {
        stock_code: "035420",
        trading_date: d,
        open_price: 100,
        high_price: 101,
        low_price: 99,
        close_price: 100,
        volume: 400_000,
        trading_value: 40_000_000,
        adjusted_price: true,
      },
      {
        stock_code: "035720",
        trading_date: d,
        open_price: 100,
        high_price: 101,
        low_price: 99,
        close_price: 100,
        volume: 100_000,
        trading_value: 10_000_000,
        adjusted_price: true,
      },
    );
  }

  // Must be ignored as lookahead.
  rows.push({
    stock_code: "035720",
    trading_date: "2026-10-02",
    open_price: 100,
    high_price: 101,
    low_price: 99,
    close_price: 100,
    volume: 999_999_999,
    trading_value: 999_999_999_999,
    adjusted_price: true,
  });

  return rows;
}

const decisionAt =
  "2026-10-01T00:00:00.000Z";

const rows =
  makeRows();

const high =
  buildDailyLiquidityEvidence({
    stockCode: "005930",
    decisionAt,
    rows,
  });

const medium =
  buildDailyLiquidityEvidence({
    stockCode: "035420",
    decisionAt,
    rows,
  });

const low =
  buildDailyLiquidityEvidence({
    stockCode: "035720",
    decisionAt,
    rows,
  });

const pass =
  Boolean(
    high &&
    medium &&
    low &&
    high.score >
      medium.score &&
    medium.score >
      low.score &&
    low.metadata?.latestTradingValue ===
      10_000_000 &&
    new Date(
      high.availableAt,
    ).getTime() <=
      new Date(
        decisionAt,
      ).getTime(),
  );

console.log(
  JSON.stringify(
    {
      status:
        pass
          ? "ALPHA_V1_DAILY_LIQUIDITY_ADAPTER_SMOKE_PASS"
          : "ALPHA_V1_DAILY_LIQUIDITY_ADAPTER_SMOKE_FAIL",
      scores: {
        high:
          high?.score ?? null,
        medium:
          medium?.score ?? null,
        low:
          low?.score ?? null,
      },
      noLookahead:
        low?.metadata?.latestTradingValue ===
        10_000_000,
      source:
        high?.source ?? null,
      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkRequests: 0,
        ordersCreated: 0,
      },
      nextGate:
        pass
          ? "BIND_DAILY_LIQUIDITY_TO_ALPHA_REPLAY"
          : "REPAIR_DAILY_LIQUIDITY_ADAPTER",
    },
    null,
    2,
  ),
);

if (!pass) {
  process.exitCode = 2;
}
