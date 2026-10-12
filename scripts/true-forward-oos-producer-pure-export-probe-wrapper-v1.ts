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
    moduleImportedSafely:
      true,

    versionExportUsable:
      typeof TRUE_FORWARD_TOP1_VERSION ===
        "string" &&
      TRUE_FORWARD_TOP1_VERSION.length >
        0,

    currentWrapperNotDirectProducer:
      isTrueForwardTop1DirectExecution(
        process.argv[1],
      ) ===
      false,

    canonicalProducerFilenameRecognized:
      isTrueForwardTop1DirectExecution(
        "C:\\repo\\scripts\\alpha-v3-true-forward-top1-producer-v1.ts",
      ) ===
      true,

    pureCalendarFunctionCallable:
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
          failed.length ===
          0
            ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_VERIFIED"
            : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_FAILED",

        observation: {
          version:
            TRUE_FORWARD_TOP1_VERSION,

          sourceDate,

          nextDate,
        },

        checks,

        safety: {
          producerMainExecuted:
            false,

          producerRuntimeFunctionCalled:
            false,

          subprocessExecuted:
            false,

          databaseReads:
            0,

          databaseWrites:
            0,

          producerFileWrites:
            0,

          networkCalls:
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
          failed.length ===
          0
            ? "DESIGN_EXPLICIT_PRODUCER_PROBE_ONLY_MODE_BEFORE_REAL_SUBPROCESS_V1"
            : "REPAIR_PURE_EXPORT_IMPORT_SURFACE_BEFORE_PRODUCER_PROBE_MODE",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length ===
    0
      ? 0
      : 1;
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_FAILED",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          failed: [
            "wrapperRuntime",
          ],
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
