import {
  createSupabaseServerClient,
} from "@/lib/supabase";

const DEFAULT_REQUIRED_ACTION_TYPES = [
  "STOCK_SPLIT",
  "REVERSE_SPLIT",
  "CASH_DIVIDEND",
  "STOCK_DIVIDEND",
  "RIGHTS_ISSUE",
  "SPIN_OFF",
  "MERGER",
] as const;

type CompilationRow = {
  id:
    string;

  universe_code:
    string;

  provider:
    string;

  start_date:
    string;

  end_date:
    string;

  status:
    string;

  is_validation:
    boolean;
};

type SourceCoverageRow = {
  id:
    string;

  universe_code:
    string;

  provider:
    string;

  provider_version:
    string;

  start_date:
    string;

  end_date:
    string;

  coverage_status:
    string;

  markets:
    unknown;

  action_types:
    unknown;

  source_fingerprint:
    string;

  evidence:
    unknown;

  is_validation:
    boolean;
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

function stringArray(
  value:
    unknown,
) {
  return Array.isArray(
    value,
  )
    ? [
        ...new Set(
          value
            .map(
              (
                item,
              ) =>
                String(
                  item,
                ).trim(),
            )
            .filter(
              Boolean,
            ),
        ),
      ]
    : [];
}

async function resolveCompilation(
  input: {
    compilationRunId?:
      string;

    universeCode:
      string;

    startDate:
      string;

    endDate:
      string;

    isValidation:
      boolean;
  },
) {
  const supabase =
    createSupabaseServerClient();

  let query =
    supabase
      .from(
        "historical_universe_compilation_runs",
      )
      .select(`
        id,
        universe_code,
        provider,
        start_date,
        end_date,
        status,
        is_validation
      `)
      .eq(
        "is_validation",
        input.isValidation,
      );

  if (
    input.compilationRunId
  ) {
    query =
      query.eq(
        "id",
        input.compilationRunId,
      );
  } else {
    query =
      query
        .eq(
          "universe_code",
          input.universeCode,
        )
        .lte(
          "start_date",
          input.startDate,
        )
        .gte(
          "end_date",
          input.endDate,
        );
  }

  const {
    data,
    error,
  } =
    await query
      .order(
        "started_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `v9.7 PIT compilation lookup failed: ${error.message}`,
    );
  }

  return (
    data ??
    null
  ) as CompilationRow | null;
}

async function loadPitIdentity(
  compilationRunId:
    string,
  startDate:
    string,
  endDate:
    string,
) {
  const supabase =
    createSupabaseServerClient();

  const members =
    new Set<string>();

  const markets =
    new Set<string>();

  const pageSize =
    1000;

  for (
    let offset =
      0;
    ;
    offset +=
      pageSize
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "historical_universe_compiled_memberships",
        )
        .select(
          "stock_code,market",
        )
        .eq(
          "compilation_run_id",
          compilationRunId,
        )
        .eq(
          "listed",
          true,
        )
        .lte(
          "valid_from",
          endDate,
        )
        .gt(
          "valid_to",
          startDate,
        )
        .order(
          "stock_code",
          {
            ascending:
              true,
          },
        )
        .range(
          offset,
          offset +
            pageSize -
            1,
        );

    if (
      error
    ) {
      throw new Error(
        `v9.7 PIT membership load failed at ${offset}: ${error.message}`,
      );
    }

    const page =
      data ??
      [];

    for (
      const row
      of page
    ) {
      members.add(
        String(
          row.stock_code,
        ),
      );

      markets.add(
        String(
          row.market,
        ),
      );
    }

    if (
      page.length <
      pageSize
    ) {
      break;
    }
  }

  return {
    memberCount:
      members.size,

    markets:
      [
        ...markets,
      ].sort(),
  };
}

async function resolveSourceCoverage(
  input: {
    sourceCoverageWindowId?:
      string;

    provider?:
      string;

    universeCode:
      string;

    startDate:
      string;

    endDate:
      string;

    isValidation:
      boolean;
  },
) {
  const supabase =
    createSupabaseServerClient();

  let query =
    supabase
      .from(
        "corporate_action_source_coverage_windows",
      )
      .select(`
        id,
        universe_code,
        provider,
        provider_version,
        start_date,
        end_date,
        coverage_status,
        markets,
        action_types,
        source_fingerprint,
        evidence,
        is_validation
      `)
      .eq(
        "universe_code",
        input.universeCode,
      )
      .eq(
        "is_validation",
        input.isValidation,
      );

  if (
    input.sourceCoverageWindowId
  ) {
    query =
      query.eq(
        "id",
        input.sourceCoverageWindowId,
      );
  } else {
    query =
      query
        .lte(
          "start_date",
          input.startDate,
        )
        .gte(
          "end_date",
          input.endDate,
        );

    if (
      input.provider
    ) {
      query =
        query.eq(
          "provider",
          input.provider,
        );
    }
  }

  const {
    data,
    error,
  } =
    await query
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
    error
  ) {
    throw new Error(
      `v9.7 source coverage lookup failed: ${error.message}`,
    );
  }

  return (
    data ??
    null
  ) as SourceCoverageRow | null;
}

export async function evaluateCorporateActionDatasetCoverageV97(
  input: {
    universeCode?:
      string;

    startDate?:
      string;

    endDate?:
      string;

    compilationRunId?:
      string;

    sourceCoverageWindowId?:
      string;

    provider?:
      string;

    requiredActionTypes?:
      string[];

    isValidation?:
      boolean;
  } = {},
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
      "V9_7_START_DATE_AFTER_END_DATE",
    );
  }

  const requiredActionTypes =
    input
      .requiredActionTypes
      ?.map(
        (
          value,
        ) =>
          String(
            value,
          ).trim(),
      )
      .filter(
        Boolean,
      ) ??
    [
      ...DEFAULT_REQUIRED_ACTION_TYPES,
    ];

  const isValidation =
    input.isValidation ===
    true;

  const compilation =
    await resolveCompilation({
      compilationRunId:
        input
          .compilationRunId
          ?.trim(),

      universeCode,
      startDate,
      endDate,
      isValidation,
    });

  const sourceCoverage =
    compilation?.status ===
      "READY"
      ? await resolveSourceCoverage({
          sourceCoverageWindowId:
            input
              .sourceCoverageWindowId
              ?.trim(),

          provider:
            input
              .provider
              ?.trim(),

          universeCode,
          startDate,
          endDate,
          isValidation,
        })
      : null;

  const {
    data: run,
    error: runError,
  } =
    await supabase
      .from(
        "corporate_action_dataset_coverage_runs",
      )
      .insert({
        version:
          "CORPORATE_ACTION_DATASET_COVERAGE_V9_7",

        universe_code:
          universeCode,

        compilation_run_id:
          compilation
            ?.id ??
          null,

        source_coverage_window_id:
          sourceCoverage
            ?.id ??
          null,

        start_date:
          startDate,

        end_date:
          endDate,

        status:
          "RUNNING",

        required_action_types:
          requiredActionTypes,

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
      `v9.7 coverage-run create failed: ${
        runError?.message ??
        "NO_RUN"
      }`,
    );
  }

  const coverageRunId =
    String(
      run.id,
    );

  try {
    if (
      !compilation ||
      compilation.status !==
        "READY"
    ) {
      const summary = {
        reason:
          "Historical PIT compilation is missing or not READY.",

        pitCompilation:
          compilation ??
          null,

        eventAbsenceInterpretedAsNoAction:
          false,

        currentUniverseSubstituted:
          false,

        productionApplied:
          false,
      };

      const {
        error,
      } =
        await supabase
          .rpc(
            "finish_corporate_action_dataset_coverage_run_v9_7",
            {
              p_run_id:
                coverageRunId,

              p_status:
                "BLOCKED_PIT",

              p_pit_member_count:
                0,

              p_pit_markets:
                [],

              p_required_action_types:
                requiredActionTypes,

              p_missing_markets:
                [],

              p_missing_action_types:
                requiredActionTypes,

              p_summary:
                summary,

              p_error_message:
                null,
            },
          );

      if (
        error
      ) {
        throw new Error(
          `v9.7 blocked-PIT finish failed: ${error.message}`,
        );
      }

      return {
        version:
          "CORPORATE_ACTION_DATASET_COVERAGE_V9_7",

        coverageRunId,

        status:
          "BLOCKED_PIT",

        summary,

        safety: {
          coverageAssertionWritten:
            false,

          eventAbsenceInterpretedAsNoAction:
            false,

          currentUniverseSubstituted:
            false,

          productionApplied:
            false,
        },
      };
    }

    const pit =
      await loadPitIdentity(
        compilation.id,
        startDate,
        endDate,
      );

    if (
      !sourceCoverage ||
      sourceCoverage.coverage_status !==
        "COMPLETE"
    ) {
      const summary = {
        pitCompilation: {
          id:
            compilation.id,

          provider:
            compilation.provider,
        },

        pit,

        sourceCoverage:
          sourceCoverage ??
          null,

        reason:
          "Explicit COMPLETE provider/source coverage evidence is missing.",

        eventAbsenceInterpretedAsNoAction:
          false,

        productionApplied:
          false,
      };

      const {
        error,
      } =
        await supabase
          .rpc(
            "finish_corporate_action_dataset_coverage_run_v9_7",
            {
              p_run_id:
                coverageRunId,

              p_status:
                "BLOCKED_SOURCE_COVERAGE",

              p_pit_member_count:
                pit.memberCount,

              p_pit_markets:
                pit.markets,

              p_required_action_types:
                requiredActionTypes,

              p_missing_markets:
                pit.markets,

              p_missing_action_types:
                requiredActionTypes,

              p_summary:
                summary,

              p_error_message:
                null,
            },
          );

      if (
        error
      ) {
        throw new Error(
          `v9.7 blocked-source finish failed: ${error.message}`,
        );
      }

      return {
        version:
          "CORPORATE_ACTION_DATASET_COVERAGE_V9_7",

        coverageRunId,

        status:
          "BLOCKED_SOURCE_COVERAGE",

        summary,

        safety: {
          coverageAssertionWritten:
            false,

          eventAbsenceInterpretedAsNoAction:
            false,

          productionApplied:
            false,
        },
      };
    }

    const coveredMarkets =
      stringArray(
        sourceCoverage.markets,
      );

    const coveredActionTypes =
      stringArray(
        sourceCoverage
          .action_types,
      );

    const missingMarkets =
      pit.markets.filter(
        (
          market,
        ) =>
          !coveredMarkets.includes(
            market,
          ),
      );

    const missingActionTypes =
      requiredActionTypes.filter(
        (
          actionType,
        ) =>
          !coveredActionTypes.includes(
            actionType,
          ),
      );

    const complete =
      pit.memberCount >
        0 &&
      missingMarkets.length ===
        0 &&
      missingActionTypes.length ===
        0;

    const status =
      complete
        ? "COMPLETE"
        : "PARTIAL";

    const summary = {
      pitCompilation: {
        id:
          compilation.id,

        provider:
          compilation.provider,

        startDate:
          compilation.start_date,

        endDate:
          compilation.end_date,
      },

      pit,

      sourceCoverage: {
        id:
          sourceCoverage.id,

        provider:
          sourceCoverage.provider,

        providerVersion:
          sourceCoverage.provider_version,

        startDate:
          sourceCoverage.start_date,

        endDate:
          sourceCoverage.end_date,

        coverageStatus:
          sourceCoverage.coverage_status,

        sourceFingerprint:
          sourceCoverage.source_fingerprint,
      },

      requiredActionTypes,

      coveredMarkets,
      coveredActionTypes,

      missingMarkets,
      missingActionTypes,

      eventAbsenceInterpretedAsNoAction:
        false,

      currentUniverseSubstituted:
        false,

      productionApplied:
        false,
    };

    const {
      error: finishError,
    } =
      await supabase
        .rpc(
          "finish_corporate_action_dataset_coverage_run_v9_7",
          {
            p_run_id:
              coverageRunId,

            p_status:
              status,

            p_pit_member_count:
              pit.memberCount,

            p_pit_markets:
              pit.markets,

            p_required_action_types:
              requiredActionTypes,

            p_missing_markets:
              missingMarkets,

            p_missing_action_types:
              missingActionTypes,

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
        `v9.7 coverage-run finish failed: ${finishError.message}`,
      );
    }

    const {
      data: assertion,
      error: assertionError,
    } =
      await supabase
        .from(
          "corporate_action_coverage_assertions",
        )
        .insert({
          universe_code:
            universeCode,

          start_date:
            startDate,

          end_date:
            endDate,

          provider:
            sourceCoverage.provider,

          coverage_status:
            complete
              ? "COMPLETE"
              : "PARTIAL",

          supported_action_types:
            coveredActionTypes,

          unsupported_action_types:
            missingActionTypes,

          evidence: {
            coverageRunId,

            compilationRunId:
              compilation.id,

            sourceCoverageWindowId:
              sourceCoverage.id,

            pitMemberCount:
              pit.memberCount,

            pitMarkets:
              pit.markets,

            coveredMarkets,

            missingMarkets,

            eventAbsenceInterpretedAsNoAction:
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
      assertionError ||
      !assertion
    ) {
      throw new Error(
        `v9.7 coverage assertion insert failed: ${
          assertionError?.message ??
          "NO_ASSERTION"
        }`,
      );
    }

    return {
      version:
        "CORPORATE_ACTION_DATASET_COVERAGE_V9_7",

      coverageRunId,

      assertionId:
        assertion.id,

      status,

      summary,

      safety: {
        explicitSourceCoverageRequired:
          true,

        eventAbsenceInterpretedAsNoAction:
          false,

        currentUniverseSubstituted:
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
        : "UNKNOWN_V9_7_COVERAGE_ERROR";

    await supabase
      .rpc(
        "finish_corporate_action_dataset_coverage_run_v9_7",
        {
          p_run_id:
            coverageRunId,

          p_status:
            "FAILED",

          p_pit_member_count:
            0,

          p_pit_markets:
            [],

          p_required_action_types:
            requiredActionTypes,

          p_missing_markets:
            [],

          p_missing_action_types:
            requiredActionTypes,

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
