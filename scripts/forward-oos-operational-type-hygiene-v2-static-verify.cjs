const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const supervisorPath =
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-market-data-maintenance-supervisor-v4.ts"
  );

const configPath =
  path.join(
    ROOT,
    "tsconfig.forward-oos-operational.json"
  );

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    ).replace(
      /^\\uFEFF/,
      ""
    )
  );
}

const checks = {};

if (!fs.existsSync(supervisorPath)) {
  checks.supervisorExists =
    false;
}
else {
  checks.supervisorExists =
    true;

  const source =
    fs.readFileSync(
      supervisorPath,
      "utf8"
    );

  const moduleNeedle =
    "../lib/trading/krx-trading-calendar";

  const moduleReferenceCount =
    source
      .split(
        moduleNeedle
      )
      .length -
    1;

  checks.krxCalendarImportExactlyOnce =
    moduleReferenceCount ===
    1;

  checks.isKrxTradingDateStillUsed =
    source.includes(
      "isKrxTradingDate("
    );
}

if (!fs.existsSync(configPath)) {
  checks.forwardTsconfigExists =
    false;
}
else {
  checks.forwardTsconfigExists =
    true;

  const config =
    readJson(
      configPath
    );

  checks.nodeTypesExplicit =
    Array.isArray(
      config.compilerOptions &&
      config.compilerOptions.types
    ) &&
    config.compilerOptions.types.includes(
      "node"
    );

  checks.nextEnvIncluded =
    Array.isArray(
      config.include
    ) &&
    config.include.includes(
      "next-env.d.ts"
    );

  checks.operationalScriptsStillIncluded =
    Array.isArray(
      config.include
    ) &&
    config.include.includes(
      "scripts/alpha-v3-true-forward-top1-producer-v1.ts"
    ) &&
    config.include.includes(
      "scripts/true-forward-oos-first-real-session-readiness-v1.ts"
    ) &&
    config.include.includes(
      "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts"
    );
}

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_FORWARD_OOS_OPERATIONAL_TYPE_HYGIENE_V2_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_OPERATIONAL_TYPE_HYGIENE_V2_STATIC_FAILED",

      checks,

      interpretation: {
        nodeTypeErrors:
          "should no longer come from missing operational tsconfig Node type context",

        duplicateCalendarImport:
          "exactly one canonical KRX calendar module import is allowed",

        tradingLogicChanged:
          false
      },

      safety: {
        sourceOnly:
          true,

        runtimeExecution:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        promotionExecuted:
          false,

        realTradingEnabled:
          false
      },

      failed,

      nextGate:
        failed.length === 0
          ? "RUN_FORWARD_OOS_OPERATIONAL_TYPECHECK_V2"
          : "REPAIR_FORWARD_OOS_OPERATIONAL_TYPE_HYGIENE_V2"
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
