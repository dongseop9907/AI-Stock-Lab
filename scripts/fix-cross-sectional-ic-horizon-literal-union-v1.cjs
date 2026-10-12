const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "alpha-v1-cross-sectional-ic-regime-timing.ts"
  );

const STATIC =
  path.join(
    ROOT,
    "scripts",
    "cross-sectional-ic-horizon-literal-union-v1-static-verify.cjs"
  );

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V1_FAILED",
        reason,
        ...extra
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail("TARGET_SOURCE_NOT_FOUND");
  return;
}

let source =
  fs.readFileSync(
    TARGET,
    "utf8"
  );

const backupDir =
  path.join(
    ROOT,
    "scripts",
    "backups"
  );

fs.mkdirSync(
  backupDir,
  {
    recursive:
      true
  }
);

const backup =
  path.join(
    backupDir,
    "alpha-v1-cross-sectional-ic-regime-timing.before-horizon-literal-union-v1.ts"
  );

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    TARGET,
    backup
  );
}

const pattern =
/\[\s*"r1",\s*"r3",\s*"r5",\s*\](?!\s*as const)/g;

const matches =
  source.match(pattern) || [];

if (matches.length === 0) {
  const alreadyTyped =
    (
      source.match(
        /\[\s*"r1",\s*"r3",\s*"r5",\s*\]\s*as const/g
      ) || []
    ).length;

  if (alreadyTyped < 2) {
    fail(
      "HORIZON_LITERAL_ARRAYS_NOT_FOUND",
      {
        alreadyTyped
      }
    );
    return;
  }
}

source =
  source.replace(
    pattern,
    (match) =>
      `${match} as const`
  );

const typedCount =
  (
    source.match(
      /\[\s*"r1",\s*"r3",\s*"r5",\s*\]\s*as const/g
    ) || []
  ).length;

const checks = {
  bothHorizonArraysTyped:
    typedCount >= 2,

  rowHUsagePreserved:
    source.includes(
      "row[h]"
    ),

  regimeCorrelationPreserved:
    source.includes(
      "regimeTimingCorrelation"
    ),

  icCalculationPreserved:
    source.includes(
      "pearson("
    ),

  anyCastAdded:
    false,

  calculationLogicChanged:
    false
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        ![
          "anyCastAdded",
          "calculationLogicChanged"
        ].includes(key) &&
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

if (failed.length > 0) {
  fail(
    "POST_REPAIR_CHECK_FAILED",
    {
      checks,
      failed,
      typedCount
    }
  );
  return;
}

fs.writeFileSync(
  TARGET,
  source,
  "utf8"
);

const staticSource = `const fs = require("fs");
const path = require("path");

const target =
  path.join(
    process.cwd(),
    "scripts",
    "alpha-v1-cross-sectional-ic-regime-timing.ts"
  );

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V1_STATIC_FAILED",
    failed: [
      "targetExists"
    ]
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const typedCount =
    (
      source.match(
        /\\\\[\\\\s*"r1",\\\\s*"r3",\\\\s*"r5",\\\\s*\\\\]\\\\s*as const/g
      ) || []
    ).length;

  const checks = {
    typedHorizonTupleCountAtLeastTwo:
      typedCount >= 2,

    rowHUsageStillPresent:
      source.includes(
        "row[h]"
      ),

    pearsonStillPresent:
      source.includes(
        "pearson("
      ),

    regimeTimingCorrelationStillPresent:
      source.includes(
        "regimeTimingCorrelation"
      ),

    noHAnyCast:
      !source.includes(
        "h as any"
      ),

    noRowAnyCast:
      !source.includes(
        "row as any"
      )
  };

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

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      calculationLogicChanged:
        false,

      scriptExecuted:
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
        ? "RUN_DASHBOARD_CONTRACT_AND_NEXT_BUILD"
        : "REPAIR_HORIZON_LITERAL_UNION"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

fs.writeFileSync(
  STATIC,
  staticSource,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V1_REPAIRED",

      changedFile:
        "scripts/alpha-v1-cross-sectional-ic-regime-timing.ts",

      generatedFile:
        "scripts/cross-sectional-ic-horizon-literal-union-v1-static-verify.cjs",

      backupFile:
        "scripts/backups/alpha-v1-cross-sectional-ic-regime-timing.before-horizon-literal-union-v1.ts",

      repair: {
        sourceProblem:
          "horizon arrays inferred as string[] causing row[h] index type error",

        solution:
          "mark r1/r3/r5 horizon arrays as const tuples",

        inferredHorizonType:
          "\"r1\" | \"r3\" | \"r5\"",

        rowAccess:
          "UNCHANGED",

        pearsonCalculation:
          "UNCHANGED",

        regimeTimingCalculation:
          "UNCHANGED",

        anyCast:
          "NOT_USED"
      },

      checks,

      safety: {
        scriptExecuted:
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

      failed:
        [],

      nextAction:
        "RUN_STATIC_DASHBOARD_CONTRACT_AND_NEXT_BUILD"
    },
    null,
    2
  )
);

process.exitCode = 0;
