const fs = require("fs");
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
          /^\uFEFF/,
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
      /\r\n/g,
      "\n"
    );

  checks.noMalformedAsConstMap =
    !source.includes(
      "as const.map("
    );

  checks.validTupleMap =
    source.includes(
`([
        "r1",
        "r3",
        "r5",
      ] as const).map(`
    );

  checks.typedForOfTuple =
    source.includes(
`of [
                "r1",
                "r3",
                "r5",
              ] as const`
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
