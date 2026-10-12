const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const GATE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1-contract-test.ts"
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1-static-verify.cjs"
);

const PACKAGE = path.join(
  ROOT,
  "package.json"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V2_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

for (const required of [GATE, CONTRACT, PACKAGE]) {
  if (!fs.existsSync(required)) {
    fail(
      "REQUIRED_FILE_MISSING",
      { required }
    );
    return;
  }
}

fs.mkdirSync(
  BACKUP_DIR,
  { recursive: true }
);

const gateBackup = path.join(
  BACKUP_DIR,
  "true-forward-oos-maturity-aware-collector-gate-v1.before-single-run-v2.ts"
);

const contractBackup = path.join(
  BACKUP_DIR,
  "true-forward-oos-maturity-aware-collector-gate-v1-contract-test.before-single-run-v2.ts"
);

if (!fs.existsSync(gateBackup)) {
  fs.copyFileSync(
    GATE,
    gateBackup
  );
}

if (!fs.existsSync(contractBackup)) {
  fs.copyFileSync(
    CONTRACT,
    contractBackup
  );
}

const gateSource = String.raw`import {
  spawn,
} from "node:child_process";

import {
  auditPostCaptureMaturityV1,
  type Horizon,
} from "./true-forward-oos-post-capture-maturity-audit-v1";

export type CollectorHorizon =
  | "1D"
  | "3D"
  | "5D";

export interface CollectorGateDependencies {
  auditMaturity?: () => Promise<any> | any;

  runCollector?: () => Promise<{
    ok: boolean;
    exitCode: number;
    stdout?: string;
    stderr?: string;
  }>;
}

const HORIZONS:
  CollectorHorizon[] = [
    "1D",
    "3D",
    "5D",
  ];

async function defaultRunCollector() {
  const script =
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts";

  return new Promise<{
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>(
    resolve => {
      const child =
        spawn(
          process.execPath,
          [
            "--env-file=.env.local",
            "--import",
            "tsx",
            script,
          ],
          {
            cwd:
              process.cwd(),

            env: {
              ...process.env,

              REAL_TRADING_ENABLED:
                "false",

              ENABLE_REAL_TRADING:
                "false",

              ENABLE_LIVE_TRADING:
                "false",
            },

            shell:
              false,
          },
        );

      let stdout =
        "";

      let stderr =
        "";

      child.stdout?.on(
        "data",
        chunk => {
          stdout +=
            String(
              chunk
            );
        },
      );

      child.stderr?.on(
        "data",
        chunk => {
          stderr +=
            String(
              chunk
            );
        },
      );

      child.on(
        "close",
        code => {
          const exitCode =
            typeof code ===
              "number"
              ? code
              : 1;

          resolve({
            ok:
              exitCode ===
              0,

            exitCode,
            stdout,
            stderr,
          });
        },
      );

      child.on(
        "error",
        error => {
          resolve({
            ok:
              false,

            exitCode:
              1,

            stdout,
            stderr:
              stderr +
              String(
                error instanceof Error
                  ? error.stack ??
                    error.message
                  : error
              ),
          });
        },
      );
    },
  );
}

export async function runMaturityAwareCollectorGateV1(
  deps:
    CollectorGateDependencies = {},
) {
  const auditMaturity =
    deps.auditMaturity ??
    auditPostCaptureMaturityV1;

  const maturity =
    await auditMaturity();

  if (
    maturity.status ===
    "WAITING_FOR_FORWARD_SESSION"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1",

      gateStatus:
        "WAITING_FOR_FORWARD_SESSION",

      maturedHorizons:
        [] as CollectorHorizon[],

      executed:
        [] as CollectorHorizon[],

      collectorRuns:
        0,

      failed:
        [],

      maturity,

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_CONTROLLED_NORMAL_PRODUCER_SESSION",
    };
  }

  if (
    maturity.integrityStatus ===
      "FAILED" ||
    (
      Array.isArray(
        maturity.invalidSessions
      ) &&
      maturity.invalidSessions.length >
        0
    )
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1",

      gateStatus:
        "BLOCKED_SESSION_INTEGRITY_FAILURE",

      maturedHorizons:
        [] as CollectorHorizon[],

      executed:
        [] as CollectorHorizon[],

      collectorRuns:
        0,

      failed: [
        "SESSION_INTEGRITY_FAILURE",
      ],

      maturity,

      safety:
        safety(),

      nextGate:
        "REPAIR_FORWARD_SESSION_INTEGRITY",
    };
  }

  const maturityReady =
    maturity.maturityReady ??
    {};

  const maturedHorizons =
    HORIZONS.filter(
      horizon =>
        maturityReady[
          horizon as Horizon
        ] ===
        true
    );

  if (
    maturedHorizons.length ===
    0
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1",

      gateStatus:
        "WAITING_FOR_MATURITY",

      maturedHorizons,

      executed:
        [] as CollectorHorizon[],

      collectorRuns:
        0,

      failed:
        [],

      maturity,

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_1D_MATURITY",
    };
  }

  const runCollector =
    deps.runCollector ??
    defaultRunCollector;

  const collectorResult =
    await runCollector();

  if (
    collectorResult.ok !==
    true ||
    collectorResult.exitCode !==
    0
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1",

      gateStatus:
        "COLLECTOR_FAILED_CLOSED",

      maturedHorizons,

      executed:
        [] as CollectorHorizon[],

      collectorRuns:
        1,

      failed: [
        "COLLECTOR_SUBPROCESS_FAILED",
      ],

      collectorResult,

      maturity,

      safety:
        safety(),

      nextGate:
        "STOP_AND_INSPECT_COLLECTOR_FAILURE",
    };
  }

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1",

    gateStatus:
      "MATURE_OUTCOME_COLLECTION_COMPLETED",

    maturedHorizons,

    executed:
      maturedHorizons,

    collectorRuns:
      1,

    collectorResult: {
      ok:
        collectorResult.ok,

      exitCode:
        collectorResult.exitCode,
    },

    failed:
      [],

    maturity,

    safety:
      safety(),

    nextGate:
      "VERIFY_1D_3D_5D_OUTCOME_ROWS_AND_TRUE_FORWARD_OOS_SUMMARY",
  };
}

function safety() {
  return {
    collectorSingleRunBinding:
      true,

    collectorCliHorizonArgumentUsed:
      false,

    collectorMayPopulateAllAvailableHorizons:
      true,

    evaluatorExecuted:
      false,

    summaryExecuted:
      false,

    promotionExecuted:
      false,

    databaseWritesByGate:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    realTradingEnabled:
      false,
  };
}

async function main() {
  const result =
    await runMaturityAwareCollectorGateV1();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.gateStatus ===
      "COLLECTOR_FAILED_CLOSED" ||
    result.gateStatus ===
      "BLOCKED_SESSION_INTEGRITY_FAILURE"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-maturity-aware-collector-gate-v1.ts"
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_ERROR",

            error:
              String(
                error instanceof Error
                  ? error.stack ??
                    error.message
                  : error
              ),

            safety:
              safety(),
          },
          null,
          2,
        ),
      );

      process.exitCode = 1;
    },
  );
}
`;

const contractSource = String.raw`import assert from "node:assert/strict";

import {
  runMaturityAwareCollectorGateV1,
} from "./true-forward-oos-maturity-aware-collector-gate-v1";

function audit(
  ready: {
    "1D": boolean;
    "3D": boolean;
    "5D": boolean;
  },
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1",

    integrityStatus:
      "VERIFIED",

    invalidSessions:
      [],

    maturityReady:
      ready,
  };
}

async function main() {
  let waitingCalls =
    0;

  const waiting =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () => ({
          status:
            "WAITING_FOR_FORWARD_SESSION",

          integrityStatus:
            "WAITING",

          invalidSessions:
            [],

          maturityReady: {
            "1D": false,
            "3D": false,
            "5D": false,
          },
        }),

      runCollector:
        async () => {
          waitingCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

  let notMatureCalls =
    0;

  const notMature =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () =>
          audit({
            "1D": false,
            "3D": false,
            "5D": false,
          }),

      runCollector:
        async () => {
          notMatureCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

  let oneDayCalls =
    0;

  const oneDay =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () =>
          audit({
            "1D": true,
            "3D": false,
            "5D": false,
          }),

      runCollector:
        async () => {
          oneDayCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

  let allMatureCalls =
    0;

  const allMature =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () =>
          audit({
            "1D": true,
            "3D": true,
            "5D": true,
          }),

      runCollector:
        async () => {
          allMatureCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

  let failureCalls =
    0;

  const collectorFailure =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () =>
          audit({
            "1D": true,
            "3D": true,
            "5D": false,
          }),

      runCollector:
        async () => {
          failureCalls +=
            1;

          return {
            ok:
              false,

            exitCode:
              1,

            stderr:
              "synthetic failure",
          };
        },
    });

  let integrityCalls =
    0;

  const integrityFailure =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () => ({
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1",

          integrityStatus:
            "FAILED",

          invalidSessions: [
            {
              reason:
                "synthetic",
            },
          ],

          maturityReady: {
            "1D": true,
            "3D": true,
            "5D": true,
          },
        }),

      runCollector:
        async () => {
          integrityCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

  const checks = {
    waitingNoExecution:
      waiting.gateStatus ===
        "WAITING_FOR_FORWARD_SESSION" &&
      waitingCalls ===
        0 &&
      waiting.collectorRuns ===
        0,

    notMatureNoExecution:
      notMature.gateStatus ===
        "WAITING_FOR_MATURITY" &&
      notMatureCalls ===
        0 &&
      notMature.collectorRuns ===
        0,

    oneDayRunsCollectorExactlyOnce:
      oneDay.gateStatus ===
        "MATURE_OUTCOME_COLLECTION_COMPLETED" &&
      oneDayCalls ===
        1 &&
      oneDay.collectorRuns ===
        1,

    oneDayTracksMaturedHorizon:
      JSON.stringify(
        oneDay.maturedHorizons
      ) ===
      JSON.stringify([
        "1D",
      ]),

    allMatureStillRunsCollectorExactlyOnce:
      allMature.gateStatus ===
        "MATURE_OUTCOME_COLLECTION_COMPLETED" &&
      allMatureCalls ===
        1 &&
      allMature.collectorRuns ===
        1,

    allMatureTracksAllHorizons:
      JSON.stringify(
        allMature.maturedHorizons
      ) ===
      JSON.stringify([
        "1D",
        "3D",
        "5D",
      ]),

    collectorFailureFailsClosedAfterOneCall:
      collectorFailure.gateStatus ===
        "COLLECTOR_FAILED_CLOSED" &&
      failureCalls ===
        1 &&
      collectorFailure.collectorRuns ===
        1,

    integrityFailureSkipsCollector:
      integrityFailure.gateStatus ===
        "BLOCKED_SESSION_INTEGRITY_FAILURE" &&
      integrityCalls ===
        0,

    noCliHorizonArgumentSemantics:
      oneDay.safety
        .collectorCliHorizonArgumentUsed ===
        false &&
      allMature.safety
        .collectorSingleRunBinding ===
        true,

    noTradingSideEffects:
      allMature.safety
        .ordersCreated ===
        0 &&
      allMature.safety
        .positionsChanged ===
        0 &&
      allMature.safety
        .realTradingEnabled ===
        false,
  };

  for (
    const [
      key,
      value,
    ] of Object.entries(
      checks,
    )
  ) {
    assert.equal(
      value,
      true,
      key,
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_SINGLE_RUN_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.gateStatus,

          notMature:
            notMature.gateStatus,

          oneDay: {
            gateStatus:
              oneDay.gateStatus,

            maturedHorizons:
              oneDay.maturedHorizons,

            collectorRuns:
              oneDay.collectorRuns,
          },

          allMature: {
            gateStatus:
              allMature.gateStatus,

            maturedHorizons:
              allMature.maturedHorizons,

            collectorRuns:
              allMature.collectorRuns,
          },

          collectorFailure:
            collectorFailure.gateStatus,

          integrityFailure:
            integrityFailure.gateStatus,
        },

        safety: {
          syntheticOnly:
            true,

          realCollectorExecuted:
            false,

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

        nextGate:
          "STATIC_VERIFY_THEN_RUN_CURRENT_GATE_EXPECT_WAITING",
      },
      null,
      2,
    ),
  );
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_SINGLE_RUN_CONTRACT_FAILED",

          error:
            String(
              error instanceof Error
                ? error.stack ??
                  error.message
                : error
            ),
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
`;

const staticSource = String.raw`const fs = require("fs");
const path = require("path");

const gate = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1.ts"
);

const collector = path.join(
  process.cwd(),
  "scripts",
  "alpha-v3-true-entry-forward-oos-collector-v1.ts"
);

if (
  !fs.existsSync(gate) ||
  !fs.existsSync(collector)
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V2_STATIC_FAILED",

    failed: [
      "requiredFilesExist"
    ],
  }, null, 2));

  process.exitCode = 1;
} else {
  const gateSource =
    fs.readFileSync(
      gate,
      "utf8"
    );

  const collectorSource =
    fs.readFileSync(
      collector,
      "utf8"
    );

  const checks = {
    requiredFilesExist:
      true,

    collectorStillHasNoHorizonCli:
      !collectorSource.includes(
        "--horizon"
      ) &&
      !collectorSource.includes(
        "process.argv"
      ),

    gateNoLongerPassesHorizonCli:
      !gateSource.includes(
        '"--horizon"'
      ),

    collectorSpawnStillPresent:
      gateSource.includes(
        "spawn("
      ),

    collectorRunsOnceContract:
      gateSource.includes(
        "collectorRuns:"
      ) &&
      gateSource.includes(
        "await runCollector()"
      ),

    maturedHorizonsTracked:
      gateSource.includes(
        "maturedHorizons"
      ),

    r1r3r5CollectorNative:
      collectorSource.includes(
        "r1:"
      ) &&
      collectorSource.includes(
        "r3:"
      ) &&
      collectorSource.includes(
        "r5:"
      ) &&
      collectorSource.includes(
        "directReturns"
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        gateSource
      ),

    realTradingForcedFalse:
      gateSource.includes(
        'REAL_TRADING_ENABLED:\\n                "false"'
      ) &&
      gateSource.includes(
        'ENABLE_REAL_TRADING:\\n                "false"'
      ) &&
      gateSource.includes(
        'ENABLE_LIVE_TRADING:\\n                "false"'
      ),
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V2_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V2_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      collectorExecuted:
        false,

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
        ? "RUN_SINGLE_RUN_COLLECTOR_BINDING_CONTRACT"
        : "REPAIR_SINGLE_RUN_COLLECTOR_BINDING_V2",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

fs.writeFileSync(
  GATE,
  gateSource,
  "utf8"
);

fs.writeFileSync(
  CONTRACT,
  contractSource,
  "utf8"
);

fs.writeFileSync(
  STATIC,
  staticSource,
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
  return;
}

pkg.scripts ||= {};

pkg.scripts[
  "test:true-forward-oos-maturity-aware-collector-gate-static"
] =
  "node ./scripts/true-forward-oos-maturity-aware-collector-gate-v1-static-verify.cjs";

pkg.scripts[
  "test:true-forward-oos-maturity-aware-collector-gate"
] =
  "tsx --env-file=.env.local ./scripts/true-forward-oos-maturity-aware-collector-gate-v1-contract-test.ts";

pkg.scripts[
  "forward-oos:maturity-aware-collector-gate"
] =
  "tsx --env-file=.env.local ./scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts";

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
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V2_INSTALLED",

  changedFiles: [
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1-contract-test.ts"
  ],

  generatedFile:
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1-static-verify.cjs",

  backups: [
    "scripts/backups/true-forward-oos-maturity-aware-collector-gate-v1.before-single-run-v2.ts",
    "scripts/backups/true-forward-oos-maturity-aware-collector-gate-v1-contract-test.before-single-run-v2.ts"
  ],

  repair: {
    confirmedProblem:
      "MATURITY_GATE_PASSED_UNSUPPORTED_--horizon_ARGUMENT_TO_COLLECTOR",

    oldBehavior:
      "RUN_COLLECTOR_ONCE_PER_MATURE_HORIZON_WITH_--horizon",

    newBehavior:
      "RUN_COLLECTOR_EXACTLY_ONCE_WHEN_ANY_HORIZON_IS_MATURE",

    cliHorizonArgument:
      "REMOVED",

    maturedHorizons:
      "TRACKED_IN_GATE_RESULT_ONLY",

    rationale:
      "COLLECTOR_NATIVE_RUN_ALREADY_COMPUTES_R1_R3_R5"
  },

  safety: {
    collectorExecutedByInstaller:
      false,

    evaluatorExecuted:
      false,

    summaryExecuted:
      false,

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

  nextAction:
    "RUN_STATIC_CONTRACT_AND_CURRENT_GATE"
}, null, 2));

process.exitCode = 0;
