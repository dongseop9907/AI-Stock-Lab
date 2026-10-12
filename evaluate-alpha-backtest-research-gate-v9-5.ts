import {
  createSupabaseServerClient,
} from "@/lib/supabase";

type GateInput = {
  universeCode?:
    string;

  startDate?:
    string;

  endDate?:
    string;
};

function requireDate(
  value:
    string,
  name:
    string,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    throw new Error(
      `INVALID_${name}`,
    );
  }

  return value;
}

export async function evaluateAlphaBacktestResearchGateV95(
  input:
    GateInput = {},
) {
  const supabase =
    createSupabaseServerClient();

  const universeCode =
    input
      .universeCode
      ?.trim() ||
    "KRX_ALL_LISTED";

  const startDate =
    requireDate(
      input.startDate ??
        "2023-01-02",
      "START_DATE",
    );

  const endDate =
    requireDate(
      input.endDate ??
        "2026-07-31",
      "END_DATE",
    );

  if (
    startDate >
    endDate
  ) {
    throw new Error(
      "V9_5_START_DATE_AFTER_END_DATE",
    );
  }

  const [
    validationPlanResult,
    pitCompilationResult,
    marketCoverageResult,
    corporateCoverageResult,
    corporateValidationResult,
  ] =
    await Promise.all([
      supabase
        .from(
          "alpha_validation_plans",
        )
        .select(`
          id,
          status,
          requested_start_date,
          requested_end_date,
          fold_count,
          pit_ready_fold_count,
          pit_blocked_fold_count,
          created_at
        `)
        .eq(
          "universe_code",
          universeCode,
        )
        .lte(
          "requested_start_date",
          startDate,
        )
        .gte(
          "requested_end_date",
          endDate,
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          },
        )
        .limit(1)
        .maybeSingle(),

      supabase
        .from(
          "historical_universe_compilation_runs",
        )
        .select(`
          id,
          provider,
          status,
          start_date,
          end_date,
          expected_trading_dates,
          imported_complete_dates,
          missing_trading_dates,
          duplicate_complete_dates,
          compiled_interval_count,
          started_at
        `)
        .eq(
          "universe_code",
          universeCode,
        )
        .eq(
          "is_validation",
          false,
        )
        .lte(
          "start_date",
          startDate,
        )
        .gte(
          "end_date",
          endDate,
        )
        .order(
          "started_at",
          {
            ascending:
              false,
          },
        )
        .limit(1)
        .maybeSingle(),

      supabase
        .from(
          "historical_market_data_coverage_assertions",
        )
        .select(`
          id,
          provider,
          coverage_status,
          start_date,
          end_date,
          observed_member_count,
          data_ready_member_count,
          observed_coverage_rate,
          minimum_required_rate,
          created_at
        `)
        .eq(
          "universe_code",
          universeCode,
        )
        .eq(
          "is_validation",
          false,
        )
        .lte(
          "start_date",
          startDate,
        )
        .gte(
          "end_date",
          endDate,
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          },
        )
        .limit(1)
        .maybeSingle(),

      supabase
        .from(
          "corporate_action_coverage_assertions",
        )
        .select(`
          id,
          provider,
          coverage_status,
          start_date,
          end_date,
          supported_action_types,
          unsupported_action_types,
          created_at
        `)
        .eq(
          "universe_code",
          universeCode,
        )
        .eq(
          "is_validation",
          false,
        )
        .lte(
          "start_date",
          startDate,
        )
        .gte(
          "end_date",
          endDate,
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          },
        )
        .limit(1)
        .maybeSingle(),

      supabase
        .from(
          "corporate_action_validation_runs",
        )
        .select(`
          id,
          status,
          cleanup_succeeded,
          created_at
        `)
        .order(
          "created_at",
          {
            ascending:
              false,
          },
        )
        .limit(1)
        .maybeSingle(),
    ]);

  const queryErrors = [
    validationPlanResult.error,
    pitCompilationResult.error,
    marketCoverageResult.error,
    corporateCoverageResult.error,
    corporateValidationResult.error,
  ].filter(
    Boolean,
  );

  if (
    queryErrors.length >
    0
  ) {
    throw new Error(
      `v9.5 readiness query failed: ${
        queryErrors
          .map(
            (
              error,
            ) =>
              error?.message,
          )
          .join(
            " | ",
          )
      }`,
    );
  }

  const validationPlan =
    validationPlanResult.data;

  const pitCompilation =
    pitCompilationResult.data;

  const marketCoverage =
    marketCoverageResult.data;

  const corporateCoverage =
    corporateCoverageResult.data;

  const corporateValidation =
    corporateValidationResult.data;

  const checks = {
    purgedValidationPlanReady: {
      passed:
        validationPlan
          ?.status ===
        "READY",

      evidence:
        validationPlan ??
        null,
    },

    historicalPitCompilationReady: {
      passed:
        pitCompilation
          ?.status ===
          "READY" &&
        Number(
          pitCompilation
            ?.missing_trading_dates ??
          1,
        ) ===
          0 &&
        Number(
          pitCompilation
            ?.duplicate_complete_dates ??
          1,
        ) ===
          0,

      evidence:
        pitCompilation ??
        null,
    },

    historicalMarketDataCoverageReady: {
      passed:
        marketCoverage
          ?.coverage_status ===
          "COMPLETE" &&
        Number(
          marketCoverage
            ?.observed_coverage_rate ??
          0,
        ) >=
          Number(
            marketCoverage
              ?.minimum_required_rate ??
            1,
          ),

      evidence:
        marketCoverage ??
        null,
    },

    corporateActionDatasetCoverageReady: {
      passed:
        corporateCoverage
          ?.coverage_status ===
        "COMPLETE",

      evidence:
        corporateCoverage ??
        null,
    },

    corporateActionEngineValidated: {
      passed:
        corporateValidation
          ?.status ===
          "PASS" &&
        corporateValidation
          ?.cleanup_succeeded ===
          true,

      evidence:
        corporateValidation ??
        null,
    },

    automaticBacktestDisabled: {
      passed:
        true,
    },

    productionNotApplied: {
      passed:
        true,
    },
  };

  const blockers:
    string[] = [];

  if (
    !checks
      .purgedValidationPlanReady
      .passed
  ) {
    blockers.push(
      "PURGED_VALIDATION_PLAN_NOT_READY",
    );
  }

  if (
    !checks
      .historicalPitCompilationReady
      .passed
  ) {
    blockers.push(
      "HISTORICAL_PIT_NOT_READY",
    );
  }

  if (
    !checks
      .historicalMarketDataCoverageReady
      .passed
  ) {
    blockers.push(
      "HISTORICAL_MARKET_DATA_COVERAGE_NOT_READY",
    );
  }

  if (
    !checks
      .corporateActionDatasetCoverageReady
      .passed
  ) {
    blockers.push(
      "CORPORATE_ACTION_DATASET_COVERAGE_NOT_READY",
    );
  }

  if (
    !checks
      .corporateActionEngineValidated
      .passed
  ) {
    blockers.push(
      "CORPORATE_ACTION_ENGINE_NOT_VALIDATED",
    );
  }

  const status =
    blockers.length ===
      0
      ? "READY"
      : "BLOCKED";

  const {
    data: gateRun,
    error: gateRunError,
  } =
    await supabase
      .from(
        "alpha_backtest_research_gate_runs",
      )
      .insert({
        gate_version:
          "ALPHA_BACKTEST_RESEARCH_GATE_V9_5",

        universe_code:
          universeCode,

        requested_start_date:
          startDate,

        requested_end_date:
          endDate,

        status,

        checks,

        blockers,

        automatic_backtest_started:
          false,

        production_applied:
          false,
      })
      .select(
        "id,created_at",
      )
      .single();

  if (
    gateRunError ||
    !gateRun
  ) {
    throw new Error(
      `v9.5 gate audit insert failed: ${
        gateRunError?.message ??
        "NO_GATE_RUN"
      }`,
    );
  }

  return {
    version:
      "ALPHA_BACKTEST_RESEARCH_GATE_V9_5",

    gateRunId:
      gateRun.id,

    status,

    universeCode,

    requestedRange: {
      startDate,
      endDate,
    },

    checks,

    blockers,

    interpretation:
      status ===
        "READY"
        ? "All required historical-research evidence is present. A later research backtest may be started explicitly."
        : "Historical Alpha backtesting remains blocked. Missing evidence must be resolved instead of bypassing the gate.",

    safety: {
      automaticBacktestStarted:
        false,

      gateBypassImplemented:
        false,

      productionApplied:
        false,
    },
  };
}
