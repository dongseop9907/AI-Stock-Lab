import {
  createSupabaseServerClient,
} from "@/lib/supabase";

type EventRow = {
  id:
    string;

  stock_code:
    string;

  action_type:
    string;

  effective_date:
    string;

  ratio_from:
    number | string | null;

  ratio_to:
    number | string | null;

  status:
    string;

  provider:
    string;
};

function num(
  value:
    unknown,
) {
  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
}

export async function buildCorporateActionAdjustmentV94(
  input: {
    stockCode:
      string;

    isValidation?:
      boolean;
  },
) {
  const supabase =
    createSupabaseServerClient();

  const stockCode =
    input
      .stockCode
      .trim();

  const isValidation =
    input.isValidation ===
    true;

  if (
    !stockCode
  ) {
    throw new Error(
      "V9_4_STOCK_CODE_REQUIRED",
    );
  }

  const {
    data: eventData,
    error: eventError,
  } =
    await supabase
      .from(
        "corporate_action_events",
      )
      .select(`
        id,
        stock_code,
        action_type,
        effective_date,
        ratio_from,
        ratio_to,
        status,
        provider
      `)
      .eq(
        "stock_code",
        stockCode,
      )
      .eq(
        "is_validation",
        isValidation,
      )
      .order(
        "effective_date",
        {
          ascending:
            false,
        },
      )
      .order(
        "id",
        {
          ascending:
            false,
        },
      );

  if (
    eventError
  ) {
    throw new Error(
      `v9.4 event load failed: ${eventError.message}`,
    );
  }

  const events =
    (
      eventData ??
      []
    ) as EventRow[];

  const supported =
    events.filter(
      (
        event,
      ) =>
        (
          event.action_type ===
            "STOCK_SPLIT" ||
          event.action_type ===
            "REVERSE_SPLIT"
        ) &&
        event.status ===
          "SUPPORTED",
    );

  const unsupported =
    events.filter(
      (
        event,
      ) =>
        !supported.some(
          (
            item,
          ) =>
            item.id ===
            event.id,
        ),
    );

  const {
    data: run,
    error: runError,
  } =
    await supabase
      .from(
        "corporate_action_adjustment_runs",
      )
      .insert({
        stock_code:
          stockCode,

        version:
          "CORPORATE_ACTION_ADJUSTMENT_V9_4",

        status:
          "RUNNING",

        event_count:
          events.length,

        supported_event_count:
          supported.length,

        unsupported_event_count:
          unsupported.length,

        summary: {
          policy:
            "SPLIT_ONLY",

          unsupportedEventsExcluded:
            unsupported.length,

          rawBarsModified:
            false,
        },

        is_validation:
          isValidation,

        production_applied:
          false,
      })
      .select(
        "id",
      )
      .single();

  if (
    runError ||
    !run
  ) {
    throw new Error(
      `v9.4 adjustment-run create failed: ${
        runError?.message ??
        "NO_RUN"
      }`,
    );
  }

  const runId =
    String(
      run.id,
    );

  try {
    let cumulativePriceFactor =
      1;

    let cumulativeShareFactor =
      1;

    const factorRows =
      supported.map(
        (
          event,
        ) => {
          const ratioFrom =
            num(
              event.ratio_from,
            );

          const ratioTo =
            num(
              event.ratio_to,
            );

          if (
            !ratioFrom ||
            !ratioTo ||
            ratioFrom <=
              0 ||
            ratioTo <=
              0
          ) {
            throw new Error(
              `V9_4_INVALID_RATIO_EVENT_${event.id}`,
            );
          }

          const eventPriceFactor =
            ratioFrom /
            ratioTo;

          const eventShareFactor =
            ratioTo /
            ratioFrom;

          cumulativePriceFactor *=
            eventPriceFactor;

          cumulativeShareFactor *=
            eventShareFactor;

          return {
            adjustment_run_id:
              runId,

            stock_code:
              stockCode,

            effective_date:
              event.effective_date,

            action_event_id:
              event.id,

            action_type:
              event.action_type,

            event_price_factor:
              eventPriceFactor,

            event_share_factor:
              eventShareFactor,

            cumulative_price_factor:
              cumulativePriceFactor,

            cumulative_share_factor:
              cumulativeShareFactor,

            metadata: {
              provider:
                event.provider,

              intervalSemantics:
                "APPLIES_TO_BARS_STRICTLY_BEFORE_EFFECTIVE_DATE",
            },

            is_validation:
              isValidation,

            production_applied:
              false,
          };
        },
      );

    if (
      factorRows.length >
      0
    ) {
      const {
        error,
      } =
        await supabase
          .from(
            "corporate_action_adjustment_factors",
          )
          .insert(
            factorRows,
          );

      if (
        error
      ) {
        throw new Error(
          `v9.4 factor insert failed: ${error.message}`,
        );
      }
    }

    const summary = {
      stockCode,

      policy:
        "SPLIT_ONLY",

      supportedEventCount:
        supported.length,

      unsupportedEventCount:
        unsupported.length,

      latestToEarliestFactors:
        factorRows.map(
          (
            factor,
          ) => ({
            effectiveDate:
              factor.effective_date,

            actionType:
              factor.action_type,

            eventPriceFactor:
              factor.event_price_factor,

            eventShareFactor:
              factor.event_share_factor,

            cumulativePriceFactor:
              factor.cumulative_price_factor,

            cumulativeShareFactor:
              factor.cumulative_share_factor,
          }),
        ),

      unsupportedActionsRecordedButNotAdjusted:
        unsupported.map(
          (
            event,
          ) => ({
            id:
              event.id,

            actionType:
              event.action_type,

            effectiveDate:
              event.effective_date,
          }),
        ),

      rawBarsModified:
        false,

      productionApplied:
        false,
    };

    const {
      error: finishError,
    } =
      await supabase
        .rpc(
          "finish_corporate_action_adjustment_run_v9_4",
          {
            p_run_id:
              runId,

            p_status:
              "READY",

            p_factor_count:
              factorRows.length,

            p_summary:
              summary,

            p_error_message:
              null,
          },
        );

    if (
      finishError
    ) {
      throw new Error(
        `v9.4 run finish failed: ${finishError.message}`,
      );
    }

    return {
      version:
        "CORPORATE_ACTION_ADJUSTMENT_V9_4",

      runId,

      status:
        "READY",

      summary,

      safety: {
        rawMarketDailyBarsModified:
          false,

        unsupportedEventsAutomaticallyAdjusted:
          false,

        productionApplied:
          false,
      },
    };
  } catch (
    error
  ) {
    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_V9_4_ADJUSTMENT_ERROR";

    await supabase
      .rpc(
        "finish_corporate_action_adjustment_run_v9_4",
        {
          p_run_id:
            runId,

          p_status:
            "FAILED",

          p_factor_count:
            0,

          p_summary:
            {
              productionApplied:
                false,
            },

          p_error_message:
            message,
        },
      );

    throw error;
  }
}
