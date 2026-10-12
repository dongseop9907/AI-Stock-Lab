import {
  TRUE_FORWARD_TOP1_VERSION,
  isTrueForwardTop1DirectExecution,
  nextExpectedKrxOpenDate,
} from "./alpha-v3-true-forward-top1-producer-v1";

async function main() {
  const sourceDate =
    "2026-10-08";

  const nextDate =
    nextExpectedKrxOpenDate(
      sourceDate,
      [],
    );

  const checks = {
    moduleImported:
      true,

    versionExportAvailable:
      typeof TRUE_FORWARD_TOP1_VERSION ===
      "string",

    importedContextNotDirect:
      isTrueForwardTop1DirectExecution(
        process.argv[1],
      ) ===
      false,

    producerFilenameRecognizedAsDirect:
      isTrueForwardTop1DirectExecution(
        "C:\\temp\\scripts\\alpha-v3-true-forward-top1-producer-v1.ts",
      ) ===
      true,

    otherFilenameRejected:
      isTrueForwardTop1DirectExecution(
        "C:\\temp\\scripts\\some-wrapper.ts",
      ) ===
      false,

    pureCalendarExportCallable:
      nextDate ===
      "2026-10-12",
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          value !== true,
      )
      .map(
        ([key]) =>
          key,
      );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_IMPORT_SMOKE_VERIFIED"
            : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_IMPORT_SMOKE_FAILED",

        checks,

        observation: {
          sourceDate,
          nextDate,
        },

        safety: {
          producerMainExpectedToRun:
            false,

          producerSubprocessExecuted:
            false,

          intendedDatabaseReads:
            0,

          intendedDatabaseWrites:
            0,

          intendedFileWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          realTradingEnabled:
            false,
        },

        failed,

        nextGate:
          failed.length === 0
            ? "RERUN_FORWARD_OOS_PIPELINE_CONTRACT_AND_STATIC_REGRESSION"
            : "REPAIR_ENTRYPOINT_GUARD_BEFORE_ANY_REAL_PRODUCER_EXECUTION",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_IMPORT_SMOKE_FAILED",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          failed: [
            "importSmokeRuntime",
          ],
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
