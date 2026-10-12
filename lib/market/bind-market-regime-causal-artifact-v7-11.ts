import {
  createSupabaseServerClient,
} from "@/lib/supabase";

interface BindInput {
  automationRunId:
    string;

  automationStartedAt:
    string;

  stepPath:
    string;

  stepOk:
    boolean;

  payload:
    unknown;
}

interface EntrySignalRow {
  id: string;

  model_id:
    string;

  stock_code:
    string;

  status:
    string;

  score:
    number | string | null;

  observed_at:
    string;

  recommended_entry_price:
    number | string | null;

  recommended_stop_price:
    number | string | null;

  recommended_quantity:
    number | string | null;

  created_at:
    string;
}

interface ShadowTrackRow {
  id: string;

  signal_id:
    string;

  stock_code:
    string;
}

function isRecord(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    typeof value ===
      "object" &&
    value !==
      null &&
    !Array.isArray(
      value,
    )
  );
}

function unwrapResult(
  payload: unknown,
) {
  if (
    !isRecord(
      payload,
    )
  ) {
    return null;
  }

  if (
    isRecord(
      payload.result,
    )
  ) {
    return payload.result;
  }

  return payload;
}

function stringOrNull(
  value: unknown,
) {
  return typeof value ===
    "string" &&
    value.trim()
      ? value.trim()
      : null;
}

function boolOrNull(
  value: unknown,
) {
  return typeof value ===
    "boolean"
      ? value
      : null;
}

function numberOrNull(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
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

function integerOrNull(
  value: unknown,
) {
  const parsed =
    numberOrNull(
      value,
    );

  if (
    parsed ===
      null
  ) {
    return null;
  }

  return Math.floor(
    parsed,
  );
}

function toSeoulParts(
  timestamp: string,
) {
  const parsed =
    new Date(
      timestamp,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    throw new Error(
      `INVALID_TIMESTAMP: ${timestamp}`,
    );
  }

  const shifted =
    new Date(
      parsed.getTime() +
        9 *
          60 *
          60 *
          1000,
    );

  return {
    date:
      shifted
        .toISOString()
        .slice(0, 10),

    hour:
      shifted
        .getUTCHours(),

    minute:
      shifted
        .getUTCMinutes(),
  };
}

function toSeoulSqlDate(
  timestamp: string,
) {
  return toSeoulParts(
    timestamp,
  ).date;
}

function decisionBeforeMarketOpen(
  timestamp: string,
) {
  const parts =
    toSeoulParts(
      timestamp,
    );

  return parts.hour <
    9;
}

function jsonArray(
  value: unknown,
) {
  return Array.isArray(
    value,
  )
    ? value
    : [];
}

function decisionFingerprint(
  input: {
    automationRunId:
      string;

    stockCode:
      string;

    signalId:
      string;

    predictionId:
      string | null;

    decisionAt:
      string;

    score:
      number | null;

    status:
      string;

    qualifies:
      boolean;
  },
) {
  return JSON.stringify(
    input,
  );
}

async function ensureBatch(
  automationRunId:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_regime_forward_batches",
      )
      .upsert(
        {
          automation_run_id:
            automationRunId,

          status:
            "OPEN",

          production_applied:
            false,

          updated_at:
            new Date()
              .toISOString(),
        },
        {
          onConflict:
            "automation_run_id",

          ignoreDuplicates:
            true,
        },
      )
      .select(
        "id,automation_run_id,status",
      )
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `v7.12 batch ensure failed: ${error.message}`,
    );
  }

  if (
    data
  ) {
    return data;
  }

  const {
    data: existing,
    error: existingError,
  } =
    await supabase
      .from(
        "market_regime_forward_batches",
      )
      .select(
        "id,automation_run_id,status",
      )
      .eq(
        "automation_run_id",
        automationRunId,
      )
      .single();

  if (
    existingError ||
    !existing
  ) {
    throw new Error(
      `v7.12 batch reload failed: ${
        existingError?.message ??
        "NO_BATCH"
      }`,
    );
  }

  return existing;
}

async function bindQualityGate(
  input:
    BindInput,

  result:
    Record<
      string,
      unknown
    >,
) {
  const supabase =
    createSupabaseServerClient();

  const batch =
    await ensureBatch(
      input
        .automationRunId,
    );

  const observationId =
    stringOrNull(
      result
        .observationId,
    );

  const gate =
    isRecord(
      result.gate,
    )
      ? result.gate
      : null;

  if (
    !gate
  ) {
    return {
      relevant:
        true,

      bound:
        false,

      reason:
        "QUALITY_GATE_PAYLOAD_MISSING",
    };
  }

  const status =
    stringOrNull(
      gate.status,
    );

  const usable =
    boolOrNull(
      gate
        .usableForForwardShadow,
    );

  const marketDate =
    stringOrNull(
      gate
        .expectedMarketDate,
    );

  const fingerprint =
    stringOrNull(
      gate
        .evidenceFingerprint,
    );

  const {
    error,
  } =
    await supabase
      .from(
        "market_regime_forward_batches",
      )
      .update({
        quality_gate_observation_id:
          observationId,

        market_date:
          marketDate,

        quality_gate_status:
          status,

        quality_gate_usable:
          usable,

        metadata: {
          version:
            "MARKET_REGIME_FORWARD_DECISION_IDENTITY_V7_12",

          qualityGateEvidenceFingerprint:
            fingerprint,

          qualityGateObservedInAutomation:
            true,
        },

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        batch.id,
      );

  if (
    error
  ) {
    throw new Error(
      `v7.12 quality gate bind failed: ${error.message}`,
    );
  }

  return {
    relevant:
      true,

    bound:
      true,

    type:
      "QUALITY_GATE",

    version:
      "V7_12",

    batchId:
      String(
        batch.id,
      ),

    observationId,

    status,
    usable,
    marketDate,
  };
}

async function bindComparator(
  input:
    BindInput,

  result:
    Record<
      string,
      unknown
    >,
) {
  const supabase =
    createSupabaseServerClient();

  const batch =
    await ensureBatch(
      input
        .automationRunId,
    );

  const comparisonId =
    stringOrNull(
      result
        .comparisonId,
    );

  const comparison =
    isRecord(
      result
        .comparison,
    )
      ? result
          .comparison
      : null;

  if (
    !comparisonId ||
    !comparison
  ) {
    return {
      relevant:
        true,

      bound:
        false,

      reason:
        "COMPARATOR_PAYLOAD_MISSING",
    };
  }

  const eligible =
    boolOrNull(
      comparison
        .comparisonEligible,
    ) ===
      true;

  const agreementState =
    stringOrNull(
      comparison
        .agreementState,
    );

  const v6 =
    isRecord(
      comparison.v6,
    )
      ? comparison.v6
      : {};

  const v7 =
    isRecord(
      comparison.v7,
    )
      ? comparison.v7
      : {};

  const marketDate =
    stringOrNull(
      v7.latestMarketDate,
    );

  const qualityUsable =
    isRecord(
      comparison
        .dataQualityGate,
    )
      ? boolOrNull(
          comparison
            .dataQualityGate
            .usableForForwardShadow,
        ) ===
        true
      : false;

  const ready =
    eligible &&
    qualityUsable;

  const {
    error,
  } =
    await supabase
      .from(
        "market_regime_forward_batches",
      )
      .update({
        comparison_id:
          comparisonId,

        market_date:
          marketDate,

        comparison_eligible:
          eligible,

        agreement_state:
          agreementState,

        v6_would_block:
          boolOrNull(
            v6.wouldBlock,
          ),

        v7_would_block:
          boolOrNull(
            v7.wouldBlock,
          ),

        v7_policy:
          stringOrNull(
            v7.policy,
          ),

        status:
          ready
            ? "READY"
            : "INELIGIBLE",

        metadata: {
          version:
            "MARKET_REGIME_FORWARD_DECISION_IDENTITY_V7_12",

          comparatorVersion:
            stringOrNull(
              comparison
                .version,
            ),

          comparatorObservedAt:
            stringOrNull(
              comparison
                .observedAt,
            ),

          comparisonDuplicateSuppressed:
            boolOrNull(
              result
                .duplicateSuppressed,
            ),

          qualityGateUsable:
            qualityUsable,
        },

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        batch.id,
      );

  if (
    error
  ) {
    throw new Error(
      `v7.12 comparator bind failed: ${error.message}`,
    );
  }

  return {
    relevant:
      true,

    bound:
      true,

    type:
      "COMPARATOR",

    version:
      "V7_12",

    batchId:
      String(
        batch.id,
      ),

    comparisonId,

    ready,

    agreementState,
    marketDate,
  };
}

async function bindEntryDecisions(
  input:
    BindInput,

  result:
    Record<
      string,
      unknown
    >,
) {
  const supabase =
    createSupabaseServerClient();

  const batch =
    await ensureBatch(
      input
        .automationRunId,
    );

  const {
    data: batchData,
    error: batchError,
  } =
    await supabase
      .from(
        "market_regime_forward_batches",
      )
      .select(
        "id,status,comparison_id,market_date",
      )
      .eq(
        "id",
        batch.id,
      )
      .single();

  if (
    batchError ||
    !batchData
  ) {
    throw new Error(
      `v7.12 batch read failed before decision bind: ${
        batchError?.message ??
        "NO_BATCH"
      }`,
    );
  }

  const signals =
    Array.isArray(
      result.signals,
    )
      ? result.signals
      : [];

  if (
    signals.length ===
      0
  ) {
    await supabase
      .from(
        "market_regime_forward_batches",
      )
      .update({
        status:
          "NO_FRESH_SIGNAL",

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        batch.id,
      );

    return {
      relevant:
        true,

      bound:
        true,

      type:
        "ENTRY_DECISIONS",

      version:
        "V7_12",

      decisionsRecorded:
        0,

      forwardEligibleDecisions:
        0,

      forwardEvents:
        0,

      reason:
        "ENTRY_STEP_RETURNED_NO_DECISIONS",
    };
  }

  const normalizedSignals =
    signals
      .map(
        (
          raw,
        ) => {
          if (
            !isRecord(
              raw,
            )
          ) {
            return null;
          }

          const signalId =
            stringOrNull(
              raw.signalId,
            );

          const stockCode =
            stringOrNull(
              raw.stockCode,
            );

          const status =
            stringOrNull(
              raw.status,
            );

          if (
            !signalId ||
            !stockCode ||
            !status
          ) {
            return null;
          }

          return {
            raw,
            signalId,
            stockCode,
            status,

            score:
              numberOrNull(
                raw.score,
              ),

            qualifies:
              boolOrNull(
                raw.qualifies,
              ) ===
              true,
          };
        },
      )
      .filter(
        (
          item,
        ): item is NonNullable<
          typeof item
        > =>
          item !==
          null,
      );

  if (
    normalizedSignals.length ===
      0
  ) {
    throw new Error(
      "v7.12 entry step returned signals but none had signalId/stockCode/status.",
    );
  }

  const signalIds =
    normalizedSignals.map(
      (
        item,
      ) =>
        item.signalId,
    );

  const {
    data: signalData,
    error: signalError,
  } =
    await supabase
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
      .in(
        "id",
        signalIds,
      );

  if (
    signalError
  ) {
    throw new Error(
      `v7.12 entry signal state load failed: ${signalError.message}`,
    );
  }

  const signalRows =
    (
      signalData ??
      []
    ) as EntrySignalRow[];

  const signalById =
    new Map(
      signalRows.map(
        (
          row,
        ) => [
          row.id,
          row,
        ],
      ),
    );

  const model =
    isRecord(
      result.model,
    )
      ? result.model
      : {};

  const predictionGate =
    isRecord(
      result
        .predictionGate,
    )
      ? result
          .predictionGate
      : {};

  const threshold =
    numberOrNull(
      result.threshold,
    );

  /*
   * The binder executes only after the entry step has returned.
   * Using the binder timestamp is intentionally conservative:
   * it can only make the causal decision timestamp later, never earlier.
   */
  const decisionAt =
    new Date()
      .toISOString();

  const decisionMarketDate =
    toSeoulSqlDate(
      decisionAt,
    );

  const beforeMarketOpen =
    decisionBeforeMarketOpen(
      decisionAt,
    );

  const decisionRows:
    Array<
      Record<
        string,
        unknown
      >
    > = [];

  for (
    const item
    of normalizedSignals
  ) {
    const signal =
      signalById.get(
        item.signalId,
      );

    if (
      !signal
    ) {
      throw new Error(
        `v7.12 signal row not found for returned signalId=${item.signalId}`,
      );
    }

    const features =
      isRecord(
        item.raw.features,
      )
        ? item.raw.features
        : {};

    const prediction =
      isRecord(
        features.prediction,
      )
        ? features.prediction
        : {};

    const predictionId =
      stringOrNull(
        prediction
          .predictionId,
      );

    const predictionGeneratedAt =
      stringOrNull(
        prediction
          .generatedAt,
      ) ??
      stringOrNull(
        predictionGate
          .generatedAt,
      );

    const predictionDate =
      stringOrNull(
        predictionGate
          .predictionDate,
      );

    const predictionModelName =
      stringOrNull(
        prediction
          .modelName,
      ) ??
      stringOrNull(
        predictionGate
          .modelName,
      );

    const predictionModelVersion =
      stringOrNull(
        prediction
          .modelVersion,
      ) ??
      stringOrNull(
        predictionGate
          .modelVersion,
      );

    const forwardEligible =
      batchData.status ===
        "READY" &&
      item.qualifies &&
      (
        item.status ===
          "GENERATED" ||
        item.status ===
          "ORDER_CREATED"
      );

    decisionRows.push({
      automation_run_id:
        input
          .automationRunId,

      batch_id:
        batch.id,

      signal_id:
        signal.id,

      entry_model_id:
        signal
          .model_id,

      stock_code:
        item.stockCode,

      decision_at:
        decisionAt,

      decision_market_date:
        decisionMarketDate,

      decision_before_market_open:
        beforeMarketOpen,

      signal_status:
        item.status,

      qualifies:
        item.qualifies,

      forward_eligible:
        forwardEligible,

      score:
        item.score,

      threshold,

      snapshot_observed_at:
        signal
          .observed_at,

      reference_price:
        numberOrNull(
          signal
            .recommended_entry_price,
        ),

      recommended_stop_price:
        numberOrNull(
          signal
            .recommended_stop_price,
        ),

      recommended_quantity:
        integerOrNull(
          signal
            .recommended_quantity,
        ),

      prediction_id:
        predictionId,

      prediction_generated_at:
        predictionGeneratedAt,

      prediction_date:
        predictionDate,

      prediction_model_name:
        predictionModelName,

      prediction_model_version:
        predictionModelVersion,

      prediction_score:
        numberOrNull(
          prediction.score,
        ),

      prediction_confidence:
        numberOrNull(
          prediction
            .confidence,
        ),

      features:
        item.raw
          .features ??
        {},

      reasons:
        jsonArray(
          item.raw
            .reasons,
        ),

      decision_fingerprint:
        decisionFingerprint({
          automationRunId:
            input
              .automationRunId,

          stockCode:
            item
              .stockCode,

          signalId:
            signal.id,

          predictionId,

          decisionAt,

          score:
            item.score,

          status:
            item.status,

          qualifies:
            item.qualifies,
        }),

      production_applied:
        false,
    });
  }

  const {
    data: savedDecisions,
    error: decisionError,
  } =
    await supabase
      .from(
        "entry_decision_events",
      )
      .upsert(
        decisionRows,
        {
          onConflict:
            "automation_run_id,stock_code",

          ignoreDuplicates:
            true,
        },
      )
      .select(`
        id,
        signal_id,
        stock_code,
        signal_status,
        qualifies,
        forward_eligible,
        decision_at,
        decision_market_date,
        decision_before_market_open,
        snapshot_observed_at,
        reference_price,
        prediction_id,
        created_at
      `);

  if (
    decisionError
  ) {
    throw new Error(
      `v7.12 entry decision save failed: ${decisionError.message}`,
    );
  }

  /*
   * Upsert(ignoreDuplicates) may return only newly inserted rows.
   * Reload the whole automation-run set so retries remain deterministic.
   */
  const {
    data: allDecisionsData,
    error: allDecisionsError,
  } =
    await supabase
      .from(
        "entry_decision_events",
      )
      .select(`
        id,
        signal_id,
        stock_code,
        signal_status,
        qualifies,
        forward_eligible,
        decision_at,
        decision_market_date,
        decision_before_market_open,
        snapshot_observed_at,
        reference_price,
        prediction_id,
        created_at
      `)
      .eq(
        "automation_run_id",
        input
          .automationRunId,
      )
      .order(
        "created_at",
        {
          ascending:
            true,
        },
      );

  if (
    allDecisionsError
  ) {
    throw new Error(
      `v7.12 entry decision reload failed: ${allDecisionsError.message}`,
    );
  }

  const allDecisions =
    allDecisionsData ??
    [];

  const eligibleDecisions =
    allDecisions.filter(
      (
        decision,
      ) =>
        decision
          .forward_eligible ===
        true,
    );

  const sourceSignalById =
    new Map(
      signalRows.map(
        (
          row,
        ) => [
          row.id,
          row,
        ],
      ),
    );

  const forwardRows =
    eligibleDecisions.map(
      (
        decision,
      ) => {
        const signalId =
          String(
            decision
              .signal_id,
          );

        const sourceSignal =
          sourceSignalById.get(
            signalId,
          );

        if (
          !sourceSignal
        ) {
          throw new Error(
            `v7.12 source signal missing while creating forward event: ${signalId}`,
          );
        }

        return {
          batch_id:
            batch.id,

          automation_run_id:
            input
              .automationRunId,

          decision_event_id:
            decision.id,

          decision_at:
            decision
              .decision_at,

          decision_market_date:
            decision
              .decision_market_date,

          decision_before_market_open:
            decision
              .decision_before_market_open,

          prediction_id:
            decision
              .prediction_id,

          signal_id:
            sourceSignal.id,

          stock_code:
            sourceSignal
              .stock_code,

          signal_status:
            decision
              .signal_status,

          signal_score:
            numberOrNull(
              sourceSignal
                .score,
            ),

          signal_observed_at:
            sourceSignal
              .observed_at,

          /*
           * Kept for backward compatibility.
           * v7.12 evaluation uses decision_at instead.
           */
          signal_market_date:
            toSeoulSqlDate(
              sourceSignal
                .observed_at,
            ),

          reference_price:
            numberOrNull(
              sourceSignal
                .recommended_entry_price,
            ),

          /*
           * Historical signal row creation time can be old when the signal
           * row was reused. This is intentionally retained for audit only.
           */
          signal_created_at:
            sourceSignal
              .created_at,

          metadata: {
            version:
              "MARKET_REGIME_FORWARD_DECISION_IDENTITY_V7_12",

            causalIdentity:
              "IMMUTABLE_ENTRY_DECISION_EVENT",

            signalRowMayBeReused:
              true,

            decisionEventId:
              decision.id,

            decisionAt:
              decision
                .decision_at,

            decisionMarketDate:
              decision
                .decision_market_date,

            decisionBeforeMarketOpen:
              decision
                .decision_before_market_open,

            snapshotObservedAt:
              sourceSignal
                .observed_at,

            predictionId:
              decision
                .prediction_id,

            productionApplied:
              false,
          },

          production_applied:
            false,

          updated_at:
            new Date()
              .toISOString(),
        };
      },
    );

  let forwardEvents:
    Array<
      Record<
        string,
        unknown
      >
    > = [];

  if (
    forwardRows.length >
      0
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "market_regime_forward_signal_events",
        )
        .upsert(
          forwardRows,
          {
            onConflict:
              "decision_event_id",

            ignoreDuplicates:
              true,
          },
        )
        .select(
          "id,decision_event_id,signal_id,stock_code",
        );

    if (
      error
    ) {
      throw new Error(
        `v7.12 forward decision event save failed: ${error.message}`,
      );
    }

    forwardEvents =
      (
        data ??
        []
      ) as Array<
        Record<
          string,
          unknown
        >
      >;
  }

  const nextBatchStatus =
    allDecisions.length ===
      0
      ? "NO_FRESH_SIGNAL"
      : eligibleDecisions.length ===
        0
        ? "NO_FORWARD_ELIGIBLE_DECISION"
        : "SIGNALS_BOUND";

  const {
    error: batchUpdateError,
  } =
    await supabase
      .from(
        "market_regime_forward_batches",
      )
      .update({
        status:
          nextBatchStatus,

        updated_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        batch.id,
      );

  if (
    batchUpdateError
  ) {
    throw new Error(
      `v7.12 batch decision status update failed: ${batchUpdateError.message}`,
    );
  }

  return {
    relevant:
      true,

    bound:
      true,

    type:
      "ENTRY_DECISIONS",

    version:
      "V7_12",

    batchId:
      String(
        batch.id,
      ),

    returnedSignals:
      normalizedSignals.length,

    decisionsRecorded:
      allDecisions.length,

    newlyInsertedDecisions:
      savedDecisions?.length ??
      0,

    forwardEligibleDecisions:
      eligibleDecisions.length,

    forwardEvents:
      forwardEvents.length,

    batchStatus:
      nextBatchStatus,

    reusedSignalRowsAllowed:
      true,

    causalIdentity:
      "IMMUTABLE_ENTRY_DECISION_EVENT",
  };
}

async function bindShadowTracks(
  input:
    BindInput,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data: eventsData,
    error: eventsError,
  } =
    await supabase
      .from(
        "market_regime_forward_signal_events",
      )
      .select(
        "id,decision_event_id,signal_id,stock_code,shadow_track_id",
      )
      .eq(
        "automation_run_id",
        input
          .automationRunId,
      );

  if (
    eventsError
  ) {
    throw new Error(
      `v7.12 forward events load failed: ${eventsError.message}`,
    );
  }

  const events =
    eventsData ??
    [];

  if (
    events.length ===
      0
  ) {
    return {
      relevant:
        true,

      bound:
        true,

      type:
        "SHADOW_TRACKS",

      version:
        "V7_12",

      events:
        0,

      tracksBound:
        0,

      reason:
        "NO_FORWARD_ELIGIBLE_DECISION_EVENTS_IN_RUN",
    };
  }

  const signalIds =
    [
      ...new Set(
        events.map(
          (
            event,
          ) =>
            String(
              event
                .signal_id,
            ),
        ),
      ),
    ];

  const {
    data: tracksData,
    error: tracksError,
  } =
    await supabase
      .from(
        "shadow_signal_tracks",
      )
      .select(
        "id,signal_id,stock_code",
      )
      .in(
        "signal_id",
        signalIds,
      );

  if (
    tracksError
  ) {
    throw new Error(
      `v7.12 shadow track lookup failed: ${tracksError.message}`,
    );
  }

  const tracks =
    (
      tracksData ??
      []
    ) as ShadowTrackRow[];

  const trackBySignal =
    new Map(
      tracks.map(
        (
          track,
        ) => [
          track.signal_id,
          track,
        ],
      ),
    );

  let tracksBound =
    0;

  for (
    const event
    of events
  ) {
    const signalId =
      String(
        event.signal_id,
      );

    const track =
      trackBySignal.get(
        signalId,
      );

    if (
      !track
    ) {
      continue;
    }

    const {
      error,
    } =
      await supabase
        .from(
          "market_regime_forward_signal_events",
        )
        .update({
          shadow_track_id:
            track.id,

          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          event.id,
        );

    if (
      error
    ) {
      throw new Error(
        `v7.12 shadow track bind failed: ${error.message}`,
      );
    }

    tracksBound +=
      1;
  }

  return {
    relevant:
      true,

    bound:
      true,

    type:
      "SHADOW_TRACKS",

    version:
      "V7_12",

    events:
      events.length,

    tracksFound:
      tracks.length,

    tracksBound,

    reusedShadowTrackAllowedAcrossDecisionEvents:
      true,
  };
}

/*
 * Export name remains V711 for route compatibility.
 * Behavior/version is v7.12 Decision Event Identity.
 */
export async function bindMarketRegimeCausalArtifactV711(
  input:
    BindInput,
) {
  if (
    !input.stepOk
  ) {
    return {
      relevant:
        false,

      bound:
        false,

      reason:
        "STEP_FAILED",
    };
  }

  const result =
    unwrapResult(
      input.payload,
    );

  if (
    !result
  ) {
    return {
      relevant:
        false,

      bound:
        false,

      reason:
        "NO_RESULT_PAYLOAD",
    };
  }

  if (
    input.stepPath ===
      "/api/market/regime/v7/quality-gate/capture"
  ) {
    return bindQualityGate(
      input,
      result,
    );
  }

  if (
    input.stepPath ===
      "/api/market/regime/v7/shadow/capture"
  ) {
    return bindComparator(
      input,
      result,
    );
  }

  if (
    input.stepPath ===
      "/api/signals/entry/generate"
  ) {
    return bindEntryDecisions(
      input,
      result,
    );
  }

  if (
    input.stepPath ===
      "/api/signals/shadow/capture"
  ) {
    return bindShadowTracks(
      input,
    );
  }

  return {
    relevant:
      false,

    bound:
      false,

    reason:
      "STEP_NOT_CAUSAL_BINDING_TARGET",
  };
}