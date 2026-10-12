const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const BINDING =
  path.join(
    ROOT,
    "lib",
    "research",
    "run-true-forward-oos-automation-binding-v1.ts"
  );

const CALENDAR =
  path.join(
    ROOT,
    "lib",
    "trading",
    "krx-trading-calendar.ts"
  );

const CONTRACT =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-automation-binding-krx-guard-v1-contract-test.ts"
  );

const STATIC_VERIFY =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-automation-binding-krx-guard-v1-static-verify.cjs"
  );

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const BACKUP_DIR =
  path.join(
    ROOT,
    "scripts",
    "backups"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_INSTALL_FAILED",

        reason,
        ...extra,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

const required = [
  BINDING,
  CALENDAR,
  PACKAGE,
];

const missing =
  required.filter(
    file =>
      !fs.existsSync(file)
  );

if (
  missing.length > 0
) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      missing,
    }
  );
} else {
  fs.mkdirSync(
    BACKUP_DIR,
    {
      recursive: true
    }
  );

  const bindingBackup =
    path.join(
      BACKUP_DIR,
      "run-true-forward-oos-automation-binding-v1.before-krx-guard-v1.ts"
    );

  const packageBackup =
    path.join(
      BACKUP_DIR,
      "package.before-true-forward-oos-automation-binding-krx-guard-v1.json"
    );

  if (
    !fs.existsSync(
      bindingBackup
    )
  ) {
    fs.copyFileSync(
      BINDING,
      bindingBackup
    );
  }

  if (
    !fs.existsSync(
      packageBackup
    )
  ) {
    fs.copyFileSync(
      PACKAGE,
      packageBackup
    );
  }

  let source =
    fs.readFileSync(
      BINDING,
      "utf8"
    );

  const marker =
    "ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1";

  if (
    !source.includes(marker)
  ) {
    const exportNeedle =
      "export async function runTrueForwardOosAutomationBindingV1(";

    if (
      !source.includes(
        exportNeedle
      )
    ) {
      fail(
        "BINDING_EXPORT_ANCHOR_NOT_FOUND"
      );
    } else {
      source =
        source.replace(
          exportNeedle,
          "async function runTrueForwardOosAutomationBindingV1Core("
        );

      const importLine =
        'import { isKrxTradingDate } from "../trading/krx-trading-calendar";\n';

      if (
        !source.includes(
          "../trading/krx-trading-calendar"
        )
      ) {
        source =
          importLine +
          source;
      } else if (
        !source.includes(
          "isKrxTradingDate"
        )
      ) {
        fail(
          "EXISTING_KRX_IMPORT_REQUIRES_MANUAL_MERGE"
        );
      }

      source += `

/* ${marker} */
function resolveKstDateKeyForForwardOosAutomationV1(
  now: Date,
): string {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "Asia/Seoul",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      },
    ).formatToParts(
      now,
    );

  const byType =
    new Map(
      parts.map(
        part => [
          part.type,
          part.value,
        ],
      ),
    );

  const year =
    byType.get(
      "year",
    );

  const month =
    byType.get(
      "month",
    );

  const day =
    byType.get(
      "day",
    );

  if (
    !year ||
    !month ||
    !day
  ) {
    throw new Error(
      "FORWARD_OOS_KST_DATE_RESOLUTION_FAILED",
    );
  }

  return \`\${year}-\${month}-\${day}\`;
}

export async function runTrueForwardOosAutomationBindingV1(
  ...args:
    Parameters<
      typeof runTrueForwardOosAutomationBindingV1Core
    >
) {
  const options =
    args[0] as
      | {
          now?: Date;
        }
      | undefined;

  const dependencies =
    args[1] as
      | {
          env?:
            Record<
              string,
              string | undefined
            >;
        }
      | undefined;

  const env =
    dependencies?.env ??
    process.env;

  const enabled =
    String(
      env[
        "FORWARD_OOS_AUTOMATION_ENABLED"
      ] ??
      "",
    )
      .trim()
      .toLowerCase() ===
    "true";

  if (
    !enabled
  ) {
    return runTrueForwardOosAutomationBindingV1Core(
      ...args
    );
  }

  const now =
    options?.now ??
    new Date();

  const kstDate =
    resolveKstDateKeyForForwardOosAutomationV1(
      now,
    );

  const tradingDay =
    isKrxTradingDate(
      kstDate,
      [],
    );

  if (
    !tradingDay
  ) {
    return {
      status:
        "SKIPPED_NON_KRX_TRADING_DAY" as const,

      dateKst:
        kstDate,

      reason:
        "CANONICAL_KRX_CALENDAR_CLOSED",

      executedSteps:
        [] as const,
    };
  }

  return runTrueForwardOosAutomationBindingV1Core(
    ...args
  );
}
`;
    }
  }

  if (
    process.exitCode !== 1
  ) {
    fs.writeFileSync(
      BINDING,
      source,
      "utf8"
    );

    fs.writeFileSync(
      CONTRACT,
      "import {\n  runTrueForwardOosAutomationBindingV1,\n} from \"../lib/research/run-true-forward-oos-automation-binding-v1\";\n\nasync function main() {\n  const executed: string[] = [];\n\n  const deps = {\n    env: {\n      FORWARD_OOS_AUTOMATION_ENABLED:\n        \"true\",\n    },\n\n    runStep:\n      async (step: unknown) => {\n        executed.push(\n          String(step),\n        );\n\n        return {\n          exitCode: 0,\n          stdout: \"\",\n          stderr: \"\",\n        };\n      },\n\n    loadState:\n      () => null,\n\n    saveState:\n      () => {},\n  };\n\n  const weekend =\n    await runTrueForwardOosAutomationBindingV1(\n      {\n        now:\n          new Date(\n            \"2026-10-10T08:50:00+09:00\",\n          ),\n      },\n      deps,\n    );\n\n  const weekendExecuted =\n    [...executed];\n\n  executed.length = 0;\n\n  const hangeulDay =\n    await runTrueForwardOosAutomationBindingV1(\n      {\n        now:\n          new Date(\n            \"2026-10-09T08:50:00+09:00\",\n          ),\n      },\n      deps,\n    );\n\n  const hangeulExecuted =\n    [...executed];\n\n  executed.length = 0;\n\n  const disabledOnHoliday =\n    await runTrueForwardOosAutomationBindingV1(\n      {\n        now:\n          new Date(\n            \"2026-10-09T08:50:00+09:00\",\n          ),\n      },\n      {\n        ...deps,\n        env: {\n          FORWARD_OOS_AUTOMATION_ENABLED:\n            \"false\",\n        },\n      },\n    );\n\n  const disabledExecuted =\n    [...executed];\n\n  const checks = {\n    weekendSkipped:\n      weekend.status ===\n      \"SKIPPED_NON_KRX_TRADING_DAY\",\n\n    weekendNoSubprocess:\n      weekendExecuted.length === 0,\n\n    verifiedHolidaySkipped:\n      hangeulDay.status ===\n      \"SKIPPED_NON_KRX_TRADING_DAY\",\n\n    verifiedHolidayNoSubprocess:\n      hangeulExecuted.length === 0,\n\n    disabledStillReturnsDisabled:\n      disabledOnHoliday.status ===\n      \"DISABLED\",\n\n    disabledNoSubprocess:\n      disabledExecuted.length === 0,\n  };\n\n  const failed =\n    Object.entries(checks)\n      .filter(([, value]) =>\n        value !== true\n      )\n      .map(([key]) => key);\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length === 0\n            ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_CONTRACT_VERIFIED\"\n            : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_CONTRACT_FAILED\",\n\n        checks,\n\n        observations: {\n          weekendStatus:\n            weekend.status,\n\n          hangeulDayStatus:\n            hangeulDay.status,\n\n          disabledStatus:\n            disabledOnHoliday.status,\n\n          subprocessStepsExecuted:\n            {\n              weekend:\n                weekendExecuted,\n\n              hangeulDay:\n                hangeulExecuted,\n\n              disabled:\n                disabledExecuted,\n            },\n        },\n\n        safety: {\n          realSubprocessExecuted:\n            false,\n\n          databaseReads:\n            0,\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n\n          positionsChanged:\n            0,\n\n          promotionApplied:\n            false,\n\n          realTradingEnabled:\n            false,\n        },\n\n        failed,\n\n        nextGate:\n          failed.length === 0\n            ? \"RERUN_BINDING_TYPECHECK_AND_SCHEDULER_REGRESSION\"\n            : \"REPAIR_CANONICAL_KRX_BINDING_GUARD\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    failed.length === 0\n      ? 0\n      : 1;\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_CONTRACT_FAILED\",\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          failed: [\n            \"contractRuntime\",\n          ],\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 1;\n  },\n);\n",
      "utf8"
    );

    fs.writeFileSync(
      STATIC_VERIFY,
      "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT =\n  process.cwd();\n\nconst bindingRel =\n  \"lib/research/run-true-forward-oos-automation-binding-v1.ts\";\n\nconst binding =\n  fs.readFileSync(\n    path.join(\n      ROOT,\n      bindingRel\n    ),\n    \"utf8\"\n  );\n\nconst checks = {\n  importsCanonicalKrxCalendar:\n    binding.includes(\n      'from \"../trading/krx-trading-calendar\"'\n    ),\n\n  importsIsKrxTradingDate:\n    binding.includes(\n      \"isKrxTradingDate\"\n    ),\n\n  hasExplicitKrxGuardMarker:\n    binding.includes(\n      \"ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1\"\n    ),\n\n  checksCanonicalTradingDate:\n    /isKrxTradingDate\\s*\\(/.test(\n      binding\n    ),\n\n  hasNonTradingDaySkipStatus:\n    binding.includes(\n      \"SKIPPED_NON_KRX_TRADING_DAY\"\n    ),\n\n  noDatabaseDependencyAdded:\n    !/createSupabaseServerClient|market_exchange_calendar_overrides/.test(\n      binding\n    ),\n\n  noOrderCreationSurface:\n    !/createOrder|placeOrder|submitOrder|orders\\.insert/i.test(\n      binding\n    ),\n\n  noPromotionApplySurface:\n    !/PROMOTE_SHADOW_TO_PAPER|applyPromotion/i.test(\n      binding\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, value]) =>\n      value !== true\n    )\n    .map(([key]) => key);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_STATIC_VERIFIED\"\n          : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_STATIC_FAILED\",\n\n      checks,\n\n      safety: {\n        databaseWrites:\n          0,\n\n        ordersCreated:\n          0,\n\n        positionsChanged:\n          0,\n\n        promotionApplied:\n          false,\n\n        realTradingEnabled:\n          false,\n      },\n\n      failed,\n\n      nextGate:\n        failed.length === 0\n          ? \"RUN_KRX_GUARD_CONTRACT\"\n          : \"REPAIR_BINDING_KRX_GUARD_SOURCE\",\n    },\n    null,\n    2\n  )\n);\n\nprocess.exitCode =\n  failed.length === 0\n    ? 0\n    : 1;\n",
      "utf8"
    );

    let pkg;

    try {
      pkg =
        JSON.parse(
          fs.readFileSync(
            PACKAGE,
            "utf8"
          )
        );
    } catch (
      error
    ) {
      fail(
        "PACKAGE_JSON_PARSE_FAILED",
        {
          error:
            String(
              error instanceof Error
                ? error.message
                : error
            ),
        }
      );
    }

    if (
      pkg
    ) {
      if (
        !pkg.scripts ||
        typeof pkg.scripts !==
          "object"
      ) {
        pkg.scripts = {};
      }

      pkg.scripts[
        "test:true-forward-oos-automation-binding-krx-guard:static"
      ] =
        "node ./scripts/true-forward-oos-automation-binding-krx-guard-v1-static-verify.cjs";

      pkg.scripts[
        "test:true-forward-oos-automation-binding-krx-guard"
      ] =
        "tsx ./scripts/true-forward-oos-automation-binding-krx-guard-v1-contract-test.ts";

      fs.writeFileSync(
        PACKAGE,
        JSON.stringify(
          pkg,
          null,
          2
        ) + "\n",
        "utf8"
      );

      console.log(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_INSTALLED",

            strategy:
              "CANONICAL_KRX_CALENDAR_PRE_SUBPROCESS_GUARD",

            canonicalSurface:
              "lib/trading/krx-trading-calendar.ts::isKrxTradingDate",

            behavior: {
              featureFlagOff:
                "UNCHANGED_DISABLED_PATH",

              weekendOrBuiltInVerifiedClosure:
                "SKIP_BEFORE_SUBPROCESS",

              runtimeDbOverrides:
                "UNCHANGED_SECONDARY_GUARD_IN_EXISTING_FORWARD_OOS_PRODUCER",
            },

            patched: [
              "lib/research/run-true-forward-oos-automation-binding-v1.ts",
              "package.json",
            ],

            generated: [
              "scripts/true-forward-oos-automation-binding-krx-guard-v1-contract-test.ts",
              "scripts/true-forward-oos-automation-binding-krx-guard-v1-static-verify.cjs",
            ],

            safety: {
              databaseReadsAddedToBinding:
                0,

              databaseWrites:
                0,

              realSubprocessExecutedByInstaller:
                false,

              ordersCreated:
                0,

              positionsChanged:
                0,

              promotionApplied:
                false,

              realTradingEnabled:
                false,
            },

            nextAction:
              "RUN_STATIC_CONTRACT_EXISTING_CONTRACT_AND_TYPECHECK",
          },
          null,
          2
        )
      );
    }
  }
}
