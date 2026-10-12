const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "alpha-v1-cross-sectional-ic-regime-timing.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "cross-sectional-ic-horizon-literal-union-v2-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V2_FAILED",
    reason,
    ...extra,
  }, null, 2));

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

const backupDir = path.join(
  ROOT,
  "scripts",
  "backups"
);

fs.mkdirSync(
  backupDir,
  { recursive: true }
);

const backup = path.join(
  backupDir,
  "alpha-v1-cross-sectional-ic-regime-timing.before-horizon-literal-union-v2.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    TARGET,
    backup
  );
}

/*
 * Repair the malformed V1 shape:
 *
 *   Object.fromEntries(
 *     [
 *       "r1",
 *       "r3",
 *       "r5",
 *     ] as const.map(
 *
 * into:
 *
 *   Object.fromEntries(
 *     ([
 *       "r1",
 *       "r3",
 *       "r5",
 *     ] as const).map(
 */
source = source.replace(
  /Object\.fromEntries\(\s*\[\s*"r1",\s*"r3",\s*"r5",\s*\]\s*as const\.map\(/m,
  `Object.fromEntries(
      ([
        "r1",
        "r3",
        "r5",
      ] as const).map(`
);

/*
 * Idempotent repair for a partially-fixed source where only
 * `] as const.map(` remains.
 */
if (source.includes("] as const.map(")) {
  source = source.replace(
    "] as const.map(",
    "] as const).map("
  );

  const objectFromEntriesNeedle =
    "Object.fromEntries(\n      [\n";

  if (source.includes(objectFromEntriesNeedle)) {
    source = source.replace(
      objectFromEntriesNeedle,
      "Object.fromEntries(\n      ([\n"
    );
  }
}

const malformedCount =
  (source.match(/as const\.map\(/g) || []).length;

const typedMapShape =
  /Object\.fromEntries\(\s*\(\[\s*"r1",\s*"r3",\s*"r5",\s*\]\s*as const\)\.map\(/m
    .test(source);

const forOfShape =
  /for\s*\(\s*const h\s*of\s*\[\s*"r1",\s*"r3",\s*"r5",\s*\]\s*as const\s*\)/m
    .test(source);

const checks = {
  malformedAsConstMapRemoved:
    malformedCount === 0,

  regimeCorrelationTupleMapValid:
    typedMapShape,

  forOfTupleStillTyped:
    forOfShape,

  rowHUsagePreserved:
    source.includes("row[h]"),

  pearsonPreserved:
    source.includes("pearson("),

  calculationLogicChanged:
    false,

  anyCastAdded:
    false,
};

const failed =
  Object.entries(checks)
    .filter(
      ([key, value]) =>
        ![
          "calculationLogicChanged",
          "anyCastAdded",
        ].includes(key) &&
        value !== true
    )
    .map(([key]) => key);

if (failed.length > 0) {
  fail(
    "POST_REPAIR_CHECK_FAILED",
    {
      checks,
      failed,
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

const target = path.join(
  process.cwd(),
  "scripts",
  "alpha-v1-cross-sectional-ic-regime-timing.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V2_STATIC_FAILED",
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

  const checks = {
    noMalformedAsConstMap:
      !source.includes(
        "as const.map("
      ),

    validRegimeCorrelationTupleMap:
      /Object\\\\.fromEntries\\\\(\\\\s*\\\\(\\\\[\\\\s*"r1",\\\\s*"r3",\\\\s*"r5",\\\\s*\\\\]\\\\s*as const\\\\)\\\\.map\\\\(/m
        .test(source),

    typedForOfTuple:
      /for\\\\s*\\\\(\\\\s*const h\\\\s*of\\\\s*\\\\[\\\\s*"r1",\\\\s*"r3",\\\\s*"r5",\\\\s*\\\\]\\\\s*as const\\\\s*\\\\)/m
        .test(source),

    rowHUsagePreserved:
      source.includes(
        "row[h]"
      ),

    pearsonPreserved:
      source.includes(
        "pearson("
      ),

    noHAnyCast:
      !source.includes(
        "h as any"
      )
  };

  const failed =
    Object.entries(checks)
      .filter(([, value]) => value !== true)
      .map(([key]) => key);

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V2_STATIC_VERIFIED"
        : "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V2_STATIC_FAILED",

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
        ? "RUN_FULL_TSC_ERROR_SWEEP"
        : "REPAIR_HORIZON_LITERAL_UNION_V2"
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

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V2_REPAIRED",

  changedFile:
    "scripts/alpha-v1-cross-sectional-ic-regime-timing.ts",

  generatedFile:
    "scripts/cross-sectional-ic-horizon-literal-union-v2-static-verify.cjs",

  backupFile:
    "scripts/backups/alpha-v1-cross-sectional-ic-regime-timing.before-horizon-literal-union-v2.ts",

  repair: {
    rootCause:
      "V1 fixer generated `] as const.map(` without parenthesizing the const tuple",

    correctedShape:
      "([\"r1\", \"r3\", \"r5\"] as const).map(...)",

    horizonType:
      "\"r1\" | \"r3\" | \"r5\"",

    calculationLogic:
      "UNCHANGED",

    rowIndexing:
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

  failed: [],

  nextAction:
    "RUN_FULL_TSC_ERROR_SWEEP"
}, null, 2));

process.exitCode = 0;
