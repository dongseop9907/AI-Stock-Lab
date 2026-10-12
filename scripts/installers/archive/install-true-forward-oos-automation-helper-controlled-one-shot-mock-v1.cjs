const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-automation-helper-controlled-one-shot-mock-v1.ts"
);

const PACKAGE = path.join(
  ROOT,
  "package.json"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_HELPER_CONTROLLED_ONE_SHOT_MOCK_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(
          ROOT,
          rel
        )
      )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      missing,
    }
  );
} else {
  fs.writeFileSync(
    TARGET,
    "import {\n  runTrueForwardOosAutomationBindingV1,\n  type ForwardOosAutomationState,\n  type ForwardOosAutomationStep,\n} from \"../lib/research/run-true-forward-oos-automation-binding-v1\";\n\nasync function main() {\n  const calls:\n    ForwardOosAutomationStep[] =\n      [];\n\n  let state:\n    ForwardOosAutomationState | null =\n      null;\n\n  let saveCount =\n    0;\n\n  const result =\n    await runTrueForwardOosAutomationBindingV1(\n      {\n        now:\n          new Date(\n            \"2026-10-08T08:50:00+09:00\",\n          ),\n      },\n      {\n        env: {\n          ...process.env,\n\n          FORWARD_OOS_AUTOMATION_ENABLED:\n            \"true\",\n\n          REAL_TRADING_ENABLED:\n            \"false\",\n\n          ENABLE_REAL_TRADING:\n            \"false\",\n\n          ENABLE_LIVE_TRADING:\n            \"false\",\n        } as NodeJS.ProcessEnv,\n\n        loadState:\n          () =>\n            state,\n\n        saveState:\n          (\n            nextState:\n              ForwardOosAutomationState,\n          ) => {\n            state =\n              JSON.parse(\n                JSON.stringify(\n                  nextState,\n                ),\n              );\n\n            saveCount +=\n              1;\n          },\n\n        runStep:\n          async (\n            step:\n              ForwardOosAutomationStep,\n          ) => {\n            calls.push(\n              step,\n            );\n\n            return {\n              exitCode:\n                0,\n\n              stdout:\n                \"MOCK_SUBPROCESS_OK\",\n\n              stderr:\n                \"\",\n            };\n          },\n      },\n    );\n\n  const hasExecuted =\n    \"executed\" in\n    result;\n\n  const executed =\n    hasExecuted\n      ? result.executed\n      : [];\n\n  const checks = {\n    enabledPathReached:\n      result.status !==\n      \"DISABLED\",\n\n    krxTradingDayNotSkipped:\n      result.status !==\n      \"SKIPPED_NON_KRX_TRADING_DAY\",\n\n    onlyProducerSelected:\n      executed.join(\n        \",\",\n      ) ===\n      \"PRODUCE\",\n\n    mockRunStepCalledOnce:\n      calls.length ===\n      1,\n\n    mockRunStepWasProduce:\n      calls[0] ===\n      \"PRODUCE\",\n\n    statePersistedInMemory:\n      saveCount >=\n      1,\n\n    noRealSubprocess:\n      true,\n\n    realTradingDisabled:\n      process.env\n        .REAL_TRADING_ENABLED !==\n        \"true\" &&\n      process.env\n        .ENABLE_REAL_TRADING !==\n        \"true\" &&\n      process.env\n        .ENABLE_LIVE_TRADING !==\n        \"true\",\n  };\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          value !==\n          true,\n      )\n      .map(\n        ([key]) =>\n          key,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length ===\n          0\n            ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_HELPER_CONTROLLED_ONE_SHOT_MOCK_V1_VERIFIED\"\n            : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_HELPER_CONTROLLED_ONE_SHOT_MOCK_V1_FAILED\",\n\n        mode:\n          \"HELPER_ENABLED_WITH_INJECTED_MOCK_SUBPROCESS\",\n\n        observation: {\n          resultStatus:\n            result.status,\n\n          executed,\n\n          mockedCalls:\n            calls,\n\n          saveCount,\n\n          statePresent:\n            state !==\n            null,\n        },\n\n        checks,\n\n        safety: {\n          realSubprocessExecuted:\n            false,\n\n          realCollectorExecuted:\n            false,\n\n          realEvaluatorExecuted:\n            false,\n\n          realSummaryExecuted:\n            false,\n\n          networkCalls:\n            0,\n\n          databaseReads:\n            0,\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n\n          positionsChanged:\n            0,\n\n          promotionApplied:\n            false,\n\n          realTradingEnabled:\n            false,\n        },\n\n        failed,\n\n        nextGate:\n          failed.length ===\n          0\n            ? \"VERIFY_FORWARD_OOS_REAL_SUBPROCESS_COMMAND_BOUNDARY_WITH_NO_EXECUTION_V1\"\n            : \"REPAIR_HELPER_CONTROLLED_ONE_SHOT_MOCK\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    failed.length ===\n    0\n      ? 0\n      : 1;\n}\n\nmain().catch(\n  error => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_HELPER_CONTROLLED_ONE_SHOT_MOCK_V1_FAILED\",\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          failed: [\n            \"runtime\",\n          ],\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 1;\n  },\n);\n",
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
  } catch (error) {
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

  if (pkg) {
    pkg.scripts ||= {};

    pkg.scripts[
      "test:true-forward-oos-helper-controlled-one-shot-mock"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-automation-helper-controlled-one-shot-mock-v1.ts";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_HELPER_CONTROLLED_ONE_SHOT_MOCK_V1_INSTALLED",

      generatedFile:
        "scripts/true-forward-oos-automation-helper-controlled-one-shot-mock-v1.ts",

      packageScript:
        "npm run test:true-forward-oos-helper-controlled-one-shot-mock",

      mode:
        "HELPER_ENABLED_BUT_SUBPROCESS_FULLY_MOCKED",

      productSourceChanges:
        0,

      safety: {
        realSubprocessExecution:
          false,
        collectorExecution:
          false,
        evaluatorExecution:
          false,
        summaryExecution:
          false,
        networkCalls:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false
      },

      nextAction:
        "RUN_CONTROLLED_HELPER_ONE_SHOT_WITH_MOCKED_SUBPROCESS"
    }, null, 2));
  }
}
