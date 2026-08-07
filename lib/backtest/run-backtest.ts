import { createSupabaseServerClient } from "@/lib/supabase";

interface RunBacktestInput {
  startAt?: string;
  endAt?: string;

  stockCodes?: string[];

  initialCash?: number;

  entryThreshold?: number;
  stopDistanceRate?: number;

  feeRate?: number;
  taxRate?: number;
  slippageRate?: number;

  maxPositions?: number;
  maxPositionRate?: number;
}

interface SnapshotRecord {
  id: number;

  stock_code: string;
  observed_at: string;

  open_price:
    | number
    | string
    | null;

  high_price:
    | number
    | string
    | null;

  low_price:
    | number
    | string
    | null;

  close_price:
    | number
    | string
    | null;

  volume:
    | number
    | string
    | null;

  raw_payload: unknown;
}

interface SignalResult {
  stockCode: string;
  signalAt: string;

  score: number;

  entryReferencePrice: number;
  stopPrice: number;

  reasons: string[];
}

interface PendingEntry {
  signal: SignalResult;
}

interface OpenPosition {
  stockCode: string;

  signalAt: string;
  signalScore: number;

  entryAt: string;

  quantity: number;

  entryPriceRaw: number;
  entryPriceExec: number;

  initialStopPrice: number;

  buyFee: number;
  entryCost: number;
}

interface BacktestTrade {
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

interface EquityPoint {
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
  }>;
}

const DAY_MS =
  24 * 60 * 60 * 1000;

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
  value: string[] | undefined,
): string[] {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) =>
          item.trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function getSource(
  rawPayload: unknown,
): string {
  if (
    !rawPayload ||
    typeof rawPayload !== "object" ||
    Array.isArray(rawPayload)
  ) {
    return "";
  }

  return String(
    (
      rawPayload as Record<
        string,
        unknown
      >
    ).source ?? "",
  ).toUpperCase();
}

function isTestSnapshot(
  snapshot: SnapshotRecord,
): boolean {
  const source =
    getSource(
      snapshot.raw_payload,
    );

  return (
    source.includes("TEST") ||
    source.includes("MOCK") ||
    source.includes("DUMMY")
  );
}

/*
 * 현재 실시간 진입 신호 엔진과 같은
 * 기본 점수 계산식.
 */
function calculateSignal(
  snapshots: SnapshotRecord[],
  entryThreshold: number,
  stopDistanceRate: number,
): SignalResult | null {
  const latest =
    snapshots[
      snapshots.length - 1
    ];

  if (!latest) {
    return null;
  }

  const latestClose =
    toNumber(
      latest.close_price,
    );

  if (
    latestClose === null ||
    latestClose <= 0
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

  const latestVolume =
    toNumber(
      latest.volume,
    ) ?? 0;

  const previous =
    snapshots[
      snapshots.length - 2
    ];

  const previousClose =
    toNumber(
      previous?.close_price,
    ) ??
    latestOpen ??
    latestClose;

  const momentumRate =
    previousClose > 0
      ? (
          latestClose -
          previousClose
        ) /
        previousClose
      : 0;

  const intradayRate =
    latestOpen !== null &&
    latestOpen > 0
      ? (
          latestClose -
          latestOpen
        ) /
        latestOpen
      : 0;

  const rangePosition =
    latestHigh !== null &&
    latestLow !== null &&
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
    snapshots
      .slice(
        Math.max(
          0,
          snapshots.length - 6,
        ),
        snapshots.length - 1,
      )
      .map((snapshot) =>
        toNumber(
          snapshot.volume,
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

  const momentumScore =
    clamp(
      (
        momentumRate +
        0.01
      ) / 0.03,
    );

  const intradayScore =
    clamp(
      (
        intradayRate +
        0.01
      ) / 0.025,
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
      ) / 1.2,
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

    signalAt:
      latest.observed_at,

    score:
      round(score),

    entryReferencePrice:
      latestClose,

    stopPrice:
      Math.floor(
        latestClose *
          (
            1 -
            stopDistanceRate
          ),
      ),

    reasons: [
      "백테스트 진입 기준을 통과했습니다.",
      `진입점수 ${round(score, 4)}`,
      `모멘텀 ${round(momentumRate, 4)}`,
      `장중수익률 ${round(intradayRate, 4)}`,
    ],
  };
}

async function loadSnapshots(
  startAt: string,
  endAt: string,
  stockCodes: string[],
): Promise<SnapshotRecord[]> {
  const supabase =
    createSupabaseServerClient();

  const pageSize = 1000;

  let offset = 0;

  const results:
    SnapshotRecord[] = [];

  while (true) {
    let query = supabase
      .from(
        "market_snapshots",
      )
      .select(`
        id,
        stock_code,
        observed_at,
        open_price,
        high_price,
        low_price,
        close_price,
        volume,
        raw_payload
      `)
      .gte(
        "observed_at",
        startAt,
      )
      .lte(
        "observed_at",
        endAt,
      )
      .order(
        "observed_at",
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
      stockCodes.length > 0
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
        `백테스트 시세 조회 실패: ${error.message}`,
      );
    }

    const page =
      (data ??
        []) as SnapshotRecord[];

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

  const now =
    Date.now();

  return results.filter(
    (snapshot) => {
      const observed =
        new Date(
          snapshot.observed_at,
        ).getTime();

      return (
        Number.isFinite(
          observed,
        ) &&
        observed <= now &&
        !isTestSnapshot(
          snapshot,
        )
      );
    },
  );
}

function calculateMaxDrawdown(
  equityCurve: EquityPoint[],
): number {
  let maximum =
    0;

  for (
    const point
    of equityCurve
  ) {
    maximum =
      Math.max(
        maximum,
        point.drawdown,
      );
  }

  return maximum;
}

function getKoreanDate(
  value: string,
): string {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Seoul",

        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(
      new Date(value),
    );

  const result =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );

  return (
    `${result.year}-` +
    `${result.month}-` +
    `${result.day}`
  );
}

function calculateSharpe(
  equityCurve: EquityPoint[],
): number | null {
  const daily =
    new Map<
      string,
      number
    >();

  for (
    const point
    of equityCurve
  ) {
    daily.set(
      getKoreanDate(
        point.observed_at,
      ),
      point.equity,
    );
  }

  const equities =
    [...daily.values()];

  if (
    equities.length < 3
  ) {
    return null;
  }

  const returns:
    number[] = [];

  for (
    let index = 1;
    index <
    equities.length;
    index += 1
  ) {
    const previous =
      equities[index - 1];

    const current =
      equities[index];

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
    returns.length < 2
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

  const deviation =
    Math.sqrt(
      variance,
    );

  if (
    deviation === 0
  ) {
    return null;
  }

  return round(
    (
      mean /
      deviation
    ) *
      Math.sqrt(252),
  );
}

function maxConsecutiveLosses(
  trades: BacktestTrade[],
): number {
  let current = 0;
  let maximum = 0;

  for (
    const trade
    of trades
  ) {
    if (
      trade.net_pnl < 0
    ) {
      current += 1;

      maximum =
        Math.max(
          maximum,
          current,
        );
    } else {
      current = 0;
    }
  }

  return maximum;
}

export async function runBacktest(
  input: RunBacktestInput = {},
) {
  const supabase =
    createSupabaseServerClient();

  const now =
    new Date();

  const endDate =
    input.endAt
      ? new Date(
          input.endAt,
        )
      : now;

  const startDate =
    input.startAt
      ? new Date(
          input.startAt,
        )
      : new Date(
          endDate.getTime() -
            90 * DAY_MS,
        );

  if (
    !Number.isFinite(
      startDate.getTime(),
    ) ||
    !Number.isFinite(
      endDate.getTime(),
    )
  ) {
    throw new Error(
      "INVALID_BACKTEST_DATE",
    );
  }

  if (
    endDate.getTime() >
    now.getTime()
  ) {
    throw new Error(
      "BACKTEST_END_TIME_CANNOT_BE_FUTURE",
    );
  }

  if (
    startDate >=
    endDate
  ) {
    throw new Error(
      "INVALID_BACKTEST_DATE_RANGE",
    );
  }

  const initialCash =
    Math.max(
      100_000,
      input.initialCash ??
        10_000_000,
    );

  const entryThreshold =
    clamp(
      input.entryThreshold ??
        0.62,
    );

  const stopDistanceRate =
    clamp(
      input.stopDistanceRate ??
        0.025,
      0.001,
      0.5,
    );

  const feeRate =
    clamp(
      input.feeRate ??
        0.00015,
      0,
      0.1,
    );

  const taxRate =
    clamp(
      input.taxRate ??
        0.0015,
      0,
      0.1,
    );

  const slippageRate =
    clamp(
      input.slippageRate ??
        0.0005,
      0,
      0.1,
    );

  const maxPositions =
    Math.min(
      20,
      Math.max(
        1,
        Math.floor(
          input.maxPositions ??
            3,
        ),
      ),
    );

  const maxPositionRate =
    clamp(
      input.maxPositionRate ??
        0.2,
      0.01,
      1,
    );

  const stockCodes =
    normalizeStockCodes(
      input.stockCodes,
    );

  const snapshots =
    await loadSnapshots(
      startDate.toISOString(),
      endDate.toISOString(),
      stockCodes,
    );

  if (
    snapshots.length === 0
  ) {
    throw new Error(
      "BACKTEST_SNAPSHOTS_NOT_FOUND",
    );
  }

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
          "ENTRY_TIMING_RULE",

        strategy_version:
          "v1",

        status:
          "RUNNING",

        start_at:
          startDate.toISOString(),

        end_at:
          endDate.toISOString(),

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
          stockCodes,
          maxPositionRate,

          executionRule:
            "SIGNAL_AT_T_EXECUTE_AT_NEXT_SNAPSHOT",

          futureDataAllowed:
            false,
        },
      })
      .select("id")
      .single();

  if (
    runError ||
    !runData
  ) {
    throw new Error(
      `백테스트 실행 생성 실패: ${
        runError?.message ??
        "실행 ID가 없습니다."
      }`,
    );
  }

  const runId =
    String(runData.id);

  try {
    /*
     * 동일 시각의 종목들을
     * 한 번에 처리한다.
     */
    const grouped =
      new Map<
        string,
        SnapshotRecord[]
      >();

    for (
      const snapshot
      of snapshots
    ) {
      const list =
        grouped.get(
          snapshot.observed_at,
        ) ?? [];

      list.push(
        snapshot,
      );

      grouped.set(
        snapshot.observed_at,
        list,
      );
    }

    const timestamps =
      [...grouped.keys()]
        .sort(
          (left, right) =>
            new Date(
              left,
            ).getTime() -
            new Date(
              right,
            ).getTime(),
        );

    const histories =
      new Map<
        string,
        SnapshotRecord[]
      >();

    const latestPrices =
      new Map<
        string,
        number
      >();

    const pendingEntries =
      new Map<
        string,
        PendingEntry
      >();

    const positions =
      new Map<
        string,
        OpenPosition
      >();

    const trades:
      BacktestTrade[] = [];

    const equityCurve:
      EquityPoint[] = [];

    let cash =
      initialCash;

    let peakEquity =
      initialCash;

    let turnoverAmount =
      0;

    const closePosition = (
      position: OpenPosition,
      snapshot: SnapshotRecord,
      exitPriceRaw: number,
      exitReason: string,
    ) => {
      const exitPriceExec =
        exitPriceRaw *
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

      const proceeds =
        grossProceeds -
        sellFee -
        taxAmount;

      cash +=
        proceeds;

      const grossPnl =
        (
          exitPriceRaw -
          position.entryPriceRaw
        ) *
        position.quantity;

      const netPnl =
        proceeds -
        position.entryCost;

      const netReturn =
        position.entryCost > 0
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
          exitPriceRaw -
          exitPriceExec
        ) *
        position.quantity;

      const holdingMinutes =
        (
          new Date(
            snapshot.observed_at,
          ).getTime() -
          new Date(
            position.entryAt,
          ).getTime()
        ) /
        60_000;

      turnoverAmount +=
        exitPriceRaw *
        position.quantity;

      trades.push({
        stock_code:
          position.stockCode,

        signal_at:
          position.signalAt,

        entry_at:
          position.entryAt,

        exit_at:
          snapshot.observed_at,

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
            exitPriceRaw,
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
          round(
            holdingMinutes,
            2,
          ),

        metadata: {
          strategy:
            "ENTRY_TIMING_RULE_V1",
        },
      });

      positions.delete(
        position.stockCode,
      );
    };

    for (
      const timestamp
      of timestamps
    ) {
      const currentSnapshots =
        grouped.get(
          timestamp,
        ) ?? [];

      /*
       * 1. 기존 포지션의 손절부터 확인
       */
      for (
        const snapshot
        of currentSnapshots
      ) {
        const close =
          toNumber(
            snapshot.close_price,
          );

        if (
          close !== null
        ) {
          latestPrices.set(
            snapshot.stock_code,
            close,
          );
        }

        const position =
          positions.get(
            snapshot.stock_code,
          );

        if (!position) {
          continue;
        }

        const low =
          toNumber(
            snapshot.low_price,
          );

        if (
          low === null ||
          low >
            position.initialStopPrice
        ) {
          continue;
        }

        const open =
          toNumber(
            snapshot.open_price,
          );

        /*
         * 갭하락이면 손절가보다
         * 더 낮은 시가에서 체결될 수 있다.
         */
        const rawExit =
          open !== null &&
          open <
            position.initialStopPrice
            ? open
            : position.initialStopPrice;

        closePosition(
          position,
          snapshot,
          rawExit,
          "STOP_LOSS",
        );
      }

      /*
       * 2. 이전 시점 신호를
       * 다음 관측 가격에서 체결
       *
       * 신호를 발생시킨 바로 그 가격으로
       * 매수하지 않아 look-ahead를 줄인다.
       */
      for (
        const snapshot
        of currentSnapshots
      ) {
        const pending =
          pendingEntries.get(
            snapshot.stock_code,
          );

        if (!pending) {
          continue;
        }

        pendingEntries.delete(
          snapshot.stock_code,
        );

        if (
          positions.has(
            snapshot.stock_code,
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

        const rawPrice =
          toNumber(
            snapshot.close_price,
          );

        if (
          rawPrice === null ||
          rawPrice <= 0
        ) {
          continue;
        }

        const entryPriceExec =
          rawPrice *
          (
            1 +
            slippageRate
          );

        const equityBeforeEntry =
          cash +
          [...positions.values()]
            .reduce(
              (
                total,
                position,
              ) => {
                const price =
                  latestPrices.get(
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

        cash -=
          entryCost;

        turnoverAmount +=
          rawPrice *
          quantity;

        positions.set(
          snapshot.stock_code,
          {
            stockCode:
              snapshot.stock_code,

            signalAt:
              pending.signal.signalAt,

            signalScore:
              pending.signal.score,

            entryAt:
              snapshot.observed_at,

            quantity,

            entryPriceRaw:
              rawPrice,

            entryPriceExec,

            initialStopPrice:
              pending.signal.stopPrice,

            buyFee,

            entryCost,
          },
        );
      }

      /*
       * 3. 현재 관측 데이터까지
       * history에 추가
       */
      for (
        const snapshot
        of currentSnapshots
      ) {
        const history =
          histories.get(
            snapshot.stock_code,
          ) ?? [];

        history.push(
          snapshot,
        );

        histories.set(
          snapshot.stock_code,
          history,
        );
      }

      /*
       * 4. 현재 시점까지의 데이터만 사용해
       * 다음 시점 진입 여부 결정
       */
      for (
        const snapshot
        of currentSnapshots
      ) {
        if (
          positions.has(
            snapshot.stock_code,
          ) ||
          pendingEntries.has(
            snapshot.stock_code,
          )
        ) {
          continue;
        }

        const history =
          histories.get(
            snapshot.stock_code,
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
          snapshot.stock_code,
          {
            signal,
          },
        );
      }

      /*
       * 5. 자산곡선
       */
      let marketValue =
        0;

      const positionState:
        EquityPoint["positions"] =
        [];

      for (
        const position
        of positions.values()
      ) {
        const price =
          latestPrices.get(
            position.stockCode,
          ) ??
          position.entryPriceExec;

        marketValue +=
          price *
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
              price,
              4,
            ),
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
          timestamp,

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
     * 테스트 종료 시 남은 포지션은
     * 마지막 관측가로 강제 종료한다.
     */
    for (
      const position
      of [
        ...positions.values(),
      ]
    ) {
      const history =
        histories.get(
          position.stockCode,
        );

      const lastSnapshot =
        history?.[
          history.length - 1
        ];

      if (!lastSnapshot) {
        continue;
      }

      const rawExit =
        toNumber(
          lastSnapshot.close_price,
        );

      if (
        rawExit === null ||
        rawExit <= 0
      ) {
        continue;
      }

      closePosition(
        position,
        lastSnapshot,
        rawExit,
        "END_OF_BACKTEST",
      );
    }

    const finalEquity =
      cash;

    if (
      equityCurve.length > 0
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
        : (
            totalWinningPnl >
            0
              ? null
              : 0
          );

    const netReturn =
      (
        finalEquity -
        initialCash
      ) /
      initialCash;

    const maxDrawdown =
      calculateMaxDrawdown(
        equityCurve,
      );

    const sharpeRatio =
      calculateSharpe(
        equityCurve,
      );

    const turnover =
      turnoverAmount /
      initialCash;

    /*
     * 거래 저장
     */
    if (
      trades.length > 0
    ) {
      const rows =
        trades.map(
          (trade) => ({
            run_id:
              runId,

            ...trade,
          }),
        );

      const {
        error,
      } =
        await supabase
          .from(
            "backtest_trades",
          )
          .insert(
            rows,
          );

      if (error) {
        throw new Error(
          `백테스트 거래 저장 실패: ${error.message}`,
        );
      }
    }

    /*
     * 자산곡선 저장
     */
    if (
      equityCurve.length > 0
    ) {
      const rows =
        equityCurve.map(
          (point) => ({
            run_id:
              runId,

            ...point,
          }),
        );

      const {
        error,
      } =
        await supabase
          .from(
            "backtest_equity_curve",
          )
          .insert(
            rows,
          );

      if (error) {
        throw new Error(
          `백테스트 자산곡선 저장 실패: ${error.message}`,
        );
      }
    }

    const metrics = {
      snapshotCount:
        snapshots.length,

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

      maxDrawdown:
        round(
          maxDrawdown,
        ),

      profitFactor:
        profitFactor ===
        null
          ? null
          : round(
              profitFactor,
            ),

      sharpeRatio,

      /*
       * DSR은 여러 전략/모델을
       * 충분히 비교한 후 계산한다.
       */
      deflatedSharpeRatio:
        null,

      turnover:
        round(
          turnover,
        ),

      maxConsecutiveLosses:
        maxConsecutiveLosses(
          trades,
        ),
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
            maxConsecutiveLosses(
              trades,
            ),

          metrics,

          finished_at:
            new Date()
              .toISOString(),
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

      status:
        "SUCCESS",

      startAt:
        startDate.toISOString(),

      endAt:
        endDate.toISOString(),

      initialCash,

      finalEquity:
        round(
          finalEquity,
          2,
        ),

      ...metrics,

      trades,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "백테스트 실행 중 오류";

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