import {
  randomUUID,
} from "crypto";
import {
  createSupabaseServerClient,
} from "@/lib/supabase";
import {
  ingestKrxHistoricalPitDateV93C,
} from "@/lib/market/ingest-krx-historical-pit-date-v9-3c";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function processKrxHistoricalPitImportRunV93C(
  input: {
    runId: string;
    maxTasks?: number;
    requestDelayMs?: number;
  },
) {
  const supabase = createSupabaseServerClient();
  const runId = input.runId.trim();
  if (!runId) throw new Error("V9_3C_RUN_ID_REQUIRED");

  const { data: run, error: runError } = await supabase
    .from("krx_historical_pit_import_runs")
    .select("id,status,request_delay_ms,max_attempts")
    .eq("id", runId)
    .single();

  if (runError || !run) {
    throw new Error(
      `v9.3C run lookup failed: ${runError?.message ?? "NO_RUN"}`,
    );
  }

  if (run.status !== "RUNNING") {
    const { data: progress, error } = await supabase.rpc(
      "refresh_krx_historical_pit_import_run_v9_3c",
      { p_run_id: runId },
    );
    if (error) throw new Error(`v9.3C progress load failed: ${error.message}`);

    return {
      version: "KRX_HISTORICAL_PIT_WORKER_V9_3C",
      runId,
      workerId: null,
      processedTasks: 0,
      successes: 0,
      failures: 0,
      taskResults: [],
      progress: Array.isArray(progress) ? progress[0] ?? null : progress,
      safety: { productionApplied: false },
    };
  }

  const maxTasks = Math.max(
    1,
    Math.min(50, Math.floor(input.maxTasks ?? 5)),
  );
  const requestDelayMs = Math.max(
    0,
    Math.min(
      10000,
      Math.floor(input.requestDelayMs ?? run.request_delay_ms ?? 400),
    ),
  );

  const workerId = `V9_3C_${process.pid}_${randomUUID()}`;

  const { data: tasksData, error: claimError } = await supabase.rpc(
    "claim_krx_historical_pit_tasks_v9_3c",
    {
      p_run_id: runId,
      p_worker_id: workerId,
      p_limit: maxTasks,
      p_lease_seconds: 240,
    },
  );

  if (claimError) {
    throw new Error(`v9.3C task claim failed: ${claimError.message}`);
  }

  const tasks = tasksData ?? [];
  const taskResults: Array<Record<string, unknown>> = [];
  let successes = 0;
  let failures = 0;

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    const taskId = String(task.id);
    const asOfDate = String(task.as_of_date);

    try {
      const result = await ingestKrxHistoricalPitDateV93C(asOfDate);

      const { error: updateError } = await supabase
        .from("krx_historical_pit_import_tasks")
        .update({
          status: "SUCCESS",
          worker_id: null,
          lease_expires_at: null,
          import_id: result.importId,
          reused_existing_import: result.reused,
          kospi_raw_count: result.rawCounts?.kospi ?? null,
          kosdaq_raw_count: result.rawCounts?.kosdaq ?? null,
          normalized_member_count: Number(result.observedMemberCount ?? 0),
          api_request_count: Number(result.apiRequestCount ?? 0),
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: null,
          metadata: {
            version: result.version,
            ingestStatus: result.status,
          },
        })
        .eq("id", taskId);

      if (updateError) {
        throw new Error(
          `v9.3C success-task update failed: ${updateError.message}`,
        );
      }

      successes += 1;
      taskResults.push({
        taskId,
        asOfDate,
        attempt: task.attempt_count,
        ok: true,
        reused: result.reused,
        importId: result.importId,
        apiRequestCount: result.apiRequestCount,
        rawCounts: result.rawCounts,
        observedMemberCount: result.observedMemberCount,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "UNKNOWN_V9_3C_TASK_ERROR";

      const retryable =
        Number(task.attempt_count ?? 0) < Number(run.max_attempts ?? 3);

      const { error: updateError } = await supabase
        .from("krx_historical_pit_import_tasks")
        .update({
          status: "FAILED",
          worker_id: null,
          lease_expires_at: null,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: message,
        })
        .eq("id", taskId);

      if (updateError) {
        throw new Error(
          `v9.3C failure-task update failed: ${updateError.message}`,
        );
      }

      failures += 1;
      taskResults.push({
        taskId,
        asOfDate,
        attempt: task.attempt_count,
        ok: false,
        retryable,
        error: message,
      });
    }

    if (index < tasks.length - 1 && requestDelayMs > 0) {
      await sleep(requestDelayMs);
    }
  }

  const { data: progressData, error: progressError } = await supabase.rpc(
    "refresh_krx_historical_pit_import_run_v9_3c",
    { p_run_id: runId },
  );

  if (progressError) {
    throw new Error(`v9.3C progress refresh failed: ${progressError.message}`);
  }

  const progress = Array.isArray(progressData)
    ? progressData[0] ?? null
    : progressData;

  return {
    version: "KRX_HISTORICAL_PIT_WORKER_V9_3C",
    runId,
    workerId,
    requestDelayMs,
    processedTasks: tasks.length,
    successes,
    failures,
    taskResults,
    progress,
    safety: {
      canonicalMembershipsModified: false,
      currentUniverseSubstituted: false,
      productionApplied: false,
      resumable: true,
    },
  };
}
