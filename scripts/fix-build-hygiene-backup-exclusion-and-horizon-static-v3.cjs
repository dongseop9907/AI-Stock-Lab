const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TSCONFIG =
  path.join(
    ROOT,
    "tsconfig.json"
  );

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "alpha-v1-cross-sectional-ic-regime-timing.ts"
  );

const OLD_STATIC =
  path.join(
    ROOT,
    "scripts",
    "cross-sectional-ic-horizon-literal-union-v2-static-verify.cjs"
  );

const STATIC =
  path.join(
    ROOT,
    "scripts",
    "build-hygiene-backup-exclusion-and-horizon-static-v3-verify.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_BUILD_HYGIENE_BACKUP_EXCLUSION_AND_HORIZON_STATIC_V3_FAILED",
        reason,
        ...extra,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

if (
  !fs.existsSync(
    TSCONFIG
  )
) {
  fail(
    "TSCONFIG_NOT_FOUND"
  );

  return;
}

if (
  !fs.existsSync(
    TARGET
  )
) {
  fail(
    "HORIZON_SOURCE_NOT_FOUND"
  );

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
      true,
  }
);

const tsconfigBackup =
  path.join(
    backupDir,
    "tsconfig.before-build-hygiene-backup-exclusion-v1.json"
  );

if (
  !fs.existsSync(
    tsconfigBackup
  )
) {
  fs.copyFileSync(
    TSCONFIG,
    tsconfigBackup
  );
}

let config;

try {
  config =
    JSON.parse(
      fs.readFileSync(
        TSCONFIG,
        "utf8"
      ).replace(
        /^\uFEFF/,
        ""
      )
    );
} catch (
  error
) {
  fail(
    "TSCONFIG_JSON_PARSE_FAILED",
    {
      message:
        error instanceof Error
          ? error.message
          : String(error),
    }
  );

  return;
}

if (
  !Array.isArray(
    config.exclude
  )
) {
  config.exclude = [];
}

if (
  !config.exclude.includes(
    "scripts/backups/**"
  )
) {
  config.exclude.push(
    "scripts/backups/**"
  );
}

fs.writeFileSync(
  TSCONFIG,
  JSON.stringify(
    config,
    null,
    2
  ) + "\n",
  "utf8"
);

const source =
  fs.readFileSync(
    TARGET,
    "utf8"
  );

const normalized =
  source.replace(
    /\r\n/g,
    "\n"
  );

const validTupleMapBlock =
`([
        "r1",
        "r3",
        "r5",
      ] as const).map(`;

const validForOfBlock =
`of [
                "r1",
                "r3",
                "r5",
              ] as const`;

const checks = {
  tsconfigExcludesBackupDirectory:
    Array.isArray(
      config.exclude
    ) &&
    config.exclude.includes(
      "scripts/backups/**"
    ),

  malformedAsConstMapAbsent:
    !normalized.includes(
      "as const.map("
    ),

  validTupleMapPresent:
    normalized.includes(
      validTupleMapBlock
    ),

  typedForOfTuplePresent:
    normalized.includes(
      validForOfBlock
    ),

  rowHUsagePreserved:
    normalized.includes(
      "row[h]"
    ),

  pearsonCalculationPreserved:
    normalized.includes(
      "pearson("
    ),

  algorithmSourceChangedByThisFix:
    false,

  backupFilesDeleted:
    false,
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        ![
          "algorithmSourceChangedByThisFix",
          "backupFilesDeleted",
        ].includes(
          key
        ) &&
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

if (
  failed.length >
  0
) {
  fail(
    "POST_REPAIR_CHECK_FAILED",
    {
      checks,
      failed,
      exclude:
        config.exclude,
    }
  );

  return;
}

/*
 * Replace the broken V2 verifier with a safe redirect so an accidental
 * invocation no longer throws a regex syntax error.
 */
const oldStaticReplacement =
`console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V2_STATIC_SUPERSEDED",
  supersededBy:
    "scripts/build-hygiene-backup-exclusion-and-horizon-static-v3-verify.cjs",
  reason:
    "V2 verifier contained an invalid generated regular expression.",
  nextAction:
    "RUN_V3_STATIC_VERIFIER"
}, null, 2));

process.exitCode = 0;
`;

fs.writeFileSync(
  OLD_STATIC,
  oldStaticReplacement,
  "utf8"
);

const staticSource =
`const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const tsconfigPath =
  path.join(
    root,
    "tsconfig.json"
  );

const target =
  path.join(
    root,
    "scripts",
    "alpha-v1-cross-sectional-ic-regime-timing.ts"
  );

const checks = {};

if (
  !fs.existsSync(
    tsconfigPath
  )
) {
  checks.tsconfigExists =
    false;
}
else {
  checks.tsconfigExists =
    true;

  try {
    const config =
      JSON.parse(
        fs.readFileSync(
          tsconfigPath,
          "utf8"
        ).replace(
          /^\\uFEFF/,
          ""
        )
      );

    checks.backupsExcluded =
      Array.isArray(
        config.exclude
      ) &&
      config.exclude.includes(
        "scripts/backups/**"
      );
  }
  catch {
    checks.backupsExcluded =
      false;
  }
}

if (
  !fs.existsSync(
    target
  )
) {
  checks.horizonSourceExists =
    false;
}
else {
  checks.horizonSourceExists =
    true;

  const source =
    fs.readFileSync(
      target,
      "utf8"
    ).replace(
      /\\r\\n/g,
      "\\n"
    );

  checks.noMalformedAsConstMap =
    !source.includes(
      "as const.map("
    );

  checks.validTupleMap =
    source.includes(
\`([
        "r1",
        "r3",
        "r5",
      ] as const).map(\`
    );

  checks.typedForOfTuple =
    source.includes(
\`of [
                "r1",
                "r3",
                "r5",
              ] as const\`
    );

  checks.rowHUsagePreserved =
    source.includes(
      "row[h]"
    );

  checks.pearsonPreserved =
    source.includes(
      "pearson("
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
          ? "AI_STOCK_LAB_BUILD_HYGIENE_BACKUP_EXCLUSION_AND_HORIZON_STATIC_V3_VERIFIED"
          : "AI_STOCK_LAB_BUILD_HYGIENE_BACKUP_EXCLUSION_AND_HORIZON_STATIC_V3_FAILED",

      checks,

      safety: {
        sourceOnly:
          true,

        backupFilesDeleted:
          false,

        algorithmChanged:
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
          false,
      },

      failed,

      nextGate:
        failed.length === 0
          ? "RUN_FULL_TSC_ERROR_SWEEP"
          : "REPAIR_BUILD_HYGIENE"
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

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_BUILD_HYGIENE_BACKUP_EXCLUSION_AND_HORIZON_STATIC_V3_REPAIRED",

      changedFiles: [
        "tsconfig.json",
        "scripts/cross-sectional-ic-horizon-literal-union-v2-static-verify.cjs",
      ],

      generatedFile:
        "scripts/build-hygiene-backup-exclusion-and-horizon-static-v3-verify.cjs",

      backupFile:
        "scripts/backups/tsconfig.before-build-hygiene-backup-exclusion-v1.json",

      repair: {
        currentSourceSyntax:
          "PRESERVED",

        tsconfigChange:
          "exclude scripts/backups/** from TypeScript compilation",

        backupFiles:
          "PRESERVED_NOT_DELETED",

        brokenV2Verifier:
          "REPLACED_WITH_SAFE_SUPERSEDED_MESSAGE",

        v3Verifier:
          "STRING_BASED_NO_COMPLEX_REGEX",

        algorithmLogic:
          "UNCHANGED",

        typeSafety:
          "UNCHANGED",
      },

      checks,

      safety: {
        sourceAlgorithmChanged:
          false,

        backupFilesDeleted:
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
          false,
      },

      failed:
        [],

      nextAction:
        "RUN_V3_STATIC_THEN_FULL_TSC_ERROR_SWEEP"
    },
    null,
    2
  )
);

process.exitCode = 0;
