import {
  createSupabaseServerClient,
} from "@/lib/supabase";

type ImportRow = {
  id: string;
  as_of_date: string;
};

function requireDate(
  value: string,
  name: string,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`INVALID_${name}`);
  }
  return value;
}

async function loadCalendar(
  indexCode: string,
  startDate: string,
  endDate: string,
) {
  const supabase = createSupabaseServerClient();
  const output: string[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("market_index_daily_bars")
      .select("trading_date")
      .eq("index_code", indexCode)
      .gte("trading_date", startDate)
      .lte("trading_date", endDate)
      .order("trading_date", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(
        `v9.3B.2 calendar load failed: ${error.message}`,
      );
    }

    const page = (data ?? []).map(
      (row) => String(row.trading_date),
    );
    output.push(...page);

    if (page.length < pageSize) break;
  }

  return [...new Set(output)];
}

async function loadImports(
  universeCode: string,
  provider: string,
  startDate: string,
  endDate: string,
  isValidation: boolean,
) {
  const supabase = createSupabaseServerClient();
  const output: ImportRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("historical_universe_snapshot_imports")
      .select("id,as_of_date")
      .eq("universe_code", universeCode)
      .eq("provider", provider)
      .eq("coverage_status", "COMPLETE")
      .eq("status", "IMPORTED")
      .eq("is_validation", isValidation)
      .gte("as_of_date", startDate)
      .lte("as_of_date", endDate)
      .order("as_of_date", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(
        `v9.3B.2 import load failed: ${error.message}`,
      );
    }

    const page = (data ?? []) as ImportRow[];
    output.push(...page);

    if (page.length < pageSize) break;
  }

  return output;
}

export async function compileHistoricalUniverseIntervalsV93B(
  input: {
    universeCode: string;
    provider: string;
    startDate: string;
    endDate: string;
    calendarIndexCode?: string;
    isValidation?: boolean;
  },
) {
  const supabase = createSupabaseServerClient();

  const universeCode = input.universeCode.trim();
  const provider = input.provider.trim();
  const startDate = requireDate(input.startDate, "START_DATE");
  const endDate = requireDate(input.endDate, "END_DATE");
  const calendarIndexCode =
    input.calendarIndexCode?.trim() || "0001";
  const isValidation = input.isValidation === true;

  if (!universeCode || !provider) {
    throw new Error("V9_3B_2_REQUIRED_METADATA_MISSING");
  }

  if (startDate > endDate) {
    throw new Error("V9_3B_2_START_DATE_AFTER_END_DATE");
  }

  // Lightweight preflight only: member rows remain in PostgreSQL.
  const [calendar, imports] = await Promise.all([
    loadCalendar(
      calendarIndexCode,
      startDate,
      endDate,
    ),
    loadImports(
      universeCode,
      provider,
      startDate,
      endDate,
      isValidation,
    ),
  ]);

  const importsByDate = new Map<string, ImportRow[]>();

  for (const item of imports) {
    const bucket = importsByDate.get(item.as_of_date) ?? [];
    bucket.push(item);
    importsByDate.set(item.as_of_date, bucket);
  }

  const missingDates = calendar.filter(
    (date) =>
      (importsByDate.get(date) ?? []).length === 0,
  );

  const duplicateDates = calendar.filter(
    (date) =>
      (importsByDate.get(date) ?? []).length > 1,
  );

  const importedCompleteDates = calendar.filter(
    (date) =>
      (importsByDate.get(date) ?? []).length === 1,
  ).length;

  const { data: run, error: runError } = await supabase
    .from("historical_universe_compilation_runs")
    .insert({
      universe_code: universeCode,
      provider,
      calendar_index_code: calendarIndexCode,
      start_date: startDate,
      end_date: endDate,
      status: "RUNNING",
      expected_trading_dates: calendar.length,
      imported_complete_dates: importedCompleteDates,
      missing_trading_dates: missingDates.length,
      duplicate_complete_dates: duplicateDates.length,
      metadata: {
        version:
          "HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_2",
        executionMode: "DB_SET_BASED",
        missingDates: missingDates.slice(0, 100),
        duplicateDates: duplicateDates.slice(0, 100),
        sourceImportIdPolicy: "FIRST_LAST_ONLY",
        dailyRawSnapshotsRetained: true,
        canonicalPromotion: false,
      },
      is_validation: isValidation,
      production_applied: false,
    })
    .select("id")
    .single();

  if (runError || !run) {
    throw new Error(
      `v9.3B.2 compilation-run create failed: ${
        runError?.message ?? "NO_RUN"
      }`,
    );
  }

  const compilationRunId = String(run.id);

  try {
    if (
      calendar.length === 0 ||
      missingDates.length > 0 ||
      duplicateDates.length > 0
    ) {
      const { error } = await supabase.rpc(
        "finish_historical_universe_compilation_v9_3b",
        {
          p_compilation_run_id: compilationRunId,
          p_status: "BLOCKED_SNAPSHOT_COVERAGE",
          p_compiled_interval_count: 0,
          p_error_message: null,
        },
      );

      if (error) {
        throw new Error(
          `v9.3B.2 blocked-run finish failed: ${error.message}`,
        );
      }

      return {
        version:
          "HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_2",
        compilationRunId,
        status: "BLOCKED_SNAPSHOT_COVERAGE",
        coverage: {
          expectedTradingDates: calendar.length,
          importedCompleteDates,
          missingTradingDates: missingDates.length,
          duplicateCompleteDates: duplicateDates.length,
          missingDates: missingDates.slice(0, 100),
          duplicateDates: duplicateDates.slice(0, 100),
        },
        safety: {
          executionMode: "DB_SET_BASED",
          canonicalMembershipsModified: false,
          incompleteSnapshotsPromoted: false,
          currentUniverseBackfilledIntoPast: false,
          productionApplied: false,
        },
      };
    }

    const { data: compiledData, error: compiledError } =
      await supabase.rpc(
        "compile_historical_universe_intervals_v9_3b_2",
        {
          p_compilation_run_id: compilationRunId,
          p_universe_code: universeCode,
          p_provider: provider,
          p_calendar_index_code: calendarIndexCode,
          p_start_date: startDate,
          p_end_date: endDate,
          p_is_validation: isValidation,
        },
      );

    if (compiledError) {
      throw new Error(
        `v9.3B.2 DB compiler failed: ${compiledError.message}`,
      );
    }

    const result = Array.isArray(compiledData)
      ? compiledData[0] ?? null
      : compiledData;

    if (!result) {
      throw new Error(
        "V9_3B_2_DB_COMPILER_RETURNED_NO_RESULT",
      );
    }

    return {
      version:
        "HISTORICAL_PIT_INTERVAL_COMPILER_V9_3B_2",
      compilationRunId,
      status: "READY",
      coverage: {
        expectedTradingDates: calendar.length,
        importedCompleteDates,
        missingTradingDates: 0,
        duplicateCompleteDates: 0,
      },
      compiledIntervalCount: Number(
        result.compiled_interval_count ?? 0,
      ),
      endExclusive: String(result.end_exclusive),
      evidence: {
        sourceImportIdPolicy: "FIRST_LAST_ONLY",
        dailyRawSnapshotsRetained: true,
      },
      safety: {
        executionMode: "DB_SET_BASED",
        intervalSemantics: "[valid_from,valid_to)",
        canonicalMembershipsModified: false,
        requiresCompleteDailySnapshots: true,
        duplicateCompleteSnapshotsFailClosed: true,
        currentUniverseBackfilledIntoPast: false,
        productionApplied: false,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_V9_3B_2_COMPILATION_ERROR";

    const { data: latestRun } = await supabase
      .from("historical_universe_compilation_runs")
      .select("status")
      .eq("id", compilationRunId)
      .maybeSingle();

    if (latestRun?.status !== "READY") {
      await supabase.rpc(
        "finish_historical_universe_compilation_v9_3b",
        {
          p_compilation_run_id: compilationRunId,
          p_status: "FAILED",
          p_compiled_interval_count: 0,
          p_error_message: message,
        },
      );
    }

    throw error;
  }
}
