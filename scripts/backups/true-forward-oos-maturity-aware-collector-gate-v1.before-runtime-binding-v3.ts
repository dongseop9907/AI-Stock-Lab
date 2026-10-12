import {
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
