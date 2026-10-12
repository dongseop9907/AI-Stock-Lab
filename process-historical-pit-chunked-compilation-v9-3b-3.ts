import {
  randomUUID,
} from "crypto";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

export async function processHistoricalPitChunkedCompilationV93B3(
  input: {
    compilationRunId:
      string;

    maxChunks?:
      number;
  },
) {
  const supabase =
    createSupabaseServerClient();

  const compilationRunId =
    input
      .compilationRunId
      .trim();

  if (
    !compilationRunId
  ) {
    throw new Error(
      "V9_3B_3_COMPILATION_RUN_ID_REQUIRED",
    );
  }

  const {
    data: run,
    error: runError,
  } =
    await supabase
      .from(
        "historical_universe_compilation_runs",
      )
      .select(`
        id,
        universe_code,
        provider,
        calendar_index_code,
        start_date,
        end_date,
        status,
        is_validation
      `)
      .eq(
        "id",
        compilationRunId,
      )
      .single();

  if (
    runError ||
    !run
  ) {
    throw new Error(
      `v9.3B.3 run lookup failed: ${
        runError?.message ??
        "NO_RUN"
      }`,
    );
  }

  if (
    run.status !==
      "RUNNING"
  ) {
    const {
      data: progressData,
      error: progressError,
    } =
      await supabase
        .rpc(
          "refresh_historical_universe_compilation_v9_3b_3",
          {
            p_compilation_run_id:
              compilationRunId,
          },
        );

    if (
      progressError
    ) {
      throw new Error(
        `v9.3B.3 progress load failed: ${progressError.message}`,
      );
    }

    return {
      version:
        "HISTORICAL_PIT_CHUNK_WORKER_V9_3B_3",

      compilationRunId,

      processedChunks:
        0,

      successfulChunks:
        0,

      failedChunks:
        0,

      chunkResults:
        [],

      progress:
        Array.isArray(
          progressData,
        )
          ? progressData[0] ??
            null
          : progressData,

      productionApplied:
        false,
    };
  }

  const maxChunks =
    Math.max(
      1,
      Math.min(
        5,
        Math.floor(
          input.maxChunks ??
            1,
        ),
      ),
    );

  const workerId =
    `V9_3B_3_${process.pid}_${randomUUID()}`;

  const {
    data: claimedData,
    error: claimError,
  } =
    await supabase
      .rpc(
        "claim_historical_universe_compilation_chunks_v9_3b_3",
        {
          p_compilation_run_id:
            compilationRunId,

          p_worker_id:
            workerId,

          p_limit:
            maxChunks,

          p_lease_seconds:
            180,
        },
      );

  if (
    claimError
  ) {
    throw new Error(
      `v9.3B.3 chunk claim failed: ${claimError.message}`,
    );
  }

  const chunks =
    claimedData ??
    [];

  const chunkResults:
    Array<
      Record<
        string,
        unknown
      >
    > =
    [];

  let successfulChunks =
    0;

  let failedChunks =
    0;

  for (
    const chunk
    of chunks
  ) {
    const chunkId =
      String(
        chunk.id,
      );

    try {
      const {
        data: compileData,
        error: compileError,
      } =
        await supabase
          .rpc(
            "compile_historical_universe_chunk_v9_3b_3",
            {
              p_compilation_run_id:
                compilationRunId,

              p_universe_code:
                String(
                  run.universe_code,
                ),

              p_provider:
                String(
                  run.provider,
                ),

              p_calendar_index_code:
                String(
                  run.calendar_index_code,
                ),

              p_chunk_start_date:
                String(
                  chunk.start_date,
                ),

              p_chunk_end_date:
                String(
                  chunk.end_date,
                ),

              p_is_validation:
                Boolean(
                  run.is_validation,
                ),
            },
          );

      if (
        compileError
      ) {
        throw new Error(
          `v9.3B.3 chunk compiler failed: ${compileError.message}`,
        );
      }

      const result =
        Array.isArray(
          compileData,
        )
          ? compileData[0] ??
            null
          : compileData;

      if (
        !result
      ) {
        throw new Error(
          "V9_3B_3_CHUNK_COMPILER_RETURNED_NO_RESULT",
        );
      }

      const {
        error: updateError,
      } =
        await supabase
          .from(
            "historical_universe_compilation_chunks",
          )
          .update({
            status:
              "SUCCESS",

            worker_id:
              null,

            lease_expires_at:
              null,

            chunk_interval_count:
              Number(
                result
                  .chunk_interval_count ??
                  0,
              ),

            merged_interval_count:
              Number(
                result
                  .merged_interval_count ??
                  0,
              ),

            inserted_interval_count:
              Number(
                result
                  .inserted_interval_count ??
                  0,
              ),

            finished_at:
              new Date()
                .toISOString(),

            updated_at:
              new Date()
                .toISOString(),

            error_message:
              null,

            metadata: {
              chunkEndExclusive:
                result
                  .chunk_end_exclusive,
            },
          })
          .eq(
            "id",
            chunkId,
          );

      if (
        updateError
      ) {
        throw new Error(
          `v9.3B.3 success update failed: ${updateError.message}`,
        );
      }

      successfulChunks +=
        1;

      chunkResults.push({
        chunkNo:
          chunk.chunk_no,

        startDate:
          chunk.start_date,

        endDate:
          chunk.end_date,

        ok:
          true,

        chunkIntervalCount:
          result
            .chunk_interval_count,

        mergedIntervalCount:
          result
            .merged_interval_count,

        insertedIntervalCount:
          result
            .inserted_interval_count,
      });
    } catch (
      error
    ) {
      const message =
        error instanceof Error
          ? error.message
          : "UNKNOWN_V9_3B_3_CHUNK_ERROR";

      const {
        error: updateError,
      } =
        await supabase
          .from(
            "historical_universe_compilation_chunks",
          )
          .update({
            status:
              "FAILED",

            worker_id:
              null,

            lease_expires_at:
              null,

            finished_at:
              new Date()
                .toISOString(),

            updated_at:
              new Date()
                .toISOString(),

            error_message:
              message,
          })
          .eq(
            "id",
            chunkId,
          );

      if (
        updateError
      ) {
        throw new Error(
          `v9.3B.3 failure update failed: ${updateError.message}`,
        );
      }

      failedChunks +=
        1;

      chunkResults.push({
        chunkNo:
          chunk.chunk_no,

        startDate:
          chunk.start_date,

        endDate:
          chunk.end_date,

        ok:
          false,

        attempt:
          chunk.attempt_count,

        error:
          message,
      });
    }
  }

  const {
    data: progressData,
    error: progressError,
  } =
    await supabase
      .rpc(
        "refresh_historical_universe_compilation_v9_3b_3",
        {
          p_compilation_run_id:
            compilationRunId,
        },
      );

  if (
    progressError
  ) {
    throw new Error(
      `v9.3B.3 progress refresh failed: ${progressError.message}`,
    );
  }

  return {
    version:
      "HISTORICAL_PIT_CHUNK_WORKER_V9_3B_3",

    compilationRunId,
    workerId,

    processedChunks:
      chunks.length,

    successfulChunks,
    failedChunks,

    chunkResults,

    progress:
      Array.isArray(
        progressData,
      )
        ? progressData[0] ??
          null
        : progressData,

    safety: {
      canonicalMembershipsModified:
        false,

      productionApplied:
        false,

      resumable:
        true,
    },
  };
}
