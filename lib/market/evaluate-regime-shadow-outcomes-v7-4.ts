import {
  createSupabaseServerClient,
} from "@/lib/supabase";

interface OutcomeRow {
  id: string;

  automation_run_id:
    string | null;

  is_validation:
    boolean;

  stock_code: string;

  market_date: string;

  signal_market_date:
    string | null;

  signal_observed_at:
    string;

  decision_event_id:
    string | null;

  decision_at:
    string | null;

  decision_market_date:
    string | null;

  decision_before_market_open:
    boolean | null;

  v6_would_block:
    boolean;

  v7_would_block:
    boolean;

  agreement_state:
    string;
}

interface DailyBarRow {
  trading_date: string;

  open_price:
    number | string;

  high_price:
    number | string;

  low_price:
    number | string;

  close_price:
    number | string;
}

function toNumber(
  value:
    | number
    | string,
): number {
  const parsed =
    Number(value);

  if (
    !Number.isFinite(
      parsed,
    )
  ) {
    throw new Error(
      `Invalid numeric market bar value: ${String(value)}`,
    );
  }

  return parsed;
}

function toSeoulSqlDate(
  timestamp: string,
): string {
  const parsed =
    new Date(timestamp);

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    throw new Error(
      `INVALID_TIMESTAMP: ${timestamp}`,
    );
  }

  return new Date(
    parsed.getTime() +
      9 *
        60 *
        60 *
        1000,
  )
    .toISOString()
    .slice(0, 10);
}

function calculateReturn(
  exitPrice: number,
  entryPrice: number,
): number {
  return (
    exitPrice /
      entryPrice -
    1
  );
}

function decisionScore(
  wouldBlock:
    boolean,

  forwardReturn:
    number,
) {
  return wouldBlock
    ? -forwardReturn
    : forwardReturn;
}

function resolveWinner(
  v6WouldBlock:
    boolean,

  v7WouldBlock:
    boolean,

  v6Score:
    number,

  v7Score:
    number,
) {
  if (
    v6WouldBlock ===
    v7WouldBlock
  ) {
    return "SAME_DECISION";
  }

  const epsilon =
    1e-12;

  if (
    Math.abs(
      v6Score -
      v7Score,
    ) <=
    epsilon
  ) {
    return "TIE";
  }

  return v6Score >
    v7Score
    ? "V6"
    : "V7";
}

/*
 * v7.12 causal forward evaluator
 *
 * New decision-event rows:
 *
 * - decision BEFORE 09:00 Asia/Seoul:
 *   first available bar with trading_date >= decision_market_date.
 *   This permits the same-day 09:00 open because the decision existed
 *   before that open.
 *
 * - decision AT/AFTER 09:00 Asia/Seoul:
 *   first available bar with trading_date > decision_market_date.
 *   This prevents using an open that already happened before the decision.
 *
 * Legacy rows without v7.12 decision identity retain the v7.4.1 rule:
 * first trading-day open strictly after signal_market_date.
 */
interface EvaluateRegimeShadowOutcomesV713Options {
  automationRunIds?:
    string[];

  includeValidation?:
    boolean;
}

export async function evaluateRegimeShadowOutcomesV74(
  limit = 200,

  options:
    EvaluateRegimeShadowOutcomesV713Options = {},
) {
  const supabase =
    createSupabaseServerClient();

  const safeLimit =
    Math.min(
      1000,
      Math.max(
        1,
        Math.floor(limit),
      ),
    );

  let outcomesQuery =
    supabase
      .from(
        "market_regime_shadow_outcomes",
      )
      .select(`
        id,
        automation_run_id,
        is_validation,
        stock_code,
        market_date,
        signal_market_date,
        signal_observed_at,
        decision_event_id,
        decision_at,
        decision_market_date,
        decision_before_market_open,
        v6_would_block,
        v7_would_block,
        agreement_state
      `)
      .in(
        "evaluation_status",
        [
          "PENDING",
          "PARTIAL",
        ],
      );

  if (
    options
      .includeValidation !==
    true
  ) {
    outcomesQuery =
      outcomesQuery.eq(
        "is_validation",
        false,
      );
  }

  const automationRunIds =
    [
      ...new Set(
        (
          options
            .automationRunIds ??
          []
        )
          .map(
            (value) =>
              value.trim(),
          )
          .filter(Boolean),
      ),
    ];

  if (
    automationRunIds.length >
    0
  ) {
    outcomesQuery =
      outcomesQuery.in(
        "automation_run_id",
        automationRunIds,
      );
  }

  const {
    data: outcomesData,
    error: outcomesError,
  } =
    await outcomesQuery
      .order(
        "created_at",
        {
          ascending:
            true,
        },
      )
      .limit(
        safeLimit,
      );

  if (
    outcomesError
  ) {
    throw new Error(
      `Pending regime outcomes load failed: ${outcomesError.message}`,
    );
  }

  const outcomes =
    (outcomesData ??
      []) as OutcomeRow[];

  let completed =
    0;

  let partial =
    0;

  let pending =
    0;

  let invalid =
    0;

  const results:
    Array<
      Record<
        string,
        unknown
      >
    > = [];

  for (
    const outcome
    of outcomes
  ) {
    let anchorDate:
      string;

    let anchorMode:
      "DECISION_EVENT_GTE" |
      "DECISION_EVENT_GT" |
      "LEGACY_SIGNAL_GT";

    let decisionMarketDate:
      string | null =
        null;

    let signalMarketDate:
      string;

    try {
      signalMarketDate =
        outcome
          .signal_market_date ??
        toSeoulSqlDate(
          outcome
            .signal_observed_at,
        );

      const hasDecisionIdentity =
        outcome
          .decision_event_id !==
          null &&
        outcome
          .decision_at !==
          null &&
        outcome
          .decision_before_market_open !==
          null;

      if (
        hasDecisionIdentity
      ) {
        decisionMarketDate =
          outcome
            .decision_market_date ??
          toSeoulSqlDate(
            outcome
              .decision_at!,
          );

        anchorDate =
          decisionMarketDate;

        anchorMode =
          outcome
            .decision_before_market_open ===
          true
            ? "DECISION_EVENT_GTE"
            : "DECISION_EVENT_GT";
      } else {
        anchorDate =
          signalMarketDate;

        anchorMode =
          "LEGACY_SIGNAL_GT";
      }
    } catch {
      invalid +=
        1;

      const now =
        new Date()
          .toISOString();

      await supabase
        .from(
          "market_regime_shadow_outcomes",
        )
        .update({
          evaluation_status:
            "INVALID",

          evaluated_at:
            now,

          updated_at:
            now,

          metadata: {
            version:
              "MARKET_REGIME_FORWARD_OUTCOME_V7_13",

            error:
              "INVALID_CAUSAL_ANCHOR_DATE",

            productionApplied:
              false,
          },
        })
        .eq(
          "id",
          outcome.id,
        );

      continue;
    }

    let barsQuery =
      supabase
        .from(
          "market_daily_bars",
        )
        .select(`
          trading_date,
          open_price,
          high_price,
          low_price,
          close_price
        `)
        .eq(
          "stock_code",
          outcome.stock_code,
        );

    if (
      anchorMode ===
        "DECISION_EVENT_GTE"
    ) {
      barsQuery =
        barsQuery.gte(
          "trading_date",
          anchorDate,
        );
    } else {
      barsQuery =
        barsQuery.gt(
          "trading_date",
          anchorDate,
        );
    }

    const {
      data: barsData,
      error: barsError,
    } =
      await barsQuery
        .order(
          "trading_date",
          {
            ascending:
              true,
          },
        )
        .limit(5);

    if (
      barsError
    ) {
      invalid +=
        1;

      const now =
        new Date()
          .toISOString();

      await supabase
        .from(
          "market_regime_shadow_outcomes",
        )
        .update({
          evaluation_status:
            "INVALID",

          evaluated_at:
            now,

          updated_at:
            now,

          metadata: {
            version:
              "MARKET_REGIME_FORWARD_OUTCOME_V7_13",

            error:
              barsError.message,

            anchorDate,
            anchorMode,

            productionApplied:
              false,
          },
        })
        .eq(
          "id",
          outcome.id,
        );

      continue;
    }

    const bars =
      (barsData ??
        []) as DailyBarRow[];

    if (
      bars.length ===
        0
    ) {
      pending +=
        1;

      results.push({
        id:
          outcome.id,

        stockCode:
          outcome.stock_code,

        decisionEventId:
          outcome
            .decision_event_id,

        decisionAt:
          outcome
            .decision_at,

        decisionMarketDate,

        signalMarketDate,

        anchorDate,
        anchorMode,

        status:
          "PENDING",

        availableTradingDays:
          0,
      });

      continue;
    }

    let entryOpenPrice:
      number;

    try {
      entryOpenPrice =
        toNumber(
          bars[0]
            .open_price,
        );
    } catch {
      invalid +=
        1;

      const now =
        new Date()
          .toISOString();

      await supabase
        .from(
          "market_regime_shadow_outcomes",
        )
        .update({
          evaluation_status:
            "INVALID",

          evaluated_at:
            now,

          updated_at:
            now,
        })
        .eq(
          "id",
          outcome.id,
        );

      continue;
    }

    if (
      entryOpenPrice <=
        0
    ) {
      invalid +=
        1;

      const now =
        new Date()
          .toISOString();

      await supabase
        .from(
          "market_regime_shadow_outcomes",
        )
        .update({
          evaluation_status:
            "INVALID",

          evaluated_at:
            now,

          updated_at:
            now,
        })
        .eq(
          "id",
          outcome.id,
        );

      continue;
    }

    const oneDay =
      bars[0];

    const threeDay =
      bars.length >=
        3
        ? bars[2]
        : null;

    const fiveDay =
      bars.length >=
        5
        ? bars[4]
        : null;

    const oneDayClose =
      toNumber(
        oneDay.close_price,
      );

    const return1d =
      calculateReturn(
        oneDayClose,
        entryOpenPrice,
      );

    const return3d =
      threeDay
        ? calculateReturn(
            toNumber(
              threeDay
                .close_price,
            ),
            entryOpenPrice,
          )
        : null;

    const return5d =
      fiveDay
        ? calculateReturn(
            toNumber(
              fiveDay
                .close_price,
            ),
            entryOpenPrice,
          )
        : null;

    const evaluatedWindow =
      bars.slice(
        0,
        Math.min(
          5,
          bars.length,
        ),
      );

    const maxHigh =
      Math.max(
        ...evaluatedWindow.map(
          (
            bar,
          ) =>
            toNumber(
              bar.high_price,
            ),
        ),
      );

    const minLow =
      Math.min(
        ...evaluatedWindow.map(
          (
            bar,
          ) =>
            toNumber(
              bar.low_price,
            ),
        ),
      );

    const maxReturn5d =
      calculateReturn(
        maxHigh,
        entryOpenPrice,
      );

    const minReturn5d =
      calculateReturn(
        minLow,
        entryOpenPrice,
      );

    const status =
      fiveDay
        ? "COMPLETED"
        : "PARTIAL";

    const v6Score =
      return5d ===
        null
        ? null
        : decisionScore(
            outcome
              .v6_would_block,
            return5d,
          );

    const v7Score =
      return5d ===
        null
        ? null
        : decisionScore(
            outcome
              .v7_would_block,
            return5d,
          );

    const winner =
      v6Score ===
        null ||
      v7Score ===
        null
        ? null
        : resolveWinner(
            outcome
              .v6_would_block,

            outcome
              .v7_would_block,

            v6Score,
            v7Score,
          );

    const now =
      new Date()
        .toISOString();

    const {
      error: updateError,
    } =
      await supabase
        .from(
          "market_regime_shadow_outcomes",
        )
        .update({
          signal_market_date:
            signalMarketDate,

          decision_market_date:
            decisionMarketDate,

          entry_trading_date:
            oneDay
              .trading_date,

          entry_open_price:
            entryOpenPrice,

          close_1d_date:
            oneDay
              .trading_date,

          close_1d_price:
            oneDayClose,

          return_1d:
            return1d,

          close_3d_date:
            threeDay
              ?.trading_date ??
            null,

          close_3d_price:
            threeDay
              ? toNumber(
                  threeDay
                    .close_price,
                )
              : null,

          return_3d:
            return3d,

          close_5d_date:
            fiveDay
              ?.trading_date ??
            null,

          close_5d_price:
            fiveDay
              ? toNumber(
                  fiveDay
                    .close_price,
                )
              : null,

          return_5d:
            return5d,

          max_high_5d:
            maxHigh,

          min_low_5d:
            minLow,

          max_return_5d:
            maxReturn5d,

          min_return_5d:
            minReturn5d,

          v6_decision_score_5d:
            v6Score,

          v7_decision_score_5d:
            v7Score,

          disagreement_winner:
            winner,

          evaluation_status:
            status,

          evaluated_at:
            now,

          updated_at:
            now,

          metadata: {
            version:
              "MARKET_REGIME_FORWARD_OUTCOME_V7_13",

            scope:
              outcome
                .decision_event_id
                ? "IMMUTABLE_ENTRY_DECISION_EVENT"
                : "LEGACY_SIGNAL_EVENT",

            regimeMarketDate:
              outcome
                .market_date,

            decisionEventId:
              outcome
                .decision_event_id,

            decisionAt:
              outcome
                .decision_at,

            decisionMarketDate,

            decisionBeforeMarketOpen:
              outcome
                .decision_before_market_open,

            signalMarketDate,

            anchorDate,
            anchorMode,

            availableTradingDays:
              bars.length,

            forwardEntryConvention:
              outcome
                .decision_event_id
                ? "FIRST_TRADING_DAY_OPEN_NOT_BEFORE_DECISION_TIMESTAMP"
                : "NEXT_TRADING_DAY_OPEN_AFTER_SIGNAL_DATE",

            futureDataAllowed:
              false,

            productionApplied:
              false,

            exactPortfolioPnl:
              false,
          },
        })
        .eq(
          "id",
          outcome.id,
        );

    if (
      updateError
    ) {
      throw new Error(
        `Regime outcome update failed (${outcome.id}): ${updateError.message}`,
      );
    }

    if (
      status ===
        "COMPLETED"
    ) {
      completed +=
        1;
    } else {
      partial +=
        1;
    }

    results.push({
      id:
        outcome.id,

      stockCode:
        outcome
          .stock_code,

      regimeMarketDate:
        outcome
          .market_date,

      decisionEventId:
        outcome
          .decision_event_id,

      decisionAt:
        outcome
          .decision_at,

      decisionMarketDate,

      signalMarketDate,

      anchorDate,
      anchorMode,

      agreementState:
        outcome
          .agreement_state,

      status,

      availableTradingDays:
        bars.length,

      entryTradingDate:
        oneDay
          .trading_date,

      entryOpenPrice,

      return1d,
      return3d,
      return5d,

      maxReturn5d,
      minReturn5d,

      v6DecisionScore5d:
        v6Score,

      v7DecisionScore5d:
        v7Score,

      disagreementWinner:
        winner,
    });
  }

  return {
    version:
      "MARKET_REGIME_FORWARD_OUTCOME_V7_13",

    productionApplied:
      false,

    forwardEntryConvention:
      "DECISION_AWARE_FIRST_TRADING_DAY_OPEN",

    marketOpenTimeZone:
      "Asia/Seoul",

    marketOpenTime:
      "09:00",

    validationRowsIncluded:
      options
        .includeValidation ===
      true,

    automationRunFilter:
      automationRunIds,

    analyzed:
      outcomes.length,

    completed,
    partial,
    pending,
    invalid,

    results,
  };
}
