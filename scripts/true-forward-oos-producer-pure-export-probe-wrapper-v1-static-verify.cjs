const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const WRAPPER_REL =
  "scripts/true-forward-oos-producer-pure-export-probe-wrapper-v1.ts";

const PRODUCER_REL =
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts";

const wrapperPath =
  path.join(
    ROOT,
    WRAPPER_REL,
  );

const producerPath =
  path.join(
    ROOT,
    PRODUCER_REL,
  );

function fail(
  reason,
  extra = {},
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_STATIC_FAILED",

        reason,
        ...extra,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}

if (
  !fs.existsSync(
    wrapperPath,
  ) ||
  !fs.existsSync(
    producerPath,
  )
) {
  fail(
    "REQUIRED_FILE_MISSING",
    {
      wrapperExists:
        fs.existsSync(
          wrapperPath,
        ),

      producerExists:
        fs.existsSync(
          producerPath,
        ),
    },
  );
} else {
  const wrapper =
    fs.readFileSync(
      wrapperPath,
      "utf8",
    );

  const producer =
    fs.readFileSync(
      producerPath,
      "utf8",
    );

  const checks = {
    wrapperExists:
      true,

    producerExists:
      true,

    importsPureCalendarExport:
      wrapper.includes(
        "nextExpectedKrxOpenDate",
      ),

    importsEntrypointGuard:
      wrapper.includes(
        "isTrueForwardTop1DirectExecution",
      ),

    doesNotCallProducerRuntime:
      !/runTrueForwardTop1Producer\s*\(/.test(
        wrapper,
      ),

    doesNotCallProducerMain:
      !/\bmain\s*\(\s*\)\s*\.catch/.test(
        producer
          .slice(
            0,
            producer.indexOf(
              "if (isTrueForwardTop1DirectExecution())",
            ),
          ),
      ),

    wrapperHasNoDbWriteSurface:
      !/\.(insert|update|upsert|delete)\s*\(/i.test(
        wrapper,
      ),

    wrapperHasNoFileWriteSurface:
      !/(writeFile|writeFileSync|appendFile|appendFileSync)/i.test(
        wrapper,
      ),

    wrapperHasNoNetworkSurface:
      !/\bfetch\s*\(|axios\.|https?\.request/i.test(
        wrapper,
      ),

    producerImportGuardStillPresent:
      producer.includes(
        "export function isTrueForwardTop1DirectExecution(",
      ) &&
      producer.includes(
        "if (isTrueForwardTop1DirectExecution())",
      ),
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
            ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_STATIC_VERIFIED"
            : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_STATIC_FAILED",

        checks,

        safety: {
          sourceOnlyStaticVerify:
            true,

          producerExecuted:
            false,

          databaseReads:
            0,

          databaseWrites:
            0,

          fileWrites:
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
            ? "RUN_PURE_EXPORT_PROBE_WRAPPER"
            : "REPAIR_PURE_EXPORT_WRAPPER",
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
