import {
  createSupabaseServerClient,
} from "@/lib/supabase";

/*
 * Export name remains V711 for route compatibility.
 * Response version is v7.12 Decision Event Identity.
 */
export async function getCurrentForwardCausalCohortV711() {
  const supabase =
    createSupabaseServerClient();

  const {
    data: batch,
    error: batchError,
  } =
    await supabase
      .from(
        "market_regime_forward_batches",
      )
      .select(`
        id,
        automation_run_id,
        quality_gate_observation_id,
        comparison_id,
        market_date,
        quality_gate_status,
        quality_gate_usable,
        comparison_eligible,
        agreement_state,
        v6_would_block,
        v7_would_block,
        v7_policy,
        status,
        metadata,
        created_at,
        updated_at
      `)
      .eq(
        "is_validation",
        false,
      )
      .order(
        "created_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    batchError
  ) {
    throw new Error(
      `v7.12 current batch load failed: ${batchError.message}`,
    );
  }

  if (
    !batch
  ) {
    return {
      version:
        "MARKET_REGIME_FORWARD_DECISION_COHORT_V7_13",

      batch:
        null,

      decisionEvents:
        [],

      signalEvents:
        [],

      outcomes:
        [],

      productionApplied:
        false,
    };
  }

  const [
    decisionsResponse,
    eventsResponse,
    outcomesResponse,
  ] =
    await Promise.all([
      supabase
        .from(
          "entry_decision_events",
        )
        .select(`
          id,
          automation_run_id,
          batch_id,
          signal_id,
          entry_model_id,
          stock_code,
          decision_at,
          decision_market_date,
          decision_before_market_open,
          signal_status,
          qualifies,
          forward_eligible,
          score,
          threshold,
          snapshot_observed_at,
          reference_price,
          prediction_id,
          prediction_generated_at,
          prediction_date,
          prediction_model_name,
          prediction_model_version,
          prediction_score,
          prediction_confidence,
          decision_fingerprint,
          created_at
        `)
        .eq(
          "batch_id",
          batch.id,
        )
        .order(
          "created_at",
          {
            ascending:
              true,
          },
        ),

      supabase
        .from(
          "market_regime_forward_signal_events",
        )
        .select(`
          id,
          decision_event_id,
          signal_id,
          shadow_track_id,
          stock_code,
          signal_status,
          signal_score,
          signal_observed_at,
          signal_market_date,
          decision_at,
          decision_market_date,
          decision_before_market_open,
          prediction_id,
          reference_price,
          signal_created_at,
          metadata,
          created_at
        `)
        .eq(
          "batch_id",
          batch.id,
        )
        .order(
          "created_at",
          {
            ascending:
              true,
          },
        ),

      supabase
        .from(
          "market_regime_shadow_outcomes",
        )
        .select(`
          id,
          automation_run_id,
          batch_id,
          decision_event_id,
          forward_signal_event_id,
          comparison_id,
          signal_track_id,
          stock_code,
          market_date,
          signal_market_date,
          decision_at,
          decision_market_date,
          decision_before_market_open,
          entry_trading_date,
          evaluation_status,
          return_1d,
          return_3d,
          return_5d,
          disagreement_winner,
          created_at
        `)
        .eq(
          "batch_id",
          batch.id,
        )
        .order(
          "created_at",
          {
            ascending:
              true,
          },
        ),
    ]);

  if (
    decisionsResponse.error
  ) {
    throw new Error(
      `v7.12 current decision load failed: ${decisionsResponse.error.message}`,
    );
  }

  if (
    eventsResponse.error
  ) {
    throw new Error(
      `v7.12 current signal event load failed: ${eventsResponse.error.message}`,
    );
  }

  if (
    outcomesResponse.error
  ) {
    throw new Error(
      `v7.12 current outcome load failed: ${outcomesResponse.error.message}`,
    );
  }

  const decisions =
    decisionsResponse.data ??
    [];

  const forwardEligibleDecisionCount =
    decisions.filter(
      (
        decision,
      ) =>
        decision
          .forward_eligible ===
        true,
    ).length;

  return {
    version:
      "MARKET_REGIME_FORWARD_DECISION_COHORT_V7_13",

    batch,

    decisionEvents:
      decisions,

    signalEvents:
      eventsResponse.data ??
      [],

    outcomes:
      outcomesResponse.data ??
      [],

    counts: {
      decisionEvents:
        decisions.length,

      forwardEligibleDecisions:
        forwardEligibleDecisionCount,

      signalEvents:
        eventsResponse
          .data
          ?.length ??
        0,

      outcomes:
        outcomesResponse
          .data
          ?.length ??
        0,
    },

    safety: {
      productionApplied:
        false,

      immutableDecisionIdentity:
        true,

      reusedSignalRowsCanCreateNewDecisionEvents:
        true,

      timestampInferenceUsedForCohortMembership:
        false,

      forwardEntryCanPrecedeDecisionTimestamp:
        false,

      validationRowsExcluded:
        true,
    },
  };
}
