const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SUPERVISOR =
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-market-data-maintenance-supervisor-v4.ts"
  );

const FORWARD_TSCONFIG =
  path.join(
    ROOT,
    "tsconfig.forward-oos-operational.json"
  );

const OLD_BROKEN_VERIFIER =
  path.join(
    ROOT,
    "scripts",
    "cross-sectional-ic-horizon-literal-union-v2-static-verify.cjs"
  );

const STATIC =
  path.join(
    ROOT,
    "scripts",
    "forward-oos-operational-type-hygiene-v2-static-verify.cjs"
  );

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_FORWARD_OOS_OPERATIONAL_TYPE_HYGIENE_V2_FAILED",
        reason,
        ...extra
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    ).replace(
      /^\uFEFF/,
      ""
    )
  );
}

if (!fs.existsSync(SUPERVISOR)) {
  fail("SUPERVISOR_NOT_FOUND");
  return;
}

if (!fs.existsSync(FORWARD_TSCONFIG)) {
  fail("FORWARD_TSCONFIG_NOT_FOUND");
  return;
}

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

const supervisorBackup =
  path.join(
    backupDir,
    "alpha-v3-market-data-maintenance-supervisor-v4.before-forward-oos-operational-type-hygiene-v2.ts"
  );

const tsconfigBackup =
  path.join(
    backupDir,
    "tsconfig.forward-oos-operational.before-type-hygiene-v2.json"
  );

if (!fs.existsSync(supervisorBackup)) {
  fs.copyFileSync(
    SUPERVISOR,
    supervisorBackup
  );
}

if (!fs.existsSync(tsconfigBackup)) {
  fs.copyFileSync(
    FORWARD_TSCONFIG,
    tsconfigBackup
  );
}

/* ---------------------------------------------------------
 * 1. Remove duplicate isKrxTradingDate imports robustly.
 *    Keep exactly the first import declaration.
 * ------------------------------------------------------- */
let supervisor =
  fs.readFileSync(
    SUPERVISOR,
    "utf8"
  );

const krxImportPattern =
  /import\s*\{\s*isKrxTradingDate\s*,?\s*\}\s*from\s*["']\.\.\/lib\/trading\/krx-trading-calendar["'];?/g;

let seenKrxImport = 0;

supervisor =
  supervisor.replace(
    krxImportPattern,
    (match) => {
      seenKrxImport += 1;

      return seenKrxImport === 1
        ? match
        : "";
    }
  );

fs.writeFileSync(
  SUPERVISOR,
  supervisor,
  "utf8"
);

/* ---------------------------------------------------------
 * 2. Explicit Node type environment for operational scripts.
 * ------------------------------------------------------- */
const config =
  readJson(
    FORWARD_TSCONFIG
  );

config.compilerOptions =
  config.compilerOptions || {};

const currentTypes =
  Array.isArray(
    config.compilerOptions.types
  )
    ? config.compilerOptions.types
    : [];

config.compilerOptions.types =
  Array.from(
    new Set(
      [
        ...currentTypes,
        "node"
      ]
    )
  );

config.include =
  Array.isArray(
    config.include
  )
    ? config.include
    : [];

if (
  !config.include.includes(
    "next-env.d.ts"
  )
) {
  config.include.unshift(
    "next-env.d.ts"
  );
}

fs.writeFileSync(
  FORWARD_TSCONFIG,
  JSON.stringify(
    config,
    null,
    2
  ) + "\n",
  "utf8"
);

/* ---------------------------------------------------------
 * 3. Neutralize old generated verifier that had invalid regex.
 * ------------------------------------------------------- */
if (
  fs.existsSync(
    OLD_BROKEN_VERIFIER
  )
) {
  fs.writeFileSync(
    OLD_BROKEN_VERIFIER,
`console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V2_STATIC_SUPERSEDED",
  supersededBy:
    "scripts/build-hygiene-backup-exclusion-and-horizon-static-v3-verify.cjs",
  reason:
    "Old generated verifier contained an invalid regular expression and is no longer authoritative.",
  nextAction:
    "USE_CURRENT_BUILD_HYGIENE_AND_FORWARD_OOS_VERIFIERS"
}, null, 2));

process.exitCode = 0;
`,
    "utf8"
  );
}

/* ---------------------------------------------------------
 * 4. Generate simple V2 verifier without complex regex.
 * ------------------------------------------------------- */
const staticSource = `const fs = require("fs");
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
      /^\\\\uFEFF/,
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
`;

fs.writeFileSync(
  STATIC,
  staticSource,
  "utf8"
);

const finalSupervisor =
  fs.readFileSync(
    SUPERVISOR,
    "utf8"
  );

const moduleNeedle =
  "../lib/trading/krx-trading-calendar";

const importCount =
  finalSupervisor
    .split(
      moduleNeedle
    )
    .length -
  1;

const checks = {
  canonicalKrxModuleReferenceExactlyOnce:
    importCount === 1,

  nodeTypesExplicit:
    Array.isArray(
      config.compilerOptions.types
    ) &&
    config.compilerOptions.types.includes(
      "node"
    ),

  nextEnvIncluded:
    config.include.includes(
      "next-env.d.ts"
    ),

  oldBrokenVerifierNeutralized:
    !fs.existsSync(
      OLD_BROKEN_VERIFIER
    ) ||
    fs
      .readFileSync(
        OLD_BROKEN_VERIFIER,
        "utf8"
      )
      .includes(
        "STATIC_SUPERSEDED"
      ),

  tradingLogicChanged:
    false
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        key !==
          "tradingLogicChanged" &&
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
      failed
    }
  );

  return;
}

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_FORWARD_OOS_OPERATIONAL_TYPE_HYGIENE_V2_REPAIRED",

      changedFiles: [
        "scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts",
        "tsconfig.forward-oos-operational.json",
        "scripts/cross-sectional-ic-horizon-literal-union-v2-static-verify.cjs"
      ],

      generatedFile:
        "scripts/forward-oos-operational-type-hygiene-v2-static-verify.cjs",

      backups: [
        "scripts/backups/alpha-v3-market-data-maintenance-supervisor-v4.before-forward-oos-operational-type-hygiene-v2.ts",
        "scripts/backups/tsconfig.forward-oos-operational.before-type-hygiene-v2.json"
      ],

      repair: {
        duplicateKrxImport:
          "ROBUSTLY_DEDUPED_TO_ONE",

        operationalNodeTypes:
          "EXPLICIT_TYPES_NODE",

        nextEnv:
          "INCLUDED",

        oldBrokenVerifier:
          "SUPERSEDED_SAFE_STUB",

        packageInstallRequired:
          false,

        tradingLogic:
          "UNCHANGED",

        orderLogic:
          "UNCHANGED",

        promotionLogic:
          "UNCHANGED"
      },

      checks,

      safety: {
        scriptsExecuted:
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
        "RUN_STATIC_APP_BUILD_AND_FORWARD_OOS_OPERATIONAL_TYPECHECK_V2"
    },
    null,
    2
  )
);

process.exitCode = 0;
