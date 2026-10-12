import {
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
