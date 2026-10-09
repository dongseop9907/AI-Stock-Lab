const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-automation-binding-v1-contract-test.ts"
);

const BACKUP = path.join(
  ROOT,
  "scripts",
  "backups",
  "true-forward-oos-automation-binding-v1-contract-test.before-cjs-await-repair-v2.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CJS_AWAIT_REPAIR_V2_FAILED",
    reason,
    ...extra
  }, null, 2));

  process.exit(1);
}

if (!fs.existsSync(TARGET)) {
  fail("CONTRACT_TEST_NOT_FOUND");
}

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

if (
  source.includes(
    "ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_ASYNC_MAIN_V2"
  )
) {
  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CJS_AWAIT_REPAIR_V2_ALREADY_INSTALLED",
    changed: false,
    target:
      "scripts/true-forward-oos-automation-binding-v1-contract-test.ts"
  }, null, 2));

  process.exit(0);
}

const anchor =
  "function assert(";

const anchorIndex =
  source.indexOf(anchor);

if (anchorIndex < 0) {
  fail(
    "ASSERT_FUNCTION_ANCHOR_NOT_FOUND"
  );
}

const prefix =
  source.slice(
    0,
    anchorIndex
  );

const body =
  source.slice(
    anchorIndex
  );

source =
  prefix +
  `/* ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_ASYNC_MAIN_V2 */\n` +
  `async function main() {\n` +
  body +
  `\n}\n\n` +
  `main().catch((error) => {\n` +
  `  console.error(JSON.stringify({\n` +
  `    status: "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CONTRACT_FAILED",\n` +
  `    error: String(error instanceof Error ? error.message : error),\n` +
  `    failed: ["contractRuntime"],\n` +
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
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CJS_AWAIT_REPAIR_V2_INSTALLED",
  changed: true,
  repair:
    "WRAP_TOP_LEVEL_AWAITS_IN_ASYNC_MAIN",
  target:
    "scripts/true-forward-oos-automation-binding-v1-contract-test.ts",
  backup:
    "scripts/backups/true-forward-oos-automation-binding-v1-contract-test.before-cjs-await-repair-v2.ts",
  productCodeChanged:
    false,
  safety: {
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionApplied: false,
    realTradingEnabled: false
  },
  nextAction:
    "RERUN_STATIC_AND_CONTRACT"
}, null, 2));
