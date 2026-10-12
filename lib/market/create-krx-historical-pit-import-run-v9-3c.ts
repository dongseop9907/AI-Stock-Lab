import {
  createSupabaseServerClient,
} from "@/lib/supabase";
import {
  KRX_HISTORICAL_PIT_PROVIDER_NAME_V93C,
} from "@/lib/market/krx-historical-universe-provider-v9-3c";

function requireDate(value: string, name: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`INVALID_${name}`);
  }
  return value;
}

async function loadTradingDates(
  startDate: string,
  endDate: string,
  indexCode: string,
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
      throw new Error(`v9.3C calendar load failed: ${error.message}`);
    }

    const page = (data ?? []).map((row) => String(row.trading_date));
    output.push(...page);
    if (page.length < pageSize) break;
  }

  return [...new Set(output)];
}

export async function createKrxHistoricalPitImportRunV93C(
  input: {
    startDate: string;
    endDate: string;
    calendarIndexCode?: string;
    requestDelayMs?: number;
    maxAttempts?: number;
  },
) {
  const supabase = createSupabaseServerClient();

  const startDate = requireDate(input.startDate, "START_DATE");
  const endDate = requireDate(input.endDate, "END_DATE");
  if (startDate > endDate) {
    throw new Error("V9_3C_START_DATE_AFTER_END_DATE");
  }

  const calendarIndexCode = input.calendarIndexCode?.trim() || "0001";
  const requestDelayMs = Math.max(
    0,
    Math.min(10000, Math.floor(input.requestDelayMs ?? 400)),
  );
  const maxAttempts = Math.max(
    1,
    Math.min(10, Math.floor(input.maxAttempts ?? 3)),
  );

  const tradingDates = await loadTradingDates(
    startDate,
    endDate,
    calendarIndexCode,
  );

  if (tradingDates.length === 0) {
    throw new Error("V9_3C_NO_TRADING_DATES_IN_RANGE");
  }

  const { data: run, error: runError } = await supabase
    .from("krx_historical_pit_import_runs")
    .insert({
      universe_code: "KRX_ALL_LISTED",
      provider: KRX_HISTORICAL_PIT_PROVIDER_NAME_V93C,
      start_date: startDate,
      end_date: endDate,
      calendar_index_code: calendarIndexCode,
      request_delay_ms: requestDelayMs,
      max_attempts: maxAttempts,
      status: "RUNNING",
      trading_date_count: tradingDates.length,
      pending_count: tradingDates.length,
      metadata: {
        source: "KRX_OPEN_API",
        apiCallsPerNewDate: 2,
        expectedApiRequestCeiling: tradingDates.length * 2,
        historicalSnapshotParameter: "basDd",
        currentUniverseSubstituted: false,
        canonicalPromotion: false,
      },
      is_validation: false,
      production_applied: false,
    })
    .select("id")
    .single();

  if (runError || !run) {
    throw new Error(
      `v9.3C run create failed: ${runError?.message ?? "NO_RUN"}`,
    );
  }

  const runId = String(run.id);

  try {
    for (let offset = 0; offset < tradingDates.length; offset += 500) {
      const rows = tradingDates
        .slice(offset, offset + 500)
        .map((asOfDate) => ({
          run_id: runId,
          as_of_date: asOfDate,
          status: "PENDING",
          metadata: {
            source: "KRX_OPEN_API",
            endpoints: ["stk_isu_base_info", "ksq_isu_base_info"],
          },
        }));

      const { error } = await supabase
        .from("krx_historical_pit_import_tasks")
        .insert(rows);

      if (error) {
        throw new Error(
          `v9.3C task insert failed at ${offset}: ${error.message}`,
        );
      }
    }

    const { data: refreshed, error: refreshError } = await supabase.rpc(
      "refresh_krx_historical_pit_import_run_v9_3c",
      { p_run_id: runId },
    );

    if (refreshError) {
      throw new Error(`v9.3C run refresh failed: ${refreshError.message}`);
    }

    return {
      version: "KRX_HISTORICAL_PIT_PROVIDER_V9_3C",
      runId,
      status: "RUNNING",
      range: { startDate, endDate },
      calendar: {
        indexCode: calendarIndexCode,
        tradingDateCount: tradingDates.length,
        firstTradingDate: tradingDates[0],
        lastTradingDate: tradingDates[tradingDates.length - 1],
      },
      policy: {
        requestDelayMs,
        maxAttempts,
        apiCallsPerNewDate: 2,
        estimatedMaximumApiRequests: tradingDates.length * 2,
      },
      progress: Array.isArray(refreshed) ? refreshed[0] ?? null : refreshed,
      safety: {
        canonicalMembershipsModified: false,
        currentUniverseSubstituted: false,
        productionApplied: false,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "UNKNOWN_V9_3C_CREATE_ERROR";

    await supabase
      .from("krx_historical_pit_import_runs")
      .update({
        status: "FAILED",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", runId);

    throw error;
  }
}
