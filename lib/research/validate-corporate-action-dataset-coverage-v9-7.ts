import {
  createHash,
} from "crypto";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  evaluateCorporateActionDatasetCoverageV97,
} from "@/lib/research/evaluate-corporate-action-dataset-coverage-v9-7";

const REQUIRED_ACTION_TYPES = [
  "STOCK_SPLIT",
  "REVERSE_SPLIT",
  "CASH_DIVIDEND",
  "STOCK_DIVIDEND",
  "RIGHTS_ISSUE",
  "SPIN_OFF",
  "MERGER",
];

export async function validateCorporateActionDatasetCoverageV97() {
  const supabase =
    createSupabaseServerClient();

  let compilationRunId:
    string | null =
    null;

  let sourceCoverageWindowId:
    string | null =
    null;

  let coverageRunId:
    string | null =
    null;

  let assertionId:
    string | null =
    null;

  let cleanupSucceeded =
    false;

  try {
    const {
      data: calendarData,
      error: calendarError,
    } =
      await supabase
        .from(
          "market_index_daily_bars",
        )
        .select(
          "trading_date",
        )
        .eq(
          "index_code",
          "0001",
        )
        .order(
          "trading_date",
          {
            ascending:
              false,
          },
        )
        .limit(4);

    if (
      calendarError
    ) {
      throw new Error(
        `v9.7 validation calendar load failed: ${calendarError.message}`,
      );
    }

    const dates =
      (
        calendarData ??
        []
      )
        .map(
          (
            row,
          ) =>
            String(
              row.trading_date,
            ),
        )
        .sort();

    if (
      dates.length <
      4
    ) {
      throw new Error(
        "V9_7_VALIDATION_NEEDS_4_MARKET_DATES",
      );
    }

    const startDate =
      dates[0];

    const endDate =
      dates[
        dates.length -
        1
      ];

    const {
      data: security,
      error: securityError,
    } =
      await supabase
        .from(
          "stock_universe_securities",
        )
        .select(
          "stock_code,stock_name,market",
        )
        .order(
          "stock_code",
          {
            ascending:
              true,
          },
        )
        .limit(1)
        .maybeSingle();

    if (
      securityError
    ) {
      throw new Error(
        `v9.7 validation security lookup failed: ${securityError.message}`,
      );
    }

    if (
      !security
    ) {
      throw new Error(
        "V9_7_VALIDATION_NEEDS_SECURITY_MASTER_ROW",
      );
    }

    const {
      data: compilation,
      error: compilationError,
    } =
      await supabase
        .from(
          "historical_universe_compilation_runs",
        )
        .insert({
          universe_code:
            "KRX_ALL_LISTED",

          provider:
            "SYNTHETIC_CORPORATE_ACTION_COVERAGE_V9_7",

          calendar_index_code:
            "0001",

          start_date:
            startDate,

          end_date:
            endDate,

          status:
            "READY",

          expected_trading_dates:
            dates.length,

          imported_complete_dates:
            dates.length,

          missing_trading_dates:
            0,

          duplicate_complete_dates:
            0,

          compiled_interval_count:
            1,

          metadata: {
            synthetic:
              true,
          },

          is_validation:
            true,

          production_applied:
            false,

          finished_at:
            new Date()
              .toISOString(),
        })
        .select(
          "id",
        )
        .single();

    if (
      compilationError ||
      !compilation
    ) {
      throw new Error(
        `v9.7 validation compilation create failed: ${
          compilationError?.message ??
          "NO_COMPILATION"
        }`,
      );
    }

    compilationRunId =
      String(
        compilation.id,
      );

    const nextDateResult =
      await supabase
        .from(
          "market_index_daily_bars",
        )
        .select(
          "trading_date",
        )
        .eq(
          "index_code",
          "0001",
        )
        .gt(
          "trading_date",
          endDate,
        )
        .order(
          "trading_date",
          {
            ascending:
              true,
          },
        )
        .limit(1)
        .maybeSingle();

    if (
      nextDateResult.error
    ) {
      throw new Error(
        `v9.7 validation next-date lookup failed: ${nextDateResult.error.message}`,
      );
    }

    const validTo =
      nextDateResult.data
        ?.trading_date
        ? String(
            nextDateResult
              .data
              .trading_date,
          )
        : (() => {
            const date =
              new Date(
                `${endDate}T00:00:00.000Z`,
              );

            date.setUTCDate(
              date.getUTCDate() +
                1,
            );

            return date
              .toISOString()
              .slice(
                0,
                10,
              );
          })();

    const {
      error: membershipError,
    } =
      await supabase
        .from(
          "historical_universe_compiled_memberships",
        )
        .insert({
          compilation_run_id:
            compilationRunId,

          universe_code:
            "KRX_ALL_LISTED",

          stock_code:
            security.stock_code,

          stock_name:
            security.stock_name,

          market:
            security.market,

          sector:
            null,

          security_type:
            "COMMON",

          listed:
            true,

          tradable:
            true,

          valid_from:
            startDate,

          valid_to:
            validTo,

          evidence_type:
            "SYNTHETIC_VALIDATION",

          source_provider:
            "SYNTHETIC_CORPORATE_ACTION_COVERAGE_V9_7",

          source_import_ids:
            [],

          metadata: {
            synthetic:
              true,
          },

          is_validation:
            true,

          production_applied:
            false,
        });

    if (
      membershipError
    ) {
      throw new Error(
        `v9.7 validation membership insert failed: ${membershipError.message}`,
      );
    }

    const fingerprint =
      createHash(
        "sha256",
      )
        .update(
          JSON.stringify({
            provider:
              "SYNTHETIC_CORPORATE_ACTION_COVERAGE_V9_7",

            startDate,
            endDate,

            markets: [
              security.market,
            ],

            actionTypes:
              REQUIRED_ACTION_TYPES,
          }),
        )
        .digest(
          "hex",
        );

    const {
      data: sourceCoverage,
      error: sourceCoverageError,
    } =
      await supabase
        .from(
          "corporate_action_source_coverage_windows",
        )
        .insert({
          universe_code:
            "KRX_ALL_LISTED",

          provider:
            "SYNTHETIC_CORPORATE_ACTION_COVERAGE_V9_7",

          provider_version:
            "SYNTHETIC_V1",

          start_date:
            startDate,

          end_date:
            endDate,

          coverage_status:
            "COMPLETE",

          markets: [
            security.market,
          ],

          action_types:
            REQUIRED_ACTION_TYPES,

          source_fingerprint:
            fingerprint,

          evidence: {
            synthetic:
              true,

            purpose:
              "V9_7_COVERAGE_VALIDATION",
          },

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
      sourceCoverageError ||
      !sourceCoverage
    ) {
      throw new Error(
        `v9.7 validation source coverage create failed: ${
          sourceCoverageError?.message ??
          "NO_SOURCE_WINDOW"
        }`,
      );
    }

    sourceCoverageWindowId =
      String(
        sourceCoverage.id,
      );

    const result =
      await evaluateCorporateActionDatasetCoverageV97({
        universeCode:
          "KRX_ALL_LISTED",

        startDate,
        endDate,

        compilationRunId,

        sourceCoverageWindowId,

        requiredActionTypes:
          REQUIRED_ACTION_TYPES,

        isValidation:
          true,
      });

    coverageRunId =
      result.coverageRunId;

    assertionId =
      "assertionId" in
        result
        ? String(
            result.assertionId,
          )
        : null;

    if (
      !(
        "pit" in
        result.summary
      ) ||
      !(
        "coveredMarkets" in
        result.summary
      ) ||
      !(
        "coveredActionTypes" in
        result.summary
      )
    ) {
      throw new Error(
        `V9_7_VALIDATION_UNEXPECTED_STATUS_${result.status}`,
      );
    }

    const completeSummary =
      result.summary;

    const assertions = {
      coverageComplete:
        result.status ===
        "COMPLETE",

      onePitMember:
        completeSummary
          .pit
          .memberCount ===
        1,

      pitMarketDetected:
        completeSummary
          .pit
          .markets
          .includes(
            String(
              security.market,
            ),
          ),

      sourceCoverageWindowAccepted:
        completeSummary
          .sourceCoverage
          .coverageStatus ===
        "COMPLETE",

      noMissingMarkets:
        completeSummary
          .missingMarkets
          .length ===
        0,

      noMissingActionTypes:
        completeSummary
          .missingActionTypes
          .length ===
        0,

      allRequiredActionTypesCovered:
        REQUIRED_ACTION_TYPES.every(
          (
            actionType,
          ) =>
            completeSummary
              .coveredActionTypes
              .includes(
                actionType,
              ),
        ),

      eventAbsenceNotUsedAsCoverageEvidence:
        result
          .safety
          .eventAbsenceInterpretedAsNoAction ===
        false,

      currentUniverseNotSubstituted:
        result
          .safety
          .currentUniverseSubstituted ===
        false,

      explicitSourceCoverageRequired:
        result
          .safety
          .explicitSourceCoverageRequired ===
        true,

      productionNotApplied:
        result
          .safety
          .productionApplied ===
        false,
    };

    const passed =
      Object.values(
        assertions,
      ).every(
        (
          value,
        ) =>
          value ===
          true,
      );

    if (
      assertionId
    ) {
      await supabase
        .from(
          "corporate_action_coverage_assertions",
        )
        .delete()
        .eq(
          "id",
          assertionId,
        );
    }

    if (
      coverageRunId
    ) {
      await supabase
        .from(
          "corporate_action_dataset_coverage_runs",
        )
        .delete()
        .eq(
          "id",
          coverageRunId,
        );
    }

    if (
      sourceCoverageWindowId
    ) {
      await supabase
        .from(
          "corporate_action_source_coverage_windows",
        )
        .delete()
        .eq(
          "id",
          sourceCoverageWindowId,
        );
    }

    if (
      compilationRunId
    ) {
      await supabase
        .from(
          "historical_universe_compilation_runs",
        )
        .delete()
        .eq(
          "id",
          compilationRunId,
        );
    }

    cleanupSucceeded =
      true;

    const {
      data: audit,
      error: auditError,
    } =
      await supabase
        .from(
          "corporate_action_dataset_coverage_validation_runs",
        )
        .insert({
          validation_version:
            "CORPORATE_ACTION_DATASET_COVERAGE_VALIDATION_V9_7",

          status:
            passed
              ? "PASS"
              : "FAIL",

          assertions,

          cleanup_succeeded:
            cleanupSucceeded,

          production_applied:
            false,
        })
        .select(
          "id",
        )
        .single();

    if (
      auditError ||
      !audit
    ) {
      throw new Error(
        `v9.7 validation audit failed: ${
          auditError?.message ??
          "NO_AUDIT"
        }`,
      );
    }

    return {
      version:
        "CORPORATE_ACTION_DATASET_COVERAGE_VALIDATION_V9_7",

      validationRunId:
        audit.id,

      status:
        passed
          ? "PASS"
          : "FAIL",

      stockCode:
        security.stock_code,

      market:
        security.market,

      dates: {
        startDate,
        endDate,
      },

      assertions,

      cleanup: {
        succeeded:
          cleanupSucceeded,
      },

      safety: {
        realCorporateActionEventsModified:
          false,

        canonicalPitModified:
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
        : "UNKNOWN_V9_7_VALIDATION_ERROR";

    if (
      assertionId
    ) {
      await supabase
        .from(
          "corporate_action_coverage_assertions",
        )
        .delete()
        .eq(
          "id",
          assertionId,
        );
    }

    if (
      coverageRunId
    ) {
      await supabase
        .from(
          "corporate_action_dataset_coverage_runs",
        )
        .delete()
        .eq(
          "id",
          coverageRunId,
        );
    }

    if (
      sourceCoverageWindowId
    ) {
      await supabase
        .from(
          "corporate_action_source_coverage_windows",
        )
        .delete()
        .eq(
          "id",
          sourceCoverageWindowId,
        );
    }

    if (
      compilationRunId
    ) {
      await supabase
        .from(
          "historical_universe_compilation_runs",
        )
        .delete()
        .eq(
          "id",
          compilationRunId,
        );
    }

    cleanupSucceeded =
      true;

    await supabase
      .from(
        "corporate_action_dataset_coverage_validation_runs",
      )
      .insert({
        validation_version:
          "CORPORATE_ACTION_DATASET_COVERAGE_VALIDATION_V9_7",

        status:
          "FAIL",

        assertions: {
          runtimeError:
            message,

          productionNotApplied:
            true,
        },

        cleanup_succeeded:
          cleanupSucceeded,

        error_message:
          message,

        production_applied:
          false,
      });

    throw error;
  }
}
