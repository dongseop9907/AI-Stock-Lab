import {
  createSupabaseServerClient,
} from "@/lib/supabase";

interface BatchRow {
  id: string;

  automation_run_id:
    string;

  comparison_id:
    string | null;

  market_date:
    string | null;

  comparison_eligible:
    boolean | null;

  agreement_state:
    string | null;

  v6_would_block:
    boolean | null;

  v7_would_block:
    boolean | null;

  v7_policy:
    string | null;

  status:
    string;

  is_validation:
    boolean;
}

interface ForwardEventRow {
  id: string;

  decision_event_id:
    string | null;

  decision_at:
    string | null;

  decision_market_date:
    string | null;

  decision_before_market_open:
    boolean | null;

  prediction_id:
    string | null;

  signal_id:
    string;

  shadow_track_id:
    string | null;

  stock_code:
    string;

  signal_status:
    string;

  signal_score:
    number | string | null;

  signal_observed_at:
    string;

  signal_market_date:
    string;

  reference_price:
    number | string | null;

  signal_created_at:
    string;
}

function toNullableNumber(
  value:
    | number
    | string
    | null,
) {
  if (
    value ===
      null ||
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

/*
 * v7.13 validation-safe causal linker
 *
 * Cohort identity:
 *
 * automation run
 *   -> exact v7.10 quality/comparator batch
 *   -> immutable entry_decision_event
 *   -> forward_signal_event
 *   -> exact shadow track for the signal row
 *   -> forward outcome
 *
 * Reused ai_entry_signals and reused shadow_signal_tracks are allowed.
 * They do NOT collapse distinct decisions because decision_event_id /
 * forward_signal_event_id are unique per automation-run decision.
 */
export async function linkLatestRegimeShadowOutcomesV74(
  input: {
    automationRunId?:
      string;
  } = {},
) {
  const automationRunId =
    input
      .automationRunId
      ?.trim() ??
    "";

  if (
    !automationRunId
  ) {
    return {
      version:
        "MARKET_REGIME_FORWARD_OUTCOME_LINK_V7_13",

      linked:
        0,

      skipped:
        true,

      reason:
        "AUTOMATION_RUN_ID_REQUIRED",

      productionApplied:
        false,
    };
  }

  const supabase =
    createSupabaseServerClient();

  const {
    data: batchData,
    error: batchError,
  } =
    await supabase
      .from(
        "market_regime_forward_batches",
      )
      .select(`
        id,
        automation_run_id,
        comparison_id,
        market_date,
        comparison_eligible,
        agreement_state,
        v6_would_block,
        v7_would_block,
        v7_policy,
        status,
        is_validation
      `)
      .eq(
        "automation_run_id",
        automationRunId,
      )
      .maybeSingle();

  if (
    batchError
  ) {
    throw new Error(
      `v7.12 forward batch load failed: ${batchError.message}`,
    );
  }

  const batch =
    batchData as
      | BatchRow
      | null;

  if (
    !batch
  ) {
    return {
      version:
        "MARKET_REGIME_FORWARD_OUTCOME_LINK_V7_13",

      automationRunId,

      linked:
        0,

      skipped:
        true,

      reason:
        "NO_FORWARD_BATCH_FOR_AUTOMATION_RUN",

      productionApplied:
        false,
    };
  }

  if (
    batch
      .comparison_eligible !==
      true ||
    !batch.comparison_id ||
    !batch.market_date ||
    !batch.agreement_state ||
    batch.v6_would_block ===
      null ||
    batch.v7_would_block ===
      null
  ) {
    return {
      version:
        "MARKET_REGIME_FORWARD_OUTCOME_LINK_V7_13",

      automationRunId,

      batchId:
        batch.id,

      linked:
        0,

      skipped:
        true,

      reason:
        "FORWARD_BATCH_NOT_ELIGIBLE",

      batchStatus:
        batch.status,

      productionApplied:
        false,
    };
  }

  const {
    data: eventsData,
    error: eventsError,
  } =
    await supabase
      .from(
        "market_regime_forward_signal_events",
      )
      .select(`
        id,
        decision_event_id,
        decision_at,
        decision_market_date,
        decision_before_market_open,
        prediction_id,
        signal_id,
        shadow_track_id,
        stock_code,
        signal_status,
        signal_score,
        signal_observed_at,
        signal_market_date,
        reference_price,
        signal_created_at
      `)
      .eq(
        "automation_run_id",
        automationRunId,
      )
      .order(
        "created_at",
        {
          ascending:
            true,
        },
      );

  if (
    eventsError
  ) {
    throw new Error(
      `v7.12 forward decision event load failed: ${eventsError.message}`,
    );
  }

  const allEvents =
    (
      eventsData ??
      []
    ) as ForwardEventRow[];

  const events =
    allEvents.filter(
      (
        event,
      ) =>
        event
          .decision_event_id !==
        null &&
        event
          .decision_at !==
        null &&
        event
          .decision_market_date !==
        null &&
        event
          .decision_before_market_open !==
        null &&
        event
          .shadow_track_id !==
        null,
    );

  if (
    allEvents.length ===
      0
  ) {
    return {
      version:
        "MARKET_REGIME_FORWARD_OUTCOME_LINK_V7_13",

      automationRunId,

      batchId:
        batch.id,

      comparisonId:
        batch
          .comparison_id,

      linked:
        0,

      candidateDecisions:
        0,

      skipped:
        true,

      reason:
        "NO_FORWARD_ELIGIBLE_DECISION_EVENTS_IN_AUTOMATION_RUN",

      productionApplied:
        false,
    };
  }

  if (
    events.length ===
      0
  ) {
    return {
      version:
        "MARKET_REGIME_FORWARD_OUTCOME_LINK_V7_13",

      automationRunId,

      batchId:
        batch.id,

      comparisonId:
        batch
          .comparison_id,

      linked:
        0,

      candidateDecisions:
        allEvents.length,

      skipped:
        true,

      reason:
        "DECISION_EVENTS_HAVE_NO_BOUND_SHADOW_TRACKS",

      productionApplied:
        false,
    };
  }

  const rows =
    events.map(
      (
        event,
      ) => ({
        batch_id:
          batch.id,

        decision_event_id:
          event
            .decision_event_id,

        decision_at:
          event
            .decision_at,

        decision_market_date:
          event
            .decision_market_date,

        decision_before_market_open:
          event
            .decision_before_market_open,

        forward_signal_event_id:
          event.id,

        automation_run_id:
          automationRunId,

        comparison_id:
          batch
            .comparison_id,

        signal_track_id:
          event
            .shadow_track_id,

        stock_code:
          event.stock_code,

        market_date:
          batch.market_date,

        signal_market_date:
          event
            .signal_market_date,

        signal_observed_at:
          event
            .signal_observed_at,

        signal_status:
          event.signal_status,

        signal_score:
          toNullableNumber(
            event.signal_score,
          ),

        reference_price:
          toNullableNumber(
            event
              .reference_price,
          ),

        agreement_state:
          batch
            .agreement_state,

        v6_would_block:
          batch
            .v6_would_block,

        v7_would_block:
          batch
            .v7_would_block,

        evaluation_status:
          "PENDING",

        is_validation:
          batch
            .is_validation,

        metadata: {
          version:
            "MARKET_REGIME_FORWARD_OUTCOME_V7_13",

          scope:
            "IMMUTABLE_ENTRY_DECISION_EVENT",

          cohortKey:
            "AUTOMATION_RUN_ID_PLUS_DECISION_EVENT_ID",

          automationRunId,

          batchId:
            batch.id,

          decisionEventId:
            event
              .decision_event_id,

          forwardSignalEventId:
            event.id,

          signalId:
            event.signal_id,

          signalTrackId:
            event
              .shadow_track_id,

          decisionAt:
            event
              .decision_at,

          decisionMarketDate:
            event
              .decision_market_date,

          decisionBeforeMarketOpen:
            event
              .decision_before_market_open,

          snapshotObservedAt:
            event
              .signal_observed_at,

          predictionId:
            event
              .prediction_id,

          forwardEntryConvention:
            "FIRST_TRADING_DAY_OPEN_NOT_BEFORE_DECISION_TIMESTAMP",

          productionApplied:
            false,

          exactPortfolioPnl:
            false,
        },
      }),
    );

  const {
    data: inserted,
    error: insertError,
  } =
    await supabase
      .from(
        "market_regime_shadow_outcomes",
      )
      .upsert(
        rows,
        {
          onConflict:
            "forward_signal_event_id",

          ignoreDuplicates:
            true,
        },
      )
      .select(`
        id,
        decision_event_id,
        stock_code,
        signal_track_id,
        forward_signal_event_id,
        decision_at,
        evaluation_status
      `);

  if (
    insertError
  ) {
    throw new Error(
      `v7.12 decision outcome link failed: ${insertError.message}`,
    );
  }

  /*
   * Reload to make retries idempotent and report total causal outcomes
   * for this automation run, not only newly inserted rows.
   */
  const {
    data: runOutcomes,
    error: runOutcomesError,
  } =
    await supabase
      .from(
        "market_regime_shadow_outcomes",
      )
      .select(
        "id,forward_signal_event_id",
      )
      .eq(
        "automation_run_id",
        automationRunId,
      );

  if (
    runOutcomesError
  ) {
    throw new Error(
      `v7.12 run outcome reload failed: ${runOutcomesError.message}`,
    );
  }

  const totalLinked =
    runOutcomes?.length ??
    0;

  await supabase
    .from(
      "market_regime_forward_batches",
    )
    .update({
      status:
        totalLinked >
          0
          ? "OUTCOMES_LINKED"
          : "SIGNALS_BOUND",

      updated_at:
        new Date()
          .toISOString(),
    })
    .eq(
      "id",
      batch.id,
    );

  return {
    version:
      "MARKET_REGIME_FORWARD_OUTCOME_LINK_V7_13",

    automationRunId,

    batchId:
      batch.id,

    comparisonId:
      batch
        .comparison_id,

    regimeMarketDate:
      batch.market_date,

    agreementState:
      batch
        .agreement_state,

    decisionEvents:
      allEvents.length,

    boundShadowTracks:
      events.length,

    newlyLinked:
      inserted?.length ??
      0,

    linked:
      totalLinked,

    duplicateSuppressed:
      events.length -
      (
        inserted?.length ??
        0
      ),

    causalIdentity:
      "IMMUTABLE_ENTRY_DECISION_EVENT",

    validation:
      batch
        .is_validation,

    productionApplied:
      false,
  };
}
