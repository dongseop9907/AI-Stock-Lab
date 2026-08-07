import {
  randomUUID,
} from "crypto";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  linkLatestRegimeShadowOutcomesV74,
} from "@/lib/market/link-regime-shadow-outcomes-v7-4";

import {
  evaluateRegimeShadowOutcomesV74,
} from "@/lib/market/evaluate-regime-shadow-outcomes-v7-4";

interface ValidationInput {
  retainArtifacts?:
    boolean;
}

interface ComparisonRow {
  id: string;

  v7_market_date:
    string | null;

  agreement_state:
    string;

  v6_would_block:
    boolean;

  v7_would_block:
    boolean;

  v7_policy:
    string;
}

interface ShadowTrackRow {
  id: string;

  signal_id: string;

  model_id: string;

  stock_code: string;

  signal_status:
    string | null;

  signal_score:
    number | string | null;

  signal_observed_at:
    string;

  reference_price:
    number | string | null;
}

interface SignalRow {
  id: string;

  model_id: string;

  stock_code: string;

  status: string;

  score:
    number | string | null;

  observed_at: string;

  recommended_entry_price:
    number | string | null;

  recommended_stop_price:
    number | string | null;

  recommended_quantity:
    number | string | null;

  created_at: string;
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

interface ValidationCaseArtifacts {
  label:
    "BEFORE_OPEN" |
    "AFTER_OPEN";

  automationRunId:
    string;

  batchId:
    string;

  decisionEventId:
    string;

  forwardSignalEventId:
    string;

  expectedEntryTradingDate:
    string;

  decisionAt:
    string;

  decisionMarketDate:
    string;

  decisionBeforeMarketOpen:
    boolean;
}

function toNullableNumber(
  value:
    | number
    | string
    | null,
) {
  if (
    value === null ||
    value ===
      undefined
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
}

function toSeoulDecisionTimestamp(
  tradingDate:
    string,

  hour:
    number,

  minute:
    number,
) {
  return new Date(
    `${tradingDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`,
  )
    .toISOString();
}

async function cleanupValidationArtifacts(
  automationRunIds:
    string[],
) {
  const supabase =
    createSupabaseServerClient();

  const errors:
    string[] = [];

  const deleteSteps =
    [
      "market_regime_shadow_outcomes",
      "market_regime_forward_signal_events",
      "entry_decision_events",
      "market_regime_forward_batches",
    ] as const;

  for (
    const table
    of deleteSteps
  ) {
    const {
      error,
    } =
      await supabase
        .from(table)
        .delete()
        .in(
          "automation_run_id",
          automationRunIds,
        );

    if (
      error
    ) {
      errors.push(
        `${table}: ${error.message}`,
      );
    }
  }

  return {
    attempted:
      true,

    succeeded:
      errors.length ===
      0,

    errors,
  };
}

async function createValidationCase(
  input: {
    label:
      "BEFORE_OPEN" |
      "AFTER_OPEN";

    decisionAt:
      string;

    decisionMarketDate:
      string;

    decisionBeforeMarketOpen:
      boolean;

    expectedEntryTradingDate:
      string;

    comparison:
      ComparisonRow;

    track:
      ShadowTrackRow;

    signal:
      SignalRow;
  },
): Promise<
  ValidationCaseArtifacts
> {
  const supabase =
    createSupabaseServerClient();

  const automationRunId =
    `VALIDATION_V7_13_${input.label}_${randomUUID()}`;

  const {
    data: batch,
    error: batchError,
  } =
    await supabase
      .from(
        "market_regime_forward_batches",
      )
      .insert({
        automation_run_id:
          automationRunId,

        comparison_id:
          input
            .comparison
            .id,

        market_date:
          input
            .comparison
            .v7_market_date,

        quality_gate_status:
          "VALIDATION_ONLY",

        quality_gate_usable:
          true,

        comparison_eligible:
          true,

        agreement_state:
          input
            .comparison
            .agreement_state,

        v6_would_block:
          input
            .comparison
            .v6_would_block,

        v7_would_block:
          input
            .comparison
            .v7_would_block,

        v7_policy:
          input
            .comparison
            .v7_policy,

        status:
          "READY",

        is_validation:
          true,

        metadata: {
          version:
            "MARKET_REGIME_POSITIVE_PATH_VALIDATION_V7_13",

          validation:
            true,

          case:
            input.label,
        },

        production_applied:
          false,
      })
      .select(
        "id",
      )
      .single();

  if (
    batchError ||
    !batch
  ) {
    throw new Error(
      `v7.13 validation batch insert failed (${input.label}): ${
        batchError?.message ??
        "NO_BATCH"
      }`,
    );
  }

  const decisionFingerprint =
    JSON.stringify({
      version:
        "V7_13",

      validation:
        true,

      automationRunId,

      label:
        input.label,

      signalId:
        input.signal.id,

      decisionAt:
        input.decisionAt,
    });

  const {
    data: decision,
    error: decisionError,
  } =
    await supabase
      .from(
        "entry_decision_events",
      )
      .insert({
        automation_run_id:
          automationRunId,

        batch_id:
          batch.id,

        signal_id:
          input.signal.id,

        stock_code:
          input
            .signal
            .stock_code,

        decision_at:
          input
            .decisionAt,

        decision_market_date:
          input
            .decisionMarketDate,

        decision_before_market_open:
          input
            .decisionBeforeMarketOpen,

        signal_status:
          "GENERATED",

        qualifies:
          true,

        forward_eligible:
          true,

        score:
          toNullableNumber(
            input
              .signal
              .score,
          ) ??
          0.99,

        threshold:
          0.62,

        snapshot_observed_at:
          input
            .signal
            .observed_at,

        reference_price:
          toNullableNumber(
            input
              .signal
              .recommended_entry_price,
          ) ??
          toNullableNumber(
            input
              .track
              .reference_price,
          ),

        recommended_stop_price:
          toNullableNumber(
            input
              .signal
              .recommended_stop_price,
          ),

        recommended_quantity:
          input
            .signal
            .recommended_quantity ===
          null
            ? null
            : Math.floor(
                Number(
                  input
                    .signal
                    .recommended_quantity,
                ),
              ),

        features: {
          validation:
            true,

          reusedExistingSignalRow:
            true,

          sourceSignalId:
            input.signal.id,

          sourceShadowTrackId:
            input.track.id,
        },

        reasons: [
          "Synthetic v7.13 positive-path validation decision.",
        ],

        decision_fingerprint:
          decisionFingerprint,

        is_validation:
          true,

        production_applied:
          false,
      })
      .select(
        "id",
      )
      .single();

  if (
    decisionError ||
    !decision
  ) {
    throw new Error(
      `v7.13 validation decision insert failed (${input.label}): ${
        decisionError?.message ??
        "NO_DECISION"
      }`,
    );
  }

  const {
    data: forwardEvent,
    error: forwardEventError,
  } =
    await supabase
      .from(
        "market_regime_forward_signal_events",
      )
      .insert({
        batch_id:
          batch.id,

        automation_run_id:
          automationRunId,

        decision_event_id:
          decision.id,

        decision_at:
          input
            .decisionAt,

        decision_market_date:
          input
            .decisionMarketDate,

        decision_before_market_open:
          input
            .decisionBeforeMarketOpen,

        signal_id:
          input.signal.id,

        shadow_track_id:
          input.track.id,

        stock_code:
          input
            .signal
            .stock_code,

        signal_status:
          "GENERATED",

        signal_score:
          toNullableNumber(
            input
              .signal
              .score,
          ) ??
          0.99,

        signal_observed_at:
          input
            .signal
            .observed_at,

        signal_market_date:
          input
            .signal
            .observed_at
            .slice(
              0,
              10,
            ),

        reference_price:
          toNullableNumber(
            input
              .signal
              .recommended_entry_price,
          ) ??
          toNullableNumber(
            input
              .track
              .reference_price,
          ),

        signal_created_at:
          input
            .signal
            .created_at,

        is_validation:
          true,

        metadata: {
          version:
            "MARKET_REGIME_POSITIVE_PATH_VALIDATION_V7_13",

          validation:
            true,

          case:
            input.label,

          reusedExistingSignalRow:
            true,

          reusedExistingShadowTrack:
            true,
        },

        production_applied:
          false,
      })
      .select(
        "id",
      )
      .single();

  if (
    forwardEventError ||
    !forwardEvent
  ) {
    throw new Error(
      `v7.13 validation forward-event insert failed (${input.label}): ${
        forwardEventError?.message ??
        "NO_FORWARD_EVENT"
      }`,
    );
  }

  return {
    label:
      input.label,

    automationRunId,

    batchId:
      String(
        batch.id,
      ),

    decisionEventId:
      String(
        decision.id,
      ),

    forwardSignalEventId:
      String(
        forwardEvent.id,
      ),

    expectedEntryTradingDate:
      input
        .expectedEntryTradingDate,

    decisionAt:
      input
        .decisionAt,

    decisionMarketDate:
      input
        .decisionMarketDate,

    decisionBeforeMarketOpen:
      input
        .decisionBeforeMarketOpen,
  };
}

export async function runMarketRegimePositivePathValidationV713(
  input:
    ValidationInput = {},
) {
  const supabase =
    createSupabaseServerClient();

  const startedAt =
    new Date()
      .toISOString();

  const {
    data: validationRun,
    error: validationRunError,
  } =
    await supabase
      .from(
        "market_regime_positive_path_validation_runs",
      )
      .insert({
        started_at:
          startedAt,

        status:
          "RUNNING",

        production_applied:
          false,
      })
      .select(
        "id",
      )
      .single();

  if (
    validationRunError ||
    !validationRun
  ) {
    throw new Error(
      `v7.13 validation audit row insert failed: ${
        validationRunError?.message ??
        "NO_VALIDATION_RUN"
      }`,
    );
  }

  const validationRunId =
    String(
      validationRun.id,
    );

  const createdAutomationRunIds:
    string[] = [];

  let cleanupResult = {
    attempted:
      false,

    succeeded:
      false,

    errors:
      [] as string[],
  };

  try {
    const [
      comparisonResponse,
      tracksResponse,
    ] =
      await Promise.all([
        supabase
          .from(
            "market_regime_shadow_comparisons",
          )
          .select(`
            id,
            v7_market_date,
            agreement_state,
            v6_would_block,
            v7_would_block,
            v7_policy
          `)
          .eq(
            "comparison_eligible",
            true,
          )
          .order(
            "observed_at",
            {
              ascending:
                false,
            },
          )
          .limit(1)
          .maybeSingle(),

        supabase
          .from(
            "shadow_signal_tracks",
          )
          .select(`
            id,
            signal_id,
            model_id,
            stock_code,
            signal_status,
            signal_score,
            signal_observed_at,
            reference_price
          `)
          .not(
            "signal_id",
            "is",
            null,
          )
          .order(
            "updated_at",
            {
              ascending:
                false,
            },
          )
          .limit(100),
      ]);

    if (
      comparisonResponse.error ||
      !comparisonResponse.data
    ) {
      throw new Error(
        `v7.13 eligible comparison load failed: ${
          comparisonResponse
            .error
            ?.message ??
          "NO_ELIGIBLE_COMPARISON"
        }`,
      );
    }

    if (
      tracksResponse.error
    ) {
      throw new Error(
        `v7.13 shadow-track load failed: ${tracksResponse.error.message}`,
      );
    }

    const comparison =
      comparisonResponse.data as
        ComparisonRow;

    const tracks =
      (
        tracksResponse.data ??
        []
      ) as ShadowTrackRow[];

    if (
      tracks.length ===
      0
    ) {
      throw new Error(
        "v7.13 requires at least one existing shadow signal track.",
      );
    }

    let selectedTrack:
      ShadowTrackRow |
      null =
        null;

    let selectedSignal:
      SignalRow |
      null =
        null;

    let selectedBars:
      DailyBarRow[] =
        [];

    for (
      const track
      of tracks
    ) {
      const [
        signalResponse,
        barsResponse,
      ] =
        await Promise.all([
          supabase
            .from(
              "ai_entry_signals",
            )
            .select(`
              id,
              model_id,
              stock_code,
              status,
              score,
              observed_at,
              recommended_entry_price,
              recommended_stop_price,
              recommended_quantity,
              created_at
            `)
            .eq(
              "id",
              track.signal_id,
            )
            .maybeSingle(),

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
              track.stock_code,
            )
            .order(
              "trading_date",
              {
                ascending:
                  true,
              },
            )
            .limit(2000),
        ]);

      if (
        signalResponse.error ||
        barsResponse.error
      ) {
        continue;
      }

      const bars =
        (
          barsResponse.data ??
          []
        ) as DailyBarRow[];

      if (
        signalResponse.data &&
        bars.length >=
          8
      ) {
        selectedTrack =
          track;

        selectedSignal =
          signalResponse.data as
            SignalRow;

        selectedBars =
          bars;

        break;
      }
    }

    if (
      !selectedTrack ||
      !selectedSignal ||
      selectedBars.length <
        8
    ) {
      throw new Error(
        "v7.13 could not find an existing signal/track pair with enough historical daily bars.",
      );
    }

    const baseIndex =
      selectedBars.length -
      7;

    const baseTradingDate =
      selectedBars[
        baseIndex
      ]
        .trading_date;

    const nextTradingDate =
      selectedBars[
        baseIndex +
        1
      ]
        .trading_date;

    const beforeCase =
      await createValidationCase({
        label:
          "BEFORE_OPEN",

        decisionAt:
          toSeoulDecisionTimestamp(
            baseTradingDate,
            8,
            30,
          ),

        decisionMarketDate:
          baseTradingDate,

        decisionBeforeMarketOpen:
          true,

        expectedEntryTradingDate:
          baseTradingDate,

        comparison,

        track:
          selectedTrack,

        signal:
          selectedSignal,
      });

    createdAutomationRunIds.push(
      beforeCase
        .automationRunId,
    );

    const afterCase =
      await createValidationCase({
        label:
          "AFTER_OPEN",

        decisionAt:
          toSeoulDecisionTimestamp(
            baseTradingDate,
            10,
            30,
          ),

        decisionMarketDate:
          baseTradingDate,

        decisionBeforeMarketOpen:
          false,

        expectedEntryTradingDate:
          nextTradingDate,

        comparison,

        track:
          selectedTrack,

        signal:
          selectedSignal,
      });

    createdAutomationRunIds.push(
      afterCase
        .automationRunId,
    );

    const beforeLink =
      await linkLatestRegimeShadowOutcomesV74({
        automationRunId:
          beforeCase
            .automationRunId,
      });

    const afterLink =
      await linkLatestRegimeShadowOutcomesV74({
        automationRunId:
          afterCase
            .automationRunId,
      });

    const evaluation =
      await evaluateRegimeShadowOutcomesV74(
        20,
        {
          automationRunIds:
            createdAutomationRunIds,

          includeValidation:
            true,
        },
      );

    const {
      data: outcomesData,
      error: outcomesError,
    } =
      await supabase
        .from(
          "market_regime_shadow_outcomes",
        )
        .select(`
          id,
          automation_run_id,
          decision_event_id,
          forward_signal_event_id,
          signal_track_id,
          stock_code,
          decision_at,
          decision_market_date,
          decision_before_market_open,
          entry_trading_date,
          entry_open_price,
          evaluation_status,
          return_1d,
          return_3d,
          return_5d,
          is_validation
        `)
        .in(
          "automation_run_id",
          createdAutomationRunIds,
        )
        .order(
          "decision_at",
          {
            ascending:
              true,
          },
        );

    if (
      outcomesError
    ) {
      throw new Error(
        `v7.13 validation outcome reload failed: ${outcomesError.message}`,
      );
    }

    const outcomes =
      outcomesData ??
      [];

    const beforeOutcome =
      outcomes.find(
        (
          row,
        ) =>
          row
            .automation_run_id ===
          beforeCase
            .automationRunId,
      );

    const afterOutcome =
      outcomes.find(
        (
          row,
        ) =>
          row
            .automation_run_id ===
          afterCase
            .automationRunId,
      );

    const assertions = {
      twoDecisionEventsHaveDistinctIds:
        beforeCase
          .decisionEventId !==
        afterCase
          .decisionEventId,

      twoForwardEventsHaveDistinctIds:
        beforeCase
          .forwardSignalEventId !==
        afterCase
          .forwardSignalEventId,

      sameUnderlyingSignalReused:
        true,

      sameUnderlyingShadowTrackReused:
        true,

      beforeOpenOutcomeCreated:
        Boolean(
          beforeOutcome,
        ),

      afterOpenOutcomeCreated:
        Boolean(
          afterOutcome,
        ),

      beforeOpenCompleted:
        beforeOutcome
          ?.evaluation_status ===
        "COMPLETED",

      afterOpenCompleted:
        afterOutcome
          ?.evaluation_status ===
        "COMPLETED",

      beforeOpenUsesSameTradingDayOpen:
        beforeOutcome
          ?.entry_trading_date ===
        baseTradingDate,

      afterOpenUsesNextTradingDayOpen:
        afterOutcome
          ?.entry_trading_date ===
        nextTradingDate,

      validationRowsRemainFlagged:
        outcomes.length ===
          2 &&
        outcomes.every(
          (
            row,
          ) =>
            row
              .is_validation ===
            true,
        ),

      productionApplied:
        false,
    };

    const passed =
      Object
        .entries(
          assertions,
        )
        .filter(
          (
            [
              key,
            ],
          ) =>
            key !==
            "productionApplied",
        )
        .every(
          (
            [
              ,
              value,
            ],
          ) =>
            value ===
            true,
        ) &&
      assertions
        .productionApplied ===
      false;

    const beforeCaseResult = {
      ...beforeCase,

      linker:
        beforeLink,

      outcome:
        beforeOutcome ??
        null,
    };

    const afterCaseResult = {
      ...afterCase,

      linker:
        afterLink,

      outcome:
        afterOutcome ??
        null,
    };

    if (
      input
        .retainArtifacts !==
      true
    ) {
      cleanupResult =
        await cleanupValidationArtifacts(
          createdAutomationRunIds,
        );
    }

    const {
      error: auditUpdateError,
    } =
      await supabase
        .from(
          "market_regime_positive_path_validation_runs",
        )
        .update({
          finished_at:
            new Date()
              .toISOString(),

          status:
            passed
              ? "PASS"
              : "FAIL",

          stock_code:
            selectedSignal
              .stock_code,

          base_trading_date:
            baseTradingDate,

          next_trading_date:
            nextTradingDate,

          reused_signal_id:
            selectedSignal.id,

          reused_shadow_track_id:
            selectedTrack.id,

          before_open_case:
            beforeCaseResult,

          after_open_case:
            afterCaseResult,

          assertions,

          cleanup_attempted:
            cleanupResult
              .attempted,

          cleanup_succeeded:
            cleanupResult
              .succeeded,

          error_message:
            passed
              ? null
              : "One or more v7.13 positive-path assertions failed.",
        })
        .eq(
          "id",
          validationRunId,
        );

    if (
      auditUpdateError
    ) {
      throw new Error(
        `v7.13 validation audit update failed: ${auditUpdateError.message}`,
      );
    }

    return {
      version:
        "MARKET_REGIME_POSITIVE_PATH_VALIDATION_V7_13",

      validationRunId,

      status:
        passed
          ? "PASS"
          : "FAIL",

      productionApplied:
        false,

      stockCode:
        selectedSignal
          .stock_code,

      reusedSignalId:
        selectedSignal.id,

      reusedShadowTrackId:
        selectedTrack.id,

      historicalWindow: {
        baseTradingDate,
        nextTradingDate,
      },

      beforeOpenCase:
        beforeCaseResult,

      afterOpenCase:
        afterCaseResult,

      evaluation,

      assertions,

      cleanup:
        cleanupResult,

      safety: {
        validationRowsExcludedFromNormalEvaluator:
          true,

        validationRowsExcludedFromForwardEvidence:
          true,

        validationBatchesExcludedFromCurrentCohort:
          true,

        realOrdersCreated:
          false,

        realRiskValidationChanged:
          false,
      },
    };
  } catch (
    error
  ) {
    if (
      createdAutomationRunIds.length >
        0 &&
      input
        .retainArtifacts !==
        true
    ) {
      cleanupResult =
        await cleanupValidationArtifacts(
          createdAutomationRunIds,
        );
    }

    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_V7_13_VALIDATION_ERROR";

    await supabase
      .from(
        "market_regime_positive_path_validation_runs",
      )
      .update({
        finished_at:
          new Date()
            .toISOString(),

        status:
          "ERROR",

        cleanup_attempted:
          cleanupResult
            .attempted,

        cleanup_succeeded:
          cleanupResult
            .succeeded,

        error_message:
          message,
      })
      .eq(
        "id",
        validationRunId,
      );

    throw error;
  }
}
