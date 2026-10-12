const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

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

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
  "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(ROOT, rel)
      )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    { missing }
  );
} else {
  const gateSource = `import {
  spawn,
} from "node:child_process";

import {
  auditForwardSessions,
  type AuditInput,
} from "./true-forward-oos-post-capture-maturity-audit-v1";

export type CollectorHorizon =
  | "1D"
  | "3D"
  | "5D";

export interface CollectorGateDependencies {
  runCollector?: (
    horizon: CollectorHorizon,
  ) => Promise<{
    exitCode: number;
    stdout?: string;
    stderr?: string;
  }>;

  auditInput?: AuditInput;
}

const HORIZONS:
  CollectorHorizon[] = [
    "1D",
    "3D",
    "5D",
  ];

async function defaultRunCollector(
  horizon: CollectorHorizon,
) {
  const script =
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts";

  return await new Promise<{
    exitCode: number;
    stdout?: string;
    stderr?: string;
  }>(
    resolve => {
      let stdout = "";
      let stderr = "";

      const child =
        spawn(
          process.execPath,
          [
            "--env-file=.env.local",
            "--import",
            "tsx",
            script,
            "--horizon",
            horizon,
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

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],

            shell:
              false,
          },
        );

      child.stdout?.on(
        "data",
        chunk => {
          stdout +=
            String(chunk);
        },
      );

      child.stderr?.on(
        "data",
        chunk => {
          stderr +=
            String(chunk);
        },
      );

      child.on(
        "error",
        error => {
          resolve({
            exitCode:
              1,

            stdout,

            stderr:
              stderr +
              String(
                error instanceof Error
                  ? error.message
                  : error,
              ),
          });
        },
      );

      child.on(
        "close",
        code => {
          resolve({
            exitCode:
              typeof code ===
              "number"
                ? code
                : 1,

            stdout,

            stderr,
          });
        },
      );
    },
  );
}

export async function runMaturityAwareCollectorGateV1(
  deps: CollectorGateDependencies = {},
) {
  const audit =
    auditForwardSessions(
      deps.auditInput,
    );

  if (
    audit.auditStatus ===
    "WAITING_FOR_FORWARD_SESSION"
  ) {
    return {
      status:
        "WAITING_FOR_FORWARD_SESSION",

      executed:
        [] as CollectorHorizon[],

      audit,

      safety: {
        collectorExecuted:
          false,

        realTradingEnabled:
          false,
      },
    };
  }

  if (
    audit.auditStatus ===
    "FORWARD_SESSION_INTEGRITY_FAILED"
  ) {
    return {
      status:
        "BLOCKED_FORWARD_SESSION_INTEGRITY_FAILED",

      executed:
        [] as CollectorHorizon[],

      audit,

      safety: {
        collectorExecuted:
          false,

        realTradingEnabled:
          false,
      },
    };
  }

  const due =
    HORIZONS.filter(
      horizon =>
        audit.counts
          .maturityReady[
            horizon
          ] > 0,
    );

  if (
    due.length === 0
  ) {
    return {
      status:
        "WAITING_FOR_MATURITY",

      executed:
        [] as CollectorHorizon[],

      due,

      audit,

      safety: {
        collectorExecuted:
          false,

        realTradingEnabled:
          false,
      },
    };
  }

  const runCollector =
    deps.runCollector ??
    defaultRunCollector;

  const executed:
    CollectorHorizon[] = [];

  const results:
    Array<{
      horizon: CollectorHorizon;
      exitCode: number;
      stdout?: string;
      stderr?: string;
    }> = [];

  for (
    const horizon of due
  ) {
    const result =
      await runCollector(
        horizon,
      );

    executed.push(
      horizon,
    );

    results.push({
      horizon,
      ...result,
    });

    if (
      result.exitCode !==
      0
    ) {
      return {
        status:
          "COLLECTOR_FAILED_FAIL_CLOSED",

        failedHorizon:
          horizon,

        due,

        executed,

        results,

        audit,

        safety: {
          realTradingEnabled:
            false,
        },
      };
    }
  }

  return {
    status:
      "MATURE_OUTCOME_COLLECTION_COMPLETED",

    due,

    executed,

    results,

    audit,

    safety: {
      realTradingEnabled:
        false,
    },

    nextGate:
      "VERIFY_1D_3D_5D_OUTCOME_ROWS_AND_TRUE_FORWARD_OOS_SUMMARY",
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
    result.status ===
      "COLLECTOR_FAILED_FAIL_CLOSED" ||
    result.status ===
      "BLOCKED_FORWARD_SESSION_INTEGRITY_FAILED"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-maturity-aware-collector-gate-v1.ts",
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

  const contractSource = `import assert from "node:assert/strict";

import {
  runMaturityAwareCollectorGateV1,
  type CollectorHorizon,
} from "./true-forward-oos-maturity-aware-collector-gate-v1";

async function main() {
  const calls:
    CollectorHorizon[] =
    [];

  const runCollector =
    async (
      horizon:
        CollectorHorizon,
    ) => {
      calls.push(
        horizon,
      );

      return {
        exitCode:
          0,
      };
    };

  const waiting =
    await runMaturityAwareCollectorGateV1({
      auditInput: {
        now:
          new Date(
            "2026-10-12T00:00:00.000Z",
          ),

        sessions:
          [],
      },

      runCollector,
    });

  const notMature =
    await runMaturityAwareCollectorGateV1({
      auditInput: {
        now:
          new Date(
            "2026-10-12T00:00:00.000Z",
          ),

        sessions: [
          {
            sourceTradingDate:
              "2026-10-08",

            targetSessionDate:
              "2026-10-12",

            capturedAt:
              "2026-10-08T23:50:00.000Z",

            candidateCount:
              1,
          },
        ],
      },

      runCollector,
    });

  const oneDay =
    await runMaturityAwareCollectorGateV1({
      auditInput: {
        now:
          new Date(
            "2026-10-13T00:00:00.000Z",
          ),

        sessions: [
          {
            sourceTradingDate:
              "2026-10-08",

            targetSessionDate:
              "2026-10-12",

            capturedAt:
              "2026-10-08T23:50:00.000Z",

            candidateCount:
              1,
          },
        ],
      },

      runCollector,
    });

  const allMature =
    await runMaturityAwareCollectorGateV1({
      auditInput: {
        now:
          new Date(
            "2026-10-17T00:00:00.000Z",
          ),

        sessions: [
          {
            sourceTradingDate:
              "2026-10-08",

            targetSessionDate:
              "2026-10-12",

            capturedAt:
              "2026-10-08T23:50:00.000Z",

            candidateCount:
              1,
          },
        ],
      },

      runCollector,
    });

  const failClosed =
    await runMaturityAwareCollectorGateV1({
      auditInput: {
        now:
          new Date(
            "2026-10-13T00:00:00.000Z",
          ),

        sessions: [
          {
            sourceTradingDate:
              "2026-10-08",

            targetSessionDate:
              "2026-10-12",

            capturedAt:
              "2026-10-08T23:50:00.000Z",

            candidateCount:
              1,
          },
        ],
      },

      runCollector:
        async () => ({
          exitCode:
            1,

          stderr:
            "synthetic failure",
        }),
    });

  const checks = {
    waitingNoExecution:
      waiting.status ===
        "WAITING_FOR_FORWARD_SESSION" &&
      waiting.executed.length ===
        0,

    notMatureNoExecution:
      notMature.status ===
        "WAITING_FOR_MATURITY" &&
      notMature.executed.length ===
        0,

    oneDayExecutesOnly1D:
      oneDay.status ===
        "MATURE_OUTCOME_COLLECTION_COMPLETED" &&
      oneDay.executed.length ===
        1 &&
      oneDay.executed[0] ===
        "1D",

    allMatureExecutesAll:
      allMature.status ===
        "MATURE_OUTCOME_COLLECTION_COMPLETED" &&
      allMature.executed.join(
        ",",
      ) ===
        "1D,3D,5D",

    failClosedStops:
      failClosed.status ===
      "COLLECTOR_FAILED_FAIL_CLOSED",

    noRealTrading:
      waiting.safety
        .realTradingEnabled ===
        false &&
      oneDay.safety
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_CONTRACT_VERIFIED",

        checks,

        calls,

        safety: {
          syntheticCollectorOnly:
            true,

          realCollectorExecuted:
            false,

          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_CONTRACT_FAILED",

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

  const staticSource = `const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_STATIC_FAILED",

    failed:
      ["gateExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    gateExists:
      true,

    maturityAuditUsed:
      source.includes(
        "auditForwardSessions"
      ),

    collectorTargetPresent:
      source.includes(
        "alpha-v3-true-entry-forward-oos-collector-v1.ts"
      ),

    horizonsPresent:
      source.includes(
        '"1D"'
      ) &&
      source.includes(
        '"3D"'
      ) &&
      source.includes(
        '"5D"'
      ),

    waitingGate:
      source.includes(
        "WAITING_FOR_FORWARD_SESSION"
      ),

    maturityGate:
      source.includes(
        "WAITING_FOR_MATURITY"
      ),

    integrityFailClosed:
      source.includes(
        "BLOCKED_FORWARD_SESSION_INTEGRITY_FAILED"
      ),

    collectorFailClosed:
      source.includes(
        "COLLECTOR_FAILED_FAIL_CLOSED"
      ),

    realTradingForcedFalse:
      source.includes(
        "REAL_TRADING_ENABLED:"
      ) &&
      source.includes(
        "ENABLE_REAL_TRADING:"
      ) &&
      source.includes(
        "ENABLE_LIVE_TRADING:"
      ),

    noShellTrue:
      !/shell\\s*:\\s*true/.test(
        source
      ),
  };

  const failed =
    Object.entries(checks)
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      collectorExecuted:
        false,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_MATURITY_AWARE_COLLECTOR_CONTRACT"
        : "REPAIR_MATURITY_AWARE_COLLECTOR_GATE_V1",
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
  }

  if (pkg) {
    pkg.scripts ||= {};

    pkg.scripts[
      "forward-oos:maturity-collector"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-maturity-collector"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-maturity-aware-collector-gate-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-maturity-collector-static"
    ] =
      "node ./scripts/true-forward-oos-maturity-aware-collector-gate-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
        "scripts/true-forward-oos-maturity-aware-collector-gate-v1-contract-test.ts",
        "scripts/true-forward-oos-maturity-aware-collector-gate-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "RUN_1D_3D_5D_OUTCOME_COLLECTOR_ONLY_WHEN_FORWARD_SESSIONS_ARE_MATURE",

      safety: {
        installerExecutedCollector:
          false,

        normalProducerExecuted:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        realTradingEnabled:
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_GATE"
    }, null, 2));

    process.exitCode = 0;
  }
}
