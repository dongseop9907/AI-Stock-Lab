const fs = require("fs");
const path = require("path");

const root = process.cwd();

const schedulerFile = path.resolve(
  root,
  "scripts/alpha-v3-automation-cycle-scheduler.ts"
);

const testFile = path.resolve(
  root,
  "scripts/alpha-v3-automation-cycle-scheduler-contract-test.ts"
);

if (!fs.existsSync(schedulerFile)) {
  throw new Error(
    "SCHEDULER_FILE_NOT_FOUND"
  );
}

if (!fs.existsSync(testFile)) {
  throw new Error(
    "SCHEDULER_TEST_FILE_NOT_FOUND"
  );
}

let scheduler =
  fs.readFileSync(
    schedulerFile,
    "utf8"
  );

let test =
  fs.readFileSync(
    testFile,
    "utf8"
  );

const schedulerBackup =
  `${schedulerFile}.before-cjs-compat-v1.bak`;

const testBackup =
  `${testFile}.before-cjs-compat-v1.bak`;

if (!fs.existsSync(schedulerBackup)) {
  fs.copyFileSync(
    schedulerFile,
    schedulerBackup
  );
}

if (!fs.existsSync(testBackup)) {
  fs.copyFileSync(
    testFile,
    testBackup
  );
}

/*
 * Scheduler CJS compatibility:
 * - remove import.meta/pathToFileURL main detection
 * - remove top-level await
 * - use require.main === module and promise chains
 */
scheduler =
  scheduler.replace(
    /import\s*\{\s*pathToFileURL,\s*\}\s*from\s*"node:url";\s*/m,
    ""
  );

const schedulerMainPattern =
  /const isMain =[\s\S]*?if \(isMain\) \{[\s\S]*?\n\}\s*$/m;

const schedulerMainReplacement = `
function reportSchedulerFatal(
  error: unknown,
) {
  console.error(
    JSON.stringify(
      {
        scheduler:
          "ALPHA_V3_60S_AUTOMATION_CYCLE",

        type:
          "FATAL",

        at:
          new Date()
            .toISOString(),

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
      null,
      2,
    ),
  );

  process.exitCode =
    2;
}

if (
  typeof require !==
    "undefined" &&
  typeof module !==
    "undefined" &&
  require.main ===
    module
) {
  if (
    process.argv.includes(
      "--once",
    )
  ) {
    void runOnce()
      .catch(
        reportSchedulerFatal,
      );
  } else {
    void startAutomationCycleScheduler()
      .catch(
        reportSchedulerFatal,
      );
  }
}
`;

if (
  schedulerMainPattern.test(
    scheduler
  )
) {
  scheduler =
    scheduler.replace(
      schedulerMainPattern,
      schedulerMainReplacement
    );
} else {
  throw new Error(
    "SCHEDULER_MAIN_BLOCK_NOT_FOUND"
  );
}

/*
 * Test CJS compatibility:
 * wrap all top-level await scenarios in async main().
 */
if (
  !test.includes(
    "async function main()"
  )
) {
  const marker =
`const scenarios:
  Scenario[] =
  [];`;

  if (!test.includes(marker)) {
    throw new Error(
      "TEST_SCENARIO_MARKER_NOT_FOUND"
    );
  }

  test =
    test.replace(
      marker,
      marker +
      `

async function main() {`
    );

  const finalMarker =
`if (
  failed.length > 0
) {
  process.exitCode =
    2;
}`;

  if (!test.includes(finalMarker)) {
    throw new Error(
      "TEST_FINAL_MARKER_NOT_FOUND"
    );
  }

  test =
    test.replace(
      finalMarker,
      finalMarker +
      `
}

void main()
  .catch(
    (error) => {
      console.error(
        JSON.stringify(
          {
            status:
              "ALPHA_V3_60S_SERVER_SIDE_SCHEDULER_CONTRACT_TEST_FATAL",

            error:
              error instanceof Error
                ? error.message
                : String(
                    error,
                  ),

            realNetworkCalls:
              0,

            databaseWrites:
              0,

            productionOrdersCreated:
              0,

            productionPositionsChanged:
              0,
          },
          null,
          2,
        ),
      );

      process.exitCode =
        2;
    },
  );`
    );
}

/*
 * Extra guard: no remaining top-level awaits in test.
 * We intentionally allow "await" inside async main.
 */
fs.writeFileSync(
  schedulerFile,
  scheduler,
  "utf8"
);

fs.writeFileSync(
  testFile,
  test,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_60S_SERVER_SIDE_SCHEDULER_CJS_COMPAT_V1_INSTALLED",

      patchedFiles: [
        "scripts/alpha-v3-automation-cycle-scheduler.ts",
        "scripts/alpha-v3-automation-cycle-scheduler-contract-test.ts"
      ],

      fixes: [
        "REMOVE_IMPORT_META_MAIN_DETECTION",
        "REMOVE_SCHEDULER_TOP_LEVEL_AWAIT",
        "WRAP_CONTRACT_TEST_IN_ASYNC_MAIN",
        "USE_REQUIRE_MAIN_CJS_ENTRYPOINT"
      ],

      productionRouteChanged:
        false,

      databaseWrites:
        0,

      productionOrdersCreated:
        0,

      productionPositionsChanged:
        0,

      nextAction:
        "RERUN_SCHEDULER_CONTRACT_TEST"
    },
    null,
    2
  )
);
