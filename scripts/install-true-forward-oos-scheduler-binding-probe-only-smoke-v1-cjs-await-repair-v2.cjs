const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-scheduler-binding-probe-only-smoke-v1.ts"
);

const BACKUP = path.join(
  ROOT,
  "scripts",
  "backups",
  "true-forward-oos-scheduler-binding-probe-only-smoke-v1.before-cjs-await-repair-v2.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_CJS_AWAIT_REPAIR_V2_FAILED",
    reason,
    ...extra
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail("SMOKE_TEST_NOT_FOUND");
} else {
  fs.mkdirSync(
    path.dirname(BACKUP),
    { recursive: true }
  );

  if (!fs.existsSync(BACKUP)) {
    fs.copyFileSync(
      TARGET,
      BACKUP
    );
  }

  let source =
    fs.readFileSync(
      TARGET,
      "utf8"
    );

  const marker =
    "ALPHA_V3_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_ASYNC_MAIN_V2";

  if (
    source.includes(marker)
  ) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_CJS_AWAIT_REPAIR_V2_ALREADY_INSTALLED",
      changed: false
    }, null, 2));
  } else {
    const importEndPattern =
      /(?:^import[\s\S]*?;\r?\n)+/;

    const match =
      source.match(importEndPattern);

    if (!match) {
      fail(
        "IMPORT_BLOCK_NOT_FOUND"
      );
    } else {
      const imports =
        match[0];

      const body =
        source.slice(
          imports.length
        );

      source =
        imports +
        `\n/* ${marker} */\n` +
        `async function main() {\n` +
        body +
        `\n}\n\n` +
        `main().catch((error) => {\n` +
        `  console.error(JSON.stringify({\n` +
        `    status: "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_FAILED",\n` +
        `    error: String(error instanceof Error ? error.message : error),\n` +
        `    failed: ["probeRuntime"],\n` +
        `  }, null, 2));\n` +
        `  process.exitCode = 1;\n` +
        `});\n`;

      fs.writeFileSync(
        TARGET,
        source,
        "utf8"
      );

      console.log(JSON.stringify({
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_CJS_AWAIT_REPAIR_V2_INSTALLED",
        changed: true,
        repair:
          "WRAP_TOP_LEVEL_AWAITS_IN_ASYNC_MAIN",
        target:
          "scripts/true-forward-oos-scheduler-binding-probe-only-smoke-v1.ts",
        backup:
          "scripts/backups/true-forward-oos-scheduler-binding-probe-only-smoke-v1.before-cjs-await-repair-v2.ts",
        productCodeChanged:
          false,
        safety: {
          schedulerTickExecuted:
            false,
          schedulerLoopStarted:
            false,
          realSubprocessExecuted:
            false,
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
          "RERUN_PROBE_ONLY_SMOKE"
      }, null, 2));
    }
  }
}
