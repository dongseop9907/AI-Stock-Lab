import { createSupabaseServerClient } from "@/lib/supabase";

interface RunDailyBacktestInput {
  startDate?: string;
  endDate?: string;
  stockCodes?: string[];

  initialCash?: number;

  entryThreshold?: number;
  stopDistanceRate?: number;

  feeRate?: number;
  taxRate?: number;
  slippageRate?: number;

  maxPositions?: number;
  maxPositionRate?: number;

  maxHoldingDays?: number;
}

interface DailyBarRecord {
  stock_code: string;
  trading_date: string;

  open_price: number | string;
  high_price: number | string;
  low_price: number | string;
  close_price: number | string;

  volume: number | string | null;
}

interface DailySignal {
  stockCode: string;
  signalDate: string;

  score: number;

  momentumRate: number;
  intradayRate: number;
  rangePosition: number;
  volumeRatio: number;

  stopReferencePrice: number;
}

interface PendingEntry {
  signal: DailySignal;
}

interface PendingExit {
  reason: "MAX_HOLDING_DAYS";
}

interface OpenPosition {
  stockCode: string;

  signalDate: string;
  signalScore: number;

  entryDate: string;

  quantity: number;

  entryPriceRaw: number;
  entryPriceExec: number;

  initialStopPrice: number;

  buyFee: number;
  entryCost: number;

  holdingBars: number;
}

interface BacktestTradeInsert {
  stock_code: string;

  signal_at: string;
  entry_at: string;
  exit_at: string;

  quantity: number;

  signal_score: number;

  prediction_score: null;
  prediction_confidence: null;

  entry_price_raw: number;
  entry_price_exec: number;

  initial_stop_price: number;

  exit_price_raw: number;
  exit_price_exec: number;

  exit_reason: string;

  gross_pnl: number;

  buy_fee: number;
  sell_fee: number;
  tax_amount: number;

  slippage_cost: number;

  net_pnl: number;
  net_return: number;

  holding_minutes: number;

  metadata: Record<string, unknown>;
}

interface EquityPointInsert {
  observed_at: string;

  cash: number;
  market_value: number;
  equity: number;

  peak_equity: number;
  drawdown: number;

  open_position_count: number;

  positions: Array<{
    stockCode: string;
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    holdingBars: number;
  }>;
}

const ONE_DAY_MINUTES =
  24 * 60;

function clamp(
  value: number,
  minimum = 0,
  maximum = 1,
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}

function round(
  value: number,
  digits = 6,
): number {
  const multiplier =
    10 ** digits;

  return (
    Math.round(
      value * multiplier,
    ) / multiplier
  );
}

function toNumber(
  value:
    | number
    | string
    | null
    | undefined,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function normalizeStockCodes(
  values:
    | string[]
    | undefined,
): string[] {
  if (!values) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) =>
          value.trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function normalizeDate(
  value: string,
): string {
  const trimmed =
    value.trim();

  if (
    /^\d{8}$/.test(
      trimmed,
    )
  ) {
    return (
      `${trimmed.slice(0, 4)}-` +
      `${trimmed.slice(4, 6)}-` +
      `${trimmed.slice(6, 8)}`
    );
  }

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      trimmed,
    )
  ) {
    return trimmed;
  }

  throw new Error(
    `날짜는 YYYYMMDD 또는 YYYY-MM-DD 형식이어야 합니다: ${value}`,
  );
}

function dateToObservedAt(
  tradingDate: string,
): string {
  /*
   * 한국 정규장 종료 15:30 KST
   * = 06:30 UTC
   *
   * 일봉 자산곡선용 시각일 뿐
   * 실제 과거 데이터 수집 시각이 아니다.
   */
  return (
    `${tradingDate}` +
    "T06:30:00.000Z"
  );
}

function calculateSignal(
  history: DailyBarRecord[],
  entryThreshold: number,
  stopDistanceRate: number,
): DailySignal | null {
  const latest =
    history[
      history.length - 1
    ];

  if (!latest) {
    return null;
  }

  const latestClose =
    toNumber(
      latest.close_price,
    );

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

  const latestVolume =
    toNumber(
      latest.volume,
    ) ?? 0;

  if (
    latestClose === null ||
    latestOpen === null ||
    latestHigh === null ||
    latestLow === null ||
    latestClose <= 0 ||
    latestOpen <= 0 ||
    latestHigh <= 0 ||
    latestLow <= 0
  ) {
    return null;
  }

  const previous =
    history[
      history.length - 2
    ];

  const previousClose =
    toNumber(
      previous?.close_price,
    ) ??
    latestOpen;

  const momentumRate =
    previousClose > 0
      ? (
          latestClose -
          previousClose
        ) /
        previousClose
      : 0;

  const intradayRate =
    (
      latestClose -
      latestOpen
    ) /
    latestOpen;

  const rangePosition =
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

  const previousVolumes =
    history
      .slice(
        Math.max(
          0,
          history.length - 6,
        ),
        history.length - 1,
      )
      .map((bar) =>
        toNumber(
          bar.volume,
        ),
      )
      .filter(
        (
          value,
        ): value is number =>
          value !== null &&
          value > 0,
      );

  const averagePreviousVolume =
    previousVolumes.length > 0
      ? previousVolumes.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        previousVolumes.length
      : latestVolume;

  const volumeRatio =
    averagePreviousVolume > 0
      ? latestVolume /
        averagePreviousVolume
      : 1;

  /*
   * 현재 진입 타이밍 모델과 동일한 기본 가중치
   *
   * 가격 모멘텀 40%
   * 장중 강도 25%
   * 종가 위치 20%
   * 거래량 증가 15%
   */
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
    momentumScore * 0.4 +
    intradayScore * 0.25 +
    rangeScore * 0.2 +
    volumeScore * 0.15;

  const qualifies =
    score >=
      entryThreshold &&
    momentumRate > 0 &&
    intradayRate >
      -0.005;

  if (!qualifies) {
    return null;
  }

  return {
    stockCode:
      latest.stock_code,

    signalDate:
      latest.trading_date,

    score:
      round(
        score,
      ),

    momentumRate:
      round(
        momentumRate,
      ),

    intradayRate:
      round(
        intradayRate,
      ),

    rangePosition:
      round(
        rangePosition,
      ),

    volumeRatio:
      round(
        volumeRatio,
      ),

    stopReferencePrice:
      Math.floor(
        latestClose *
          (
            1 -
            stopDistanceRate
          ),
      ),
  };
}

async function loadDailyBars(
  startDate: string,
  endDate: string,
  stockCodes: string[],
): Promise<DailyBarRecord[]> {
  const supabase =
    createSupabaseServerClient();

  const pageSize =
    1000;

  let offset =
    0;

  const results:
    DailyBarRecord[] =
    [];

  while (true) {
    let query =
      supabase
        .from(
          "market_daily_bars",
        )
        .select(`
          stock_code,
          trading_date,
          open_price,
          high_price,
          low_price,
          close_price,
          volume
        `)
        .gte(
          "trading_date",
          startDate,
        )
        .lte(
          "trading_date",
          endDate,
        )
        .order(
          "trading_date",
          {
            ascending: true,
          },
        )
        .order(
          "stock_code",
          {
            ascending: true,
          },
        )
        .range(
          offset,
          offset +
            pageSize -
            1,
        );

    if (
      stockCodes.length >
      0
    ) {
      query =
        query.in(
          "stock_code",
          stockCodes,
        );
    }

    const {
      data,
      error,
    } =
      await query;

    if (error) {
      throw new Error(
        `과거 일봉 조회 실패: ${error.message}`,
      );
    }

    const page =
      (data ??
        []) as DailyBarRecord[];

    results.push(
      ...page,
    );

    if (
      page.length <
      pageSize
    ) {
      break;
    }

    offset +=
      pageSize;
  }

  return results;
}

function calculateBenchmarkReturn(
  bars: DailyBarRecord[],
): number | null {
  const grouped =
    new Map<
      string,
      DailyBarRecord[]
    >();

  for (
    const bar
    of bars
  ) {
    const list =
      grouped.get(
        bar.stock_code,
      ) ?? [];

    list.push(
      bar,
    );

    grouped.set(
      bar.stock_code,
      list,
    );
  }

  const returns:
    number[] = [];

  for (
    const stockBars
    of grouped.values()
  ) {
    const sorted =
      [...stockBars].sort(
        (left, right) =>
          left.trading_date.localeCompare(
            right.trading_date,
          ),
      );

    const first =
      sorted[0];

    const last =
      sorted[
        sorted.length - 1
      ];

    const firstClose =
      toNumber(
        first?.close_price,
      );

    const lastClose =
      toNumber(
        last?.close_price,
      );

    if (
      firstClose === null ||
      lastClose === null ||
      firstClose <= 0
    ) {
      continue;
    }

    returns.push(
      (
        lastClose -
        firstClose
      ) /
      firstClose,
    );
  }

  if (
    returns.length === 0
  ) {
    return null;
  }

  return (
    returns.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) /
    returns.length
  );
}

function calculateSharpe(
  equityCurve:
    EquityPointInsert[],
): number | null {
  if (
    equityCurve.length <
    3
  ) {
    return null;
  }

  const returns:
    number[] = [];

  for (
    let index = 1;
    index <
    equityCurve.length;
    index += 1
  ) {
    const previous =
      equityCurve[
        index - 1
      ].equity;

    const current =
      equityCurve[
        index
      ].equity;

    if (
      previous > 0
    ) {
      returns.push(
        (
          current -
          previous
        ) /
        previous,
      );
    }
  }

  if (
    returns.length <
    2
  ) {
    return null;
  }

  const mean =
    returns.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) /
    returns.length;

  const variance =
    returns.reduce(
      (sum, value) =>
        sum +
        (
          value -
          mean
        ) ** 2,
      0,
    ) /
    (
      returns.length -
      1
    );

  const standardDeviation =
    Math.sqrt(
      variance,
    );

  if (
    standardDeviation ===
    0
  ) {
    return null;
  }

  return round(
    (
      mean /
      standardDeviation
    ) *
      Math.sqrt(252),
  );
}

function calculateMaxConsecutiveLosses(
  trades:
    BacktestTradeInsert[],
): number {
  let current =
    0;

  let maximum =
    0;

  for (
    const trade
    of trades
  ) {
    if (
      trade.net_pnl <
      0
    ) {
      current += 1;

      maximum =
        Math.max(
          maximum,
          current,
        );
    } else {
      current =
        0;
    }
  }

  return maximum;
}

export async function runDailyBacktest(
  input:
    RunDailyBacktestInput = {},
) {
  const supabase =
    createSupabaseServerClient();

  const today =
    new Date()
      .toISOString()
      .slice(
        0,
        10,
      );

  const startDate =
    normalizeDate(
      input.startDate ??
        "2023-01-01",
    );

  const endDate =
    normalizeDate(
      input.endDate ??
        today,
    );

  if (
    startDate >
    endDate
  ) {
    throw new Error(
      "백테스트 시작일이 종료일보다 늦습니다.",
    );
  }

  if (
    endDate >
    today
  ) {
    throw new Error(
      "백테스트 종료일은 미래일 수 없습니다.",
    );
  }

  const initialCash =
    Math.max(
      100_000,
      Number(
        input.initialCash ??
          10_000_000,
      ),
    );

  const entryThreshold =
    clamp(
      Number(
        input.entryThreshold ??
          0.62,
      ),
    );

  const stopDistanceRate =
    clamp(
      Number(
        input.stopDistanceRate ??
          0.025,
      ),
      0.001,
      0.5,
    );

  const feeRate =
    clamp(
      Number(
        input.feeRate ??
          0.00015,
      ),
      0,
      0.1,
    );

  const taxRate =
    clamp(
      Number(
        input.taxRate ??
          0.0015,
      ),
      0,
      0.1,
    );

  const slippageRate =
    clamp(
      Number(
        input.slippageRate ??
          0.0005,
      ),
      0,
      0.1,
    );

  const maxPositions =
    Math.min(
      20,
      Math.max(
        1,
        Math.floor(
          Number(
            input.maxPositions ??
              3,
          ),
        ),
      ),
    );

  const maxPositionRate =
    clamp(
      Number(
        input.maxPositionRate ??
          0.2,
      ),
      0.01,
      1,
    );

  const maxHoldingDays =
    Math.min(
      250,
      Math.max(
        1,
        Math.floor(
          Number(
            input.maxHoldingDays ??
              10,
          ),
        ),
      ),
    );

  const stockCodes =
    normalizeStockCodes(
      input.stockCodes,
    );

  const bars =
    await loadDailyBars(
      startDate,
      endDate,
      stockCodes,
    );

  if (
    bars.length === 0
  ) {
    throw new Error(
      "BACKTEST_DAILY_BARS_NOT_FOUND",
    );
  }

  const benchmarkReturn =
    calculateBenchmarkReturn(
      bars,
    );

  const {
    data: runData,
    error: runError,
  } =
    await supabase
      .from(
        "backtest_runs",
      )
      .insert({
        strategy_name:
          "DAILY_ENTRY_BASELINE",

        strategy_version:
          "v2",

        status:
          "RUNNING",

        start_at:
          dateToObservedAt(
            startDate,
          ),

        end_at:
          dateToObservedAt(
            endDate,
          ),

        initial_cash:
          initialCash,

        entry_threshold:
          entryThreshold,

        stop_distance_rate:
          stopDistanceRate,

        fee_rate:
          feeRate,

        tax_rate:
          taxRate,

        slippage_rate:
          slippageRate,

        max_positions:
          maxPositions,

        config: {
          dataset:
            "market_daily_bars",

          stockCodes,

          maxPositionRate,
          maxHoldingDays,

          signalRule:
            "CLOSE_OF_DAY_T",

          entryRule:
            "NEXT_TRADING_DAY_OPEN",

          stopRule:
            "INTRADAY_LOW_WITH_GAP_PROTECTION",

          timeExitRule:
            "NEXT_OPEN_AFTER_MAX_HOLDING_DAYS",

          benchmark:
            "EQUAL_WEIGHT_BUY_AND_HOLD_OF_TESTED_STOCKS",

          futureDataAllowed:
            false,
        },
      })
      .select(
        "id",
      )
      .single();

  if (
    runError ||
    !runData
  ) {
    throw new Error(
      `백테스트 실행 생성 실패: ${
        runError?.message ??
        "실행 ID 없음"
      }`,
    );
  }

  const runId =
    String(
      runData.id,
    );

  try {
    const barsByDate =
      new Map<
        string,
        DailyBarRecord[]
      >();

    for (
      const bar
      of bars
    ) {
      const list =
        barsByDate.get(
          bar.trading_date,
        ) ?? [];

      list.push(
        bar,
      );

      barsByDate.set(
        bar.trading_date,
        list,
      );
    }

    const tradingDates =
      [
        ...barsByDate.keys(),
      ].sort();

    const histories =
      new Map<
        string,
        DailyBarRecord[]
      >();

    const latestClose =
      new Map<
        string,
        number
      >();

    const pendingEntries =
      new Map<
        string,
        PendingEntry
      >();

    const pendingExits =
      new Map<
        string,
        PendingExit
      >();

    const positions =
      new Map<
        string,
        OpenPosition
      >();

    const trades:
      BacktestTradeInsert[] =
      [];

    const equityCurve:
      EquityPointInsert[] =
      [];

    let cash =
      initialCash;

    let peakEquity =
      initialCash;

    let turnoverAmount =
      0;

    const closePosition = (
      position:
        OpenPosition,

      tradingDate:
        string,

      rawExitPrice:
        number,

      exitReason:
        string,
    ) => {
      const exitPriceExec =
        rawExitPrice *
        (
          1 -
          slippageRate
        );

      const grossProceeds =
        exitPriceExec *
        position.quantity;

      const sellFee =
        grossProceeds *
        feeRate;

      const taxAmount =
        grossProceeds *
        taxRate;

      const netProceeds =
        grossProceeds -
        sellFee -
        taxAmount;

      cash +=
        netProceeds;

      const grossPnl =
        (
          rawExitPrice -
          position.entryPriceRaw
        ) *
        position.quantity;

      const netPnl =
        netProceeds -
        position.entryCost;

      const netReturn =
        position.entryCost >
        0
          ? netPnl /
            position.entryCost
          : 0;

      const entrySlippage =
        (
          position.entryPriceExec -
          position.entryPriceRaw
        ) *
        position.quantity;

      const exitSlippage =
        (
          rawExitPrice -
          exitPriceExec
        ) *
        position.quantity;

      turnoverAmount +=
        rawExitPrice *
        position.quantity;

      trades.push({
        stock_code:
          position.stockCode,

        signal_at:
          dateToObservedAt(
            position.signalDate,
          ),

        entry_at:
          dateToObservedAt(
            position.entryDate,
          ),

        exit_at:
          dateToObservedAt(
            tradingDate,
          ),

        quantity:
          position.quantity,

        signal_score:
          position.signalScore,

        prediction_score:
          null,

        prediction_confidence:
          null,

        entry_price_raw:
          round(
            position.entryPriceRaw,
            4,
          ),

        entry_price_exec:
          round(
            position.entryPriceExec,
            4,
          ),

        initial_stop_price:
          round(
            position.initialStopPrice,
            4,
          ),

        exit_price_raw:
          round(
            rawExitPrice,
            4,
          ),

        exit_price_exec:
          round(
            exitPriceExec,
            4,
          ),

        exit_reason:
          exitReason,

        gross_pnl:
          round(
            grossPnl,
            2,
          ),

        buy_fee:
          round(
            position.buyFee,
            2,
          ),

        sell_fee:
          round(
            sellFee,
            2,
          ),

        tax_amount:
          round(
            taxAmount,
            2,
          ),

        slippage_cost:
          round(
            entrySlippage +
              exitSlippage,
            2,
          ),

        net_pnl:
          round(
            netPnl,
            2,
          ),

        net_return:
          round(
            netReturn,
          ),

        holding_minutes:
          position.holdingBars *
          ONE_DAY_MINUTES,

        metadata: {
          strategy:
            "DAILY_ENTRY_BASELINE_V2",

          holdingBars:
            position.holdingBars,
        },
      });

      positions.delete(
        position.stockCode,
      );

      pendingExits.delete(
        position.stockCode,
      );
    };

    for (
      const tradingDate
      of tradingDates
    ) {
      const dayBars =
        barsByDate.get(
          tradingDate,
        ) ?? [];

      /*
       * --------------------------------------------------------
       * 1. 전일 종가에서 결정한 일반 청산을
       *    오늘 시가에서 실행
       * --------------------------------------------------------
       */
      for (
        const bar
        of dayBars
      ) {
        const position =
          positions.get(
            bar.stock_code,
          );

        const pendingExit =
          pendingExits.get(
            bar.stock_code,
          );

        if (
          !position ||
          !pendingExit
        ) {
          continue;
        }

        const open =
          toNumber(
            bar.open_price,
          );

        if (
          open === null ||
          open <= 0
        ) {
          continue;
        }

        closePosition(
          position,
          tradingDate,
          open,
          pendingExit.reason,
        );
      }

      /*
       * --------------------------------------------------------
       * 2. 전일 종가에서 발생한 매수 신호를
       *    오늘 시가에서 실행
       * --------------------------------------------------------
       */
      for (
        const bar
        of dayBars
      ) {
        const pending =
          pendingEntries.get(
            bar.stock_code,
          );

        if (!pending) {
          continue;
        }

        pendingEntries.delete(
          bar.stock_code,
        );

        if (
          positions.has(
            bar.stock_code,
          )
        ) {
          continue;
        }

        if (
          positions.size >=
          maxPositions
        ) {
          continue;
        }

        const rawEntryPrice =
          toNumber(
            bar.open_price,
          );

        if (
          rawEntryPrice ===
            null ||
          rawEntryPrice <= 0
        ) {
          continue;
        }

        const entryPriceExec =
          rawEntryPrice *
          (
            1 +
            slippageRate
          );

        const marketValue =
          [
            ...positions.values(),
          ].reduce(
            (
              total,
              position,
            ) => {
              const price =
                latestClose.get(
                  position.stockCode,
                ) ??
                position.entryPriceExec;

              return (
                total +
                price *
                  position.quantity
              );
            },
            0,
          );

        const equityBeforeEntry =
          cash +
          marketValue;

        const allocation =
          equityBeforeEntry *
          maxPositionRate;

        const quantity =
          Math.floor(
            allocation /
            (
              entryPriceExec *
              (
                1 +
                feeRate
              )
            ),
          );

        if (
          quantity <= 0
        ) {
          continue;
        }

        const grossCost =
          entryPriceExec *
          quantity;

        const buyFee =
          grossCost *
          feeRate;

        const entryCost =
          grossCost +
          buyFee;

        if (
          entryCost >
          cash
        ) {
          continue;
        }

        /*
         * 신호일 종가 기준 stop을
         * 다음날 실제 체결가격에 그대로 쓰면
         * 큰 갭에서 왜곡될 수 있으므로,
         * 실제 진입가격 기준으로 다시 산정한다.
         */
        const initialStopPrice =
          Math.floor(
            rawEntryPrice *
              (
                1 -
                stopDistanceRate
              ),
          );

        cash -=
          entryCost;

        turnoverAmount +=
          rawEntryPrice *
          quantity;

        positions.set(
          bar.stock_code,
          {
            stockCode:
              bar.stock_code,

            signalDate:
              pending.signal.signalDate,

            signalScore:
              pending.signal.score,

            entryDate:
              tradingDate,

            quantity,

            entryPriceRaw:
              rawEntryPrice,

            entryPriceExec,

            initialStopPrice,

            buyFee,
            entryCost,

            holdingBars:
              0,
          },
        );
      }

      /*
       * --------------------------------------------------------
       * 3. 오늘 장중 저가가 손절선을 침범했는지 확인
       *
       * 갭하락:
       *   시가 < stop -> 시가에서 손절
       *
       * 일반:
       *   low <= stop -> stop 가격에서 손절
       * --------------------------------------------------------
       */
      for (
        const bar
        of dayBars
      ) {
        const position =
          positions.get(
            bar.stock_code,
          );

        if (!position) {
          continue;
        }

        const open =
          toNumber(
            bar.open_price,
          );

        const low =
          toNumber(
            bar.low_price,
          );

        if (
          open === null ||
          low === null
        ) {
          continue;
        }

        if (
          low >
          position.initialStopPrice
        ) {
          continue;
        }

        const rawExitPrice =
          open <
          position.initialStopPrice
            ? open
            : position.initialStopPrice;

        closePosition(
          position,
          tradingDate,
          rawExitPrice,
          open <
            position.initialStopPrice
            ? "STOP_LOSS_GAP"
            : "STOP_LOSS",
        );
      }

      /*
       * --------------------------------------------------------
       * 4. 오늘 종가를 기록하고 history에 추가
       *
       * 여기 이전 단계에서는 오늘 종가를
       * 매매 의사결정에 사용하지 않았다.
       * --------------------------------------------------------
       */
      for (
        const bar
        of dayBars
      ) {
        const close =
          toNumber(
            bar.close_price,
          );

        if (
          close !== null &&
          close > 0
        ) {
          latestClose.set(
            bar.stock_code,
            close,
          );
        }

        const history =
          histories.get(
            bar.stock_code,
          ) ?? [];

        history.push(
          bar,
        );

        histories.set(
          bar.stock_code,
          history,
        );

        const position =
          positions.get(
            bar.stock_code,
          );

        if (position) {
          position.holdingBars +=
            1;
        }
      }

      /*
       * --------------------------------------------------------
       * 5. 최대 보유기간에 도달한 종목은
       *    내일 시가 청산 예약
       * --------------------------------------------------------
       */
      for (
        const position
        of positions.values()
      ) {
        if (
          position.holdingBars >=
          maxHoldingDays
        ) {
          pendingExits.set(
            position.stockCode,
            {
              reason:
                "MAX_HOLDING_DAYS",
            },
          );
        }
      }

      /*
       * --------------------------------------------------------
       * 6. 오늘 종가까지의 정보만 사용해서
       *    내일 매수 후보 결정
       * --------------------------------------------------------
       */
      for (
        const bar
        of dayBars
      ) {
        if (
          positions.has(
            bar.stock_code,
          ) ||
          pendingEntries.has(
            bar.stock_code,
          )
        ) {
          continue;
        }

        const history =
          histories.get(
            bar.stock_code,
          ) ?? [];

        const signal =
          calculateSignal(
            history,
            entryThreshold,
            stopDistanceRate,
          );

        if (!signal) {
          continue;
        }

        pendingEntries.set(
          bar.stock_code,
          {
            signal,
          },
        );
      }

      /*
       * --------------------------------------------------------
       * 7. 종가 기준 자산곡선
       * --------------------------------------------------------
       */
      let marketValue =
        0;

      const positionState:
        EquityPointInsert["positions"] =
        [];

      for (
        const position
        of positions.values()
      ) {
        const currentPrice =
          latestClose.get(
            position.stockCode,
          ) ??
          position.entryPriceExec;

        marketValue +=
          currentPrice *
          position.quantity;

        positionState.push({
          stockCode:
            position.stockCode,

          quantity:
            position.quantity,

          entryPrice:
            round(
              position.entryPriceExec,
              4,
            ),

          currentPrice:
            round(
              currentPrice,
              4,
            ),

          holdingBars:
            position.holdingBars,
        });
      }

      const equity =
        cash +
        marketValue;

      peakEquity =
        Math.max(
          peakEquity,
          equity,
        );

      const drawdown =
        peakEquity > 0
          ? (
              peakEquity -
              equity
            ) /
            peakEquity
          : 0;

      equityCurve.push({
        observed_at:
          dateToObservedAt(
            tradingDate,
          ),

        cash:
          round(
            cash,
            2,
          ),

        market_value:
          round(
            marketValue,
            2,
          ),

        equity:
          round(
            equity,
            2,
          ),

        peak_equity:
          round(
            peakEquity,
            2,
          ),

        drawdown:
          round(
            drawdown,
          ),

        open_position_count:
          positions.size,

        positions:
          positionState,
      });
    }

    /*
     * ----------------------------------------------------------
     * 테스트 종료 시 보유 포지션 강제청산
     * ----------------------------------------------------------
     */
    const finalDate =
      tradingDates[
        tradingDates.length - 1
      ];

    const finalBars =
      barsByDate.get(
        finalDate,
      ) ?? [];

    const finalBarMap =
      new Map(
        finalBars.map(
          (bar) => [
            bar.stock_code,
            bar,
          ],
        ),
      );

    for (
      const position
      of [
        ...positions.values(),
      ]
    ) {
      const bar =
        finalBarMap.get(
          position.stockCode,
        );

      const rawExitPrice =
        toNumber(
          bar?.close_price,
        ) ??
        latestClose.get(
          position.stockCode,
        );

      if (
        rawExitPrice ===
          null ||
        rawExitPrice ===
          undefined ||
        rawExitPrice <= 0
      ) {
        continue;
      }

      closePosition(
        position,
        finalDate,
        rawExitPrice,
        "END_OF_BACKTEST",
      );
    }

    const finalEquity =
      cash;

    /*
     * 최종 자산곡선은 모든 포지션 청산 상태로 보정
     */
    if (
      equityCurve.length >
      0
    ) {
      const last =
        equityCurve[
          equityCurve.length - 1
        ];

      peakEquity =
        Math.max(
          peakEquity,
          finalEquity,
        );

      last.cash =
        round(
          finalEquity,
          2,
        );

      last.market_value =
        0;

      last.equity =
        round(
          finalEquity,
          2,
        );

      last.peak_equity =
        round(
          peakEquity,
          2,
        );

      last.drawdown =
        peakEquity > 0
          ? round(
              (
                peakEquity -
                finalEquity
              ) /
              peakEquity,
            )
          : 0;

      last.open_position_count =
        0;

      last.positions =
        [];
    }

    const winners =
      trades.filter(
        (trade) =>
          trade.net_pnl > 0,
      );

    const losers =
      trades.filter(
        (trade) =>
          trade.net_pnl < 0,
      );

    const totalWinningPnl =
      winners.reduce(
        (sum, trade) =>
          sum +
          trade.net_pnl,
        0,
      );

    const totalLosingPnl =
      losers.reduce(
        (sum, trade) =>
          sum +
          Math.abs(
            trade.net_pnl,
          ),
        0,
      );

    const winRate =
      trades.length > 0
        ? winners.length /
          trades.length
        : null;

    const averageWin =
      winners.length > 0
        ? totalWinningPnl /
          winners.length
        : null;

    const averageLoss =
      losers.length > 0
        ? -(
            totalLosingPnl /
            losers.length
          )
        : null;

    const profitFactor =
      totalLosingPnl > 0
        ? totalWinningPnl /
          totalLosingPnl
        : totalWinningPnl > 0
          ? null
          : 0;

    const netReturn =
      (
        finalEquity -
        initialCash
      ) /
      initialCash;

    const excessReturn =
      benchmarkReturn ===
      null
        ? null
        : netReturn -
          benchmarkReturn;

    const maxDrawdown =
      equityCurve.reduce(
        (
          maximum,
          point,
        ) =>
          Math.max(
            maximum,
            point.drawdown,
          ),
        0,
      );

    const sharpeRatio =
      calculateSharpe(
        equityCurve,
      );

    const turnover =
      turnoverAmount /
      initialCash;

    const maxConsecutiveLosses =
      calculateMaxConsecutiveLosses(
        trades,
      );

    /*
     * ----------------------------------------------------------
     * DB 저장
     * ----------------------------------------------------------
     */
    if (
      trades.length >
      0
    ) {
      const {
        error,
      } =
        await supabase
          .from(
            "backtest_trades",
          )
          .insert(
            trades.map(
              (trade) => ({
                run_id:
                  runId,

                ...trade,
              }),
            ),
          );

      if (error) {
        throw new Error(
          `백테스트 거래 저장 실패: ${error.message}`,
        );
      }
    }

    if (
      equityCurve.length >
      0
    ) {
      const {
        error,
      } =
        await supabase
          .from(
            "backtest_equity_curve",
          )
          .insert(
            equityCurve.map(
              (point) => ({
                run_id:
                  runId,

                ...point,
              }),
            ),
          );

      if (error) {
        throw new Error(
          `백테스트 자산곡선 저장 실패: ${error.message}`,
        );
      }
    }

    const metrics = {
      dataset:
        "market_daily_bars",

      barCount:
        bars.length,

      tradingDayCount:
        tradingDates.length,

      tradeCount:
        trades.length,

      winningTrades:
        winners.length,

      losingTrades:
        losers.length,

      winRate:
        winRate === null
          ? null
          : round(
              winRate,
            ),

      netReturn:
        round(
          netReturn,
        ),

      benchmarkReturn:
        benchmarkReturn ===
        null
          ? null
          : round(
              benchmarkReturn,
            ),

      excessReturn:
        excessReturn ===
        null
          ? null
          : round(
              excessReturn,
            ),

      averageWin:
        averageWin ===
        null
          ? null
          : round(
              averageWin,
              2,
            ),

      averageLoss:
        averageLoss ===
        null
          ? null
          : round(
              averageLoss,
              2,
            ),

      profitFactor:
        profitFactor ===
        null
          ? null
          : round(
              profitFactor,
            ),

      maxDrawdown:
        round(
          maxDrawdown,
        ),

      sharpeRatio,

      deflatedSharpeRatio:
        null,

      turnover:
        round(
          turnover,
        ),

      maxConsecutiveLosses,

      maxHoldingDays,
    };

    const {
      error: updateError,
    } =
      await supabase
        .from(
          "backtest_runs",
        )
        .update({
          status:
            "SUCCESS",

          final_equity:
            round(
              finalEquity,
              2,
            ),

          trade_count:
            trades.length,

          winning_trade_count:
            winners.length,

          losing_trade_count:
            losers.length,

          win_rate:
            winRate,

          gross_return:
            trades.reduce(
              (sum, trade) =>
                sum +
                trade.gross_pnl,
              0,
            ) /
            initialCash,

          net_return:
            netReturn,

          benchmark_return:
            benchmarkReturn,

          excess_return:
            excessReturn,

          average_win:
            averageWin,

          average_loss:
            averageLoss,

          profit_factor:
            profitFactor,

          max_drawdown:
            maxDrawdown,

          sharpe_ratio:
            sharpeRatio,

          deflated_sharpe_ratio:
            null,

          turnover,

          max_consecutive_losses:
            maxConsecutiveLosses,

          metrics,

          finished_at:
            new Date()
              .toISOString(),

          error_message:
            null,
        })
        .eq(
          "id",
          runId,
        );

    if (updateError) {
      throw new Error(
        `백테스트 결과 저장 실패: ${updateError.message}`,
      );
    }

    return {
      runId,

      strategy:
        "DAILY_ENTRY_BASELINE",

      version:
        "v2",

      status:
        "SUCCESS",

      startDate,
      endDate,

      initialCash,

      finalEquity:
        round(
          finalEquity,
          2,
        ),

      ...metrics,

      /*
       * API 응답이 너무 커지는 것을 막기 위해
       * 최근 거래 30건만 반환한다.
       * 전체 거래는 backtest_trades에 저장된다.
       */
      recentTrades:
        trades.slice(
          -30,
        ),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "일봉 백테스트 실행 중 오류";

    await supabase
      .from(
        "backtest_runs",
      )
      .update({
        status:
          "FAILED",

        error_message:
          message,

        finished_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        runId,
      );

    throw error;
  }
}