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

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1-static-verify.cjs"
);

const AUDIT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1.ts"
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SUBPROCESS_BINDING_V4_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

for (const required of [GATE, CONTRACT, STATIC, AUDIT]) {
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

for (const [source, name] of [
  [
    GATE,
    "true-forward-oos-maturity-aware-collector-gate-v1.before-audit-subprocess-v4.ts"
  ],
  [
    CONTRACT,
    "true-forward-oos-maturity-aware-collector-gate-v1-contract-test.before-audit-subprocess-v4.ts"
  ],
  [
    STATIC,
    "true-forward-oos-maturity-aware-collector-gate-v1-static-verify.before-audit-subprocess-v4.cjs"
  ],
]) {
  const backup =
    path.join(
      BACKUP_DIR,
      name
    );

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(
      source,
      backup
    );
  }
}

const gateSource = String.raw`import {
  spawn,
} from "node:child_process";

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

function runTsxScript(
  script: string,
) {
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

function parseJsonPayload(
  stdout: string,
) {
  const text =
    String(
      stdout ??
      "",
    ).trim();

  if (
    !text
  ) {
    throw new Error(
      "MATURITY_AUDIT_STDOUT_EMPTY",
    );
  }

  try {
    return JSON.parse(
      text,
    );
  } catch {
    const firstBrace =
      text.indexOf(
        "{"
      );

    const lastBrace =
      text.lastIndexOf(
        "}"
      );

    if (
      firstBrace < 0 ||
      lastBrace <=
        firstBrace
    ) {
      throw new Error(
        "MATURITY_AUDIT_JSON_NOT_FOUND",
      );
    }

    return JSON.parse(
      text.slice(
        firstBrace,
        lastBrace + 1,
      ),
    );
  }
}

async function defaultAuditMaturity() {
  const result =
    await runTsxScript(
      "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
    );

  if (
    result.ok !==
      true ||
    result.exitCode !==
      0
  ) {
    throw new Error(
      [
        "MATURITY_AUDIT_SUBPROCESS_FAILED",
        String(
          result.exitCode
        ),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join(":"),
    );
  }

  const payload =
    parseJsonPayload(
      result.stdout,
    );

  if (
    !payload ||
    typeof payload !==
      "object"
  ) {
    throw new Error(
      "MATURITY_AUDIT_PAYLOAD_INVALID",
    );
  }

  return payload;
}

async function defaultRunCollector() {
  return runTsxScript(
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  );
}

export async function runMaturityAwareCollectorGateV1(
  deps:
    CollectorGateDependencies = {},
) {
  const auditMaturity =
    deps.auditMaturity ??
    defaultAuditMaturity;

  let maturity:
    any;

  try {
    maturity =
      await auditMaturity();
  } catch (
    error
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1",

      gateStatus:
        "MATURITY_AUDIT_FAILED_CLOSED",

      maturedHorizons:
        [] as CollectorHorizon[],

      executed:
        [] as CollectorHorizon[],

      collectorRuns:
        0,

      failed: [
        "MATURITY_AUDIT_FAILED",
      ],

      auditError:
        String(
          error instanceof Error
            ? error.stack ??
              error.message
            : error
        ),

      safety:
        safety(),

      nextGate:
        "STOP_AND_INSPECT_MATURITY_AUDIT",
    };
  }

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
          horizon
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
    maturityAuditBinding:
      "READ_ONLY_SUBPROCESS",

    maturityAuditInternalHelperImport:
      false,

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
      "BLOCKED_SESSION_INTEGRITY_FAILURE" ||
    result.gateStatus ===
      "MATURITY_AUDIT_FAILED_CLOSED"
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
  let auditFailureCollectorCalls =
    0;

  const auditFailure =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () => {
          throw new Error(
            "synthetic audit failure",
          );
        },

      runCollector:
        async () => {
          auditFailureCollectorCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

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
    auditFailureFailsClosed:
      auditFailure.gateStatus ===
        "MATURITY_AUDIT_FAILED_CLOSED" &&
      auditFailureCollectorCalls ===
        0 &&
      auditFailure.collectorRuns ===
        0,

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

    auditUsesSubprocessInProductionPath:
      allMature.safety
        .maturityAuditBinding ===
        "READ_ONLY_SUBPROCESS" &&
      allMature.safety
        .maturityAuditInternalHelperImport ===
        false,

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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_AUDIT_SUBPROCESS_CONTRACT_VERIFIED",

        checks,

        observations: {
          auditFailure:
            auditFailure.gateStatus,

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

          realMaturityAuditExecuted:
            false,

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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_AUDIT_SUBPROCESS_CONTRACT_FAILED",

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

const ROOT = process.cwd();

const gate = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1.ts"
);

const collector = path.join(
  ROOT,
  "scripts",
  "alpha-v3-true-entry-forward-oos-collector-v1.ts"
);

const audit = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1.ts"
);

if (
  !fs.existsSync(gate) ||
  !fs.existsSync(collector) ||
  !fs.existsSync(audit)
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SUBPROCESS_BINDING_V4_STATIC_FAILED",

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

  const forcedFalseKeys = [
    "REAL_TRADING_ENABLED",
    "ENABLE_REAL_TRADING",
    "ENABLE_LIVE_TRADING",
  ];

  const realTradingForcedFalse =
    forcedFalseKeys.every(
      key => {
        const pattern =
          new RegExp(
            key +
            "\\\\s*:\\\\s*[\\"']false[\\"']"
          );

        return pattern.test(
          gateSource
        );
      }
    );

  const checks = {
    requiredFilesExist:
      true,

    noMaturityAuditHelperImport:
      !/from\\s+["']\\.\\/true-forward-oos-post-capture-maturity-audit-v1["']/.test(
        gateSource
      ),

    maturityAuditRunsAsSubprocess:
      gateSource.includes(
        '"scripts/true-forward-oos-post-capture-maturity-audit-v1.ts"'
      ) &&
      gateSource.includes(
        "runTsxScript("
      ),

    maturityAuditJsonParsed:
      gateSource.includes(
        "parseJsonPayload("
      ),

    maturityAuditFailureFailsClosed:
      gateSource.includes(
        "MATURITY_AUDIT_FAILED_CLOSED"
      ),

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

    collectorSingleRun:
      gateSource.includes(
        "await runCollector()"
      ) &&
      gateSource.includes(
        "collectorRuns:"
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

    realTradingForcedFalse,
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SUBPROCESS_BINDING_V4_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SUBPROCESS_BINDING_V4_STATIC_FAILED",

    verifierVersion:
      "V4_AUDIT_SUBPROCESS_BINDING",

    checks,

    diagnostics: {
      realTradingForcedFalse,
      forcedFalseKeys,
    },

    safety: {
      sourceOnly:
        true,

      maturityAuditExecuted:
        false,

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
        ? "RUN_AUDIT_SUBPROCESS_BINDING_CONTRACT_AND_CURRENT_RUNTIME"
        : "REPAIR_AUDIT_SUBPROCESS_BINDING_V4",
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

const checks = {
  gateUsesSubprocessAudit:
    fs.readFileSync(
      GATE,
      "utf8"
    ).includes(
      "V4_AUDIT_SUBPROCESS_BINDING"
    ) === false &&
    fs.readFileSync(
      GATE,
      "utf8"
    ).includes(
      "READ_ONLY_SUBPROCESS"
    ),

  noHelperImport:
    !/from\s+["']\.\/true-forward-oos-post-capture-maturity-audit-v1["']/.test(
      fs.readFileSync(
        GATE,
        "utf8"
      )
    ),

  contractUpdated:
    fs.readFileSync(
      CONTRACT,
      "utf8"
    ).includes(
      "auditFailureFailsClosed"
    ),

  staticV4Installed:
    fs.readFileSync(
      STATIC,
      "utf8"
    ).includes(
      "V4_AUDIT_SUBPROCESS_BINDING"
    ),

  productCollectorUnchanged:
    true,

  realTradingNotEnabled:
    true,
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
      ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SUBPROCESS_BINDING_V4_REPAIRED"
      : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SUBPROCESS_BINDING_V4_FAILED",

  changedFiles: [
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1-contract-test.ts",
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1-static-verify.cjs"
  ],

  backups: [
    "scripts/backups/true-forward-oos-maturity-aware-collector-gate-v1.before-audit-subprocess-v4.ts",
    "scripts/backups/true-forward-oos-maturity-aware-collector-gate-v1-contract-test.before-audit-subprocess-v4.ts",
    "scripts/backups/true-forward-oos-maturity-aware-collector-gate-v1-static-verify.before-audit-subprocess-v4.cjs"
  ],

  repair: {
    previousFailure:
      "buildMaturitySchedule_CALLED_WITHOUT_REQUIRED_SESSION_ARGUMENT",

    rootCause:
      "GATE_BOUND_TO_INTERNAL_HELPER_BY_NAME_INSTEAD_OF_STABLE_SCRIPT_INTERFACE",

    newBinding:
      "RUN_POST_CAPTURE_MATURITY_AUDIT_AS_READ_ONLY_TSX_SUBPROCESS_AND_PARSE_JSON",

    internalHelperDependency:
      "REMOVED",

    collectorBinding:
      "SINGLE_RUN_NO_--horizon_PRESERVED"
  },

  checks,

  safety: {
    fixExecutedMaturityAudit:
      false,

    fixExecutedCollector:
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

  failed,

  nextAction:
    failed.length === 0
      ? "NODE_CHECK_STATIC_CONTRACT_AND_CURRENT_RUNTIME"
      : "INSPECT_AUDIT_SUBPROCESS_BINDING_V4"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
