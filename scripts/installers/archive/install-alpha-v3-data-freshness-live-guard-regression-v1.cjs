const fs = require("fs");
const path = require("path");

const root = process.cwd();

const outputs = [
  {
    rel:
      "scripts/alpha-v3-data-freshness-live-guard-regression-v1.ts",
    text:
      "import {\n  createClient,\n} from \"@supabase/supabase-js\";\n\nimport {\n  readCanonicalDataFreshnessState,\n} from \"../lib/trading/data-freshness-canonical-reader\";\n\nimport {\n  assertDataFreshnessAllows,\n  readCurrentDataFreshnessProductionDecision,\n  DataFreshnessBlockedError,\n} from \"../lib/trading/data-freshness-production-guard\";\n\nconst supabaseUrl =\n  String(\n    process.env.NEXT_PUBLIC_SUPABASE_URL ??\n    process.env.SUPABASE_URL ??\n    \"\",\n  )\n    .trim()\n    .replace(/\\/+$/, \"\");\n\nconst serviceRoleKey =\n  String(\n    process.env.SUPABASE_SERVICE_ROLE_KEY ??\n    process.env.SUPABASE_SERVICE_KEY ??\n    \"\",\n  ).trim();\n\nif (\n  !supabaseUrl ||\n  !serviceRoleKey\n) {\n  throw new Error(\n    \"SUPABASE_SERVICE_ROLE_CONFIG_MISSING\",\n  );\n}\n\nconst supabase =\n  createClient(\n    supabaseUrl,\n    serviceRoleKey,\n    {\n      auth: {\n        persistSession: false,\n        autoRefreshToken: false,\n      },\n    },\n  );\n\nasync function countRows(\n  table:\n    string,\n): Promise<number | null> {\n  const result =\n    await supabase\n      .from(table)\n      .select(\n        \"*\",\n        {\n          count: \"exact\",\n          head: true,\n        },\n      );\n\n  if (result.error) {\n    return null;\n  }\n\n  return result.count ?? 0;\n}\n\nasync function expectBlocked(\n  action:\n    \"PAPER_BUY_CREATE\" |\n    \"PAPER_BUY_EXECUTE\",\n) {\n  try {\n    await assertDataFreshnessAllows(\n      supabase,\n      action,\n    );\n\n    return {\n      blocked: false,\n      errorType: null,\n      reason: null,\n    };\n  } catch (error) {\n    if (\n      error instanceof\n      DataFreshnessBlockedError\n    ) {\n      return {\n        blocked: true,\n        errorType:\n          error.name,\n        reason:\n          error.decision.reason,\n      };\n    }\n\n    return {\n      blocked: false,\n      errorType:\n        error instanceof Error\n          ? error.name\n          : \"UNKNOWN_ERROR\",\n      reason:\n        error instanceof Error\n          ? error.message\n          : String(error),\n    };\n  }\n}\n\nasync function main() {\n  const before = {\n    orders:\n      await countRows(\n        \"paper_order_requests\",\n      ),\n\n    positions:\n      await countRows(\n        \"paper_positions\",\n      ),\n  };\n\n  const state =\n    await readCanonicalDataFreshnessState(\n      supabase,\n    );\n\n  const decisions = {\n    automationCreate:\n      await readCurrentDataFreshnessProductionDecision(\n        supabase,\n        \"PAPER_BUY_CREATE\",\n      ),\n\n    create:\n      await readCurrentDataFreshnessProductionDecision(\n        supabase,\n        \"PAPER_BUY_CREATE\",\n      ),\n\n    execute:\n      await readCurrentDataFreshnessProductionDecision(\n        supabase,\n        \"PAPER_BUY_EXECUTE\",\n      ),\n\n    protectiveExit:\n      await readCurrentDataFreshnessProductionDecision(\n        supabase,\n        \"PROTECTIVE_EXIT\",\n      ),\n\n    riskMaintenance:\n      await readCurrentDataFreshnessProductionDecision(\n        supabase,\n        \"RISK_MAINTENANCE\",\n      ),\n  };\n\n  const createGuard =\n    await expectBlocked(\n      \"PAPER_BUY_CREATE\",\n    );\n\n  const executeGuard =\n    await expectBlocked(\n      \"PAPER_BUY_EXECUTE\",\n    );\n\n  const after = {\n    orders:\n      await countRows(\n        \"paper_order_requests\",\n      ),\n\n    positions:\n      await countRows(\n        \"paper_positions\",\n      ),\n  };\n\n  const deltas = {\n    orders:\n      before.orders !== null &&\n      after.orders !== null\n        ? after.orders -\n          before.orders\n        : null,\n\n    positions:\n      before.positions !== null &&\n      after.positions !== null\n        ? after.positions -\n          before.positions\n        : null,\n  };\n\n  const staleAtTestTime =\n    state.usableForProduction ===\n      false;\n\n  const checks = {\n    canonicalStateRead:\n      Boolean(\n        state.freshnessObservedAt,\n      ) &&\n      Boolean(\n        state.qualityObservedAt,\n      ),\n\n    staleAtTestTime,\n\n    createDecisionBlocked:\n      !decisions.create.allowed,\n\n    executeDecisionBlocked:\n      !decisions.execute.allowed,\n\n    createGuardThrowsFailClosed:\n      createGuard.blocked,\n\n    executeGuardThrowsFailClosed:\n      executeGuard.blocked,\n\n    protectiveExitAllowed:\n      decisions.protectiveExit.allowed ===\n        true,\n\n    riskMaintenanceAllowed:\n      decisions.riskMaintenance.allowed ===\n        true,\n\n    noOrderWrites:\n      deltas.orders ===\n        null ||\n      deltas.orders ===\n        0,\n\n    noPositionWrites:\n      deltas.positions ===\n        null ||\n      deltas.positions ===\n        0,\n  };\n\n  const failed =\n    Object.entries(checks)\n      .filter(\n        ([, value]) => !value,\n      )\n      .map(\n        ([key]) => key,\n      );\n\n  const status =\n    !staleAtTestTime\n      ? \"ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_INCONCLUSIVE_FRESH_NOW\"\n      : failed.length === 0\n        ? \"ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_VERIFIED\"\n        : \"ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_REVIEW\";\n\n  console.log(\n    JSON.stringify(\n      {\n        status,\n\n        state: {\n          freshnessStatus:\n            state.freshnessStatus,\n\n          qualityStatus:\n            state.qualityStatus,\n\n          usableForProduction:\n            state.usableForProduction,\n\n          expectedMarketDate:\n            state.expectedMarketDate,\n\n          latestCommonDate:\n            state.latestCommonDate,\n\n          businessWeekdayLag:\n            state.businessWeekdayLag,\n        },\n\n        decisions: {\n          create: {\n            allowed:\n              decisions.create.allowed,\n\n            reason:\n              decisions.create.reason,\n          },\n\n          execute: {\n            allowed:\n              decisions.execute.allowed,\n\n            reason:\n              decisions.execute.reason,\n          },\n\n          protectiveExit: {\n            allowed:\n              decisions.protectiveExit.allowed,\n\n            reason:\n              decisions.protectiveExit.reason,\n          },\n\n          riskMaintenance: {\n            allowed:\n              decisions.riskMaintenance.allowed,\n\n            reason:\n              decisions.riskMaintenance.reason,\n          },\n        },\n\n        guards: {\n          create:\n            createGuard,\n\n          execute:\n            executeGuard,\n        },\n\n        before,\n        after,\n        deltas,\n\n        checks,\n        failed,\n\n        safety: {\n          productionCreateCalled:\n            false,\n\n          productionFillCalled:\n            false,\n\n          automationAutoOrderRun:\n            false,\n\n          databaseWritesByTest:\n            0,\n\n          purpose:\n            \"VERIFY_REAL_STALE_STATE_BLOCKS_NEW_RISK_WITHOUT_CREATING_TEST_ORDERS\",\n        },\n\n        nextGate:\n          status ===\n            \"ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_VERIFIED\"\n            ? \"BUILD_DB_FRESHNESS_CREATE_FILL_GUARDS_V1\"\n            : status.endsWith(\n                \"INCONCLUSIVE_FRESH_NOW\",\n              )\n              ? \"RUN_FRESH_STATE_POSITIVE_CONTRACT_ONLY_OR_WAIT_FOR_NEXT_STALE_WINDOW\"\n              : \"REVIEW_APPLICATION_FRESHNESS_GUARD\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  if (\n    status.endsWith(\n      \"_REVIEW\",\n    )\n  ) {\n    process.exitCode = 2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            productionCreateCalled:\n              false,\n\n            productionFillCalled:\n              false,\n\n            databaseWritesByTest:\n              0,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 2;\n  },\n);\n"
  },
  {
    rel:
      "scripts/alpha-v3-data-freshness-live-guard-regression-v1-static-verify.cjs",
    text:
      "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst rel =\n  \"scripts/alpha-v3-data-freshness-live-guard-regression-v1.ts\";\n\nconst text =\n  fs.readFileSync(\n    path.resolve(root, rel),\n    \"utf8\"\n  );\n\nconst checks = {\n  realCanonicalReader:\n    text.includes(\n      \"readCanonicalDataFreshnessState\"\n    ),\n\n  realProductionGuard:\n    text.includes(\n      \"assertDataFreshnessAllows\"\n    ),\n\n  createGuardTested:\n    text.includes(\n      '\"PAPER_BUY_CREATE\"'\n    ),\n\n  executeGuardTested:\n    text.includes(\n      '\"PAPER_BUY_EXECUTE\"'\n    ),\n\n  protectiveExitTested:\n    text.includes(\n      '\"PROTECTIVE_EXIT\"'\n    ),\n\n  riskMaintenanceTested:\n    text.includes(\n      '\"RISK_MAINTENANCE\"'\n    ),\n\n  noProductionCreateCall:\n    !text.includes(\n      \"createPaperBuyOrder(\"\n    ),\n\n  noProductionExecuteCall:\n    !text.includes(\n      \"executePaperOrder(\"\n    ),\n\n  noAutomationPost:\n    !text.includes(\n      \"/api/trading/automation/run\"\n    ),\n\n  noDatabaseMutation:\n    !/\\.(insert|upsert|update|delete|rpc)\\s*\\(/m.test(\n      text\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, value]) => !value)\n    .map(([key]) => key);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      safety: {\n        productionOrderPathInvoked:\n          false,\n\n        databaseWrites:\n          0,\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"RUN_LIVE_STALE_GUARD_REGRESSION\"\n          : \"REVIEW_LIVE_GUARD_TEST_HARNESS\",\n    },\n    null,\n    2\n  )\n);\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n"
  }
];

for (const item of outputs) {
  const file =
    path.resolve(
      root,
      item.rel
    );

  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  fs.writeFileSync(
    file,
    item.text,
    "utf8"
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_INSTALLED",

      generatedFiles:
        outputs.map(
          (item) => item.rel
        ),

      testMode:
        "REAL_DB_READS_GUARD_ONLY_NO_PRODUCTION_ORDER_CALL",

      safety: {
        databaseWrites:
          0,

        productionCreateCalled:
          false,

        productionFillCalled:
          false,

        automationAutoOrderRun:
          false
      },

      rationale:
        "VERIFY_STALE_FAIL_CLOSED_WITH_REAL_CANONICAL_STATE_WITHOUT_RISKING_A_TEST_ORDER",

      nextAction:
        "STATIC_VERIFY_AND_RUN_LIVE_GUARD_REGRESSION"
    },
    null,
    2
  )
);
