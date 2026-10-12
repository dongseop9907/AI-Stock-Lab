import fs from "node:fs";
import path from "node:path";

const ROOT =
  process.cwd();

const ROUTE_REL =
  "app/api/trading/automation/cycle/route.ts";

function read(
  rel: string,
) {
  return fs.readFileSync(
    path.join(
      ROOT,
      rel,
    ),
    "utf8",
  );
}

function staticVerifyRoute(
  source: string,
) {
  const probeMarker =
    source.indexOf(
      "ALPHA_V3_PROBE_ONLY_V1",
    );

  const probeBody =
    source.indexOf(
      "probeOnly",
      Math.max(
        0,
        probeMarker,
      ),
    );

  const secretCheck =
    source.indexOf(
      "TRADING_AUTOMATION_SECRET",
      Math.max(
        0,
        probeBody,
      ),
    );

  const reachableStatus =
    source.indexOf(
      "AUTOMATION_CYCLE_ROUTE_REACHABLE",
      Math.max(
        0,
        secretCheck,
      ),
    );

  const maintenanceCall =
    source.indexOf(
      "runCommittedRiskMaintenance(",
    );

  const innerRunCall =
    source.indexOf(
      "/api/trading/automation/run",
    );

  const approvedExecution =
    source.indexOf(
      "executeApprovedPaperOrders(",
    );

  const checks = {
    routeExists:
      true,

    probeMarker:
      probeMarker >= 0,

    probeBodySurface:
      /probeOnly\s*\??:\s*unknown|probeOnly/.test(
        source,
      ),

    explicitTrueGuard:
      /\.probeOnly\s*===\s*true/.test(
        source,
      ),

    secretRequired:
      secretCheck >= 0,

    unauthorizedProbeResponse:
      source.includes(
        "UNAUTHORIZED_AUTOMATION_CYCLE_PROBE",
      ),

    reachableStatus:
      reachableStatus >= 0,

    zeroSideEffectContract:
      source.includes(
        "databaseWrites",
      ) &&
      source.includes(
        "ordersCreated",
      ) &&
      source.includes(
        "positionsChanged",
      ),

    probeBeforeMaintenance:
      probeMarker >= 0 &&
      maintenanceCall >= 0 &&
      probeMarker <
        maintenanceCall,

    probeBeforeInnerAutomationRun:
      probeMarker >= 0 &&
      innerRunCall >= 0 &&
      probeMarker <
        innerRunCall,

    probeBeforeApprovedExecution:
      probeMarker >= 0 &&
      approvedExecution >= 0 &&
      probeMarker <
        approvedExecution,
  };

  return {
    checks,

    failed:
      Object.entries(
        checks,
      )
        .filter(
          ([, value]) =>
            value !== true,
        )
        .map(
          ([key]) =>
            key,
        ),
  };
}

function candidateBaseUrls() {
  const explicit = [
    process.env
      .AI_STOCK_LAB_BASE_URL,
    process.env
      .NEXT_PUBLIC_APP_URL,
  ]
    .map(
      value =>
        String(
          value ?? "",
        ).trim(),
    )
    .filter(Boolean)
    .map(
      value =>
        value.replace(
          /\/+$/,
          "",
        ),
    );

  return [
    ...new Set([
      ...explicit,
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3010",
    ]),
  ];
}

async function callProbe(
  baseUrl: string,
  secret: string,
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      3500,
    );

  try {
    const response =
      await fetch(
        `${baseUrl}/api/trading/automation/cycle`,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-automation-secret":
              secret,
          },

          body:
            JSON.stringify({
              probeOnly:
                true,
            }),

          cache:
            "no-store",

          signal:
            controller.signal,
        },
      );

    const text =
      await response.text();

    let payload:
      unknown = null;

    try {
      payload =
        text
          ? JSON.parse(
              text,
            )
          : null;
    } catch {
      payload = {
        raw:
          text.slice(
            0,
            500,
          ),
      };
    }

    return {
      baseUrl,
      reachable:
        true,
      httpStatus:
        response.status,
      payload,
      error:
        null,
    };
  } catch (
    error
  ) {
    return {
      baseUrl,
      reachable:
        false,
      httpStatus:
        null,
      payload:
        null,
      error:
        String(
          error instanceof Error
            ? error.message
            : error,
        ),
    };
  } finally {
    clearTimeout(
      timer,
    );
  }
}

async function main() {
  const routePath =
    path.join(
      ROOT,
      ROUTE_REL,
    );

  if (
    !fs.existsSync(
      routePath,
    )
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_FAILED",

          reason:
            "CYCLE_ROUTE_NOT_FOUND",

          failed: [
            "routeExists",
          ],
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
    return;
  }

  const source =
    read(
      ROUTE_REL,
    );

  const staticResult =
    staticVerifyRoute(
      source,
    );

  if (
    staticResult.failed.length >
    0
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_FAILED",

          phase:
            "STATIC_FAIL_CLOSED",

          checks:
            staticResult.checks,

          failed:
            staticResult.failed,

          nextGate:
            "REPAIR_OR_REVERIFY_EXISTING_PROBE_ONLY_ROUTE_BEFORE_ANY_ROUTE_CALL",
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
    return;
  }

  const secret =
    String(
      process.env
        .TRADING_AUTOMATION_SECRET ??
      "",
    ).trim();

  if (
    !secret
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_WAIT",

          phase:
            "SECRET_NOT_AVAILABLE",

          staticChecks:
            staticResult.checks,

          routeCalled:
            false,

          failed: [],

          nextGate:
            "KEEP_ROUTE_UNCALLED_UNTIL_TRADING_AUTOMATION_SECRET_IS_AVAILABLE",
        },
        null,
        2,
      ),
    );

    process.exitCode = 0;
    return;
  }

  const attempts = [];

  let verified:
    {
      baseUrl: string;
      reachable: boolean;
      httpStatus:
        number | null;
      payload:
        any;
      error:
        string | null;
    } | null = null;

  for (
    const baseUrl
    of candidateBaseUrls()
  ) {
    const attempt =
      await callProbe(
        baseUrl,
        secret,
      );

    attempts.push(
      attempt,
    );

    const payload =
      attempt.payload as
        | {
            ok?: unknown;
            probeOnly?: unknown;
            status?: unknown;
            sideEffects?: {
              committedRiskMaintenance?: unknown;
              automationRun?: unknown;
              approvedOrderExecution?: unknown;
              databaseReads?: unknown;
              databaseWrites?: unknown;
              ordersCreated?: unknown;
              ordersChanged?: unknown;
              positionsChanged?: unknown;
            };
          }
        | null;

    if (
      attempt.httpStatus ===
        200 &&
      payload?.ok ===
        true &&
      payload
        ?.probeOnly ===
        true &&
      payload?.status ===
        "AUTOMATION_CYCLE_ROUTE_REACHABLE"
    ) {
      verified =
        attempt;
      break;
    }
  }

  if (
    !verified
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_WAIT",

          phase:
            "LOCAL_SERVER_NOT_VERIFIED",

          staticChecks:
            staticResult.checks,

          attempts:
            attempts.map(
              attempt => ({
                baseUrl:
                  attempt.baseUrl,

                reachable:
                  attempt.reachable,

                httpStatus:
                  attempt.httpStatus,

                error:
                  attempt.error,
              }),
            ),

          safety: {
            probeOnlyRequests:
              attempts.filter(
                attempt =>
                  attempt.reachable,
              ).length,

            realTradingEnabled:
              false,

            intendedDatabaseWrites:
              0,

            intendedOrdersCreated:
              0,

            intendedPositionsChanged:
              0,
          },

          failed: [],

          nextGate:
            "START_LOCAL_NEXT_SERVER_AND_RERUN_SAME_PROBE_ONLY_SMOKE",
        },
        null,
        2,
      ),
    );

    process.exitCode = 0;
    return;
  }

  const payload =
    verified.payload as {
      sideEffects?: {
        committedRiskMaintenance?: unknown;
        automationRun?: unknown;
        approvedOrderExecution?: unknown;
        databaseReads?: unknown;
        databaseWrites?: unknown;
        ordersCreated?: unknown;
        ordersChanged?: unknown;
        positionsChanged?: unknown;
      };
    };

  const sideEffects =
    payload
      .sideEffects ?? {};

  const checks = {
    routeReachable:
      true,

    authenticatedProbeAccepted:
      true,

    committedRiskMaintenanceNotRun:
      sideEffects
        .committedRiskMaintenance ===
        false,

    automationRunNotRun:
      sideEffects
        .automationRun ===
        false,

    approvedOrderExecutionNotRun:
      sideEffects
        .approvedOrderExecution ===
        false,

    databaseReadsZero:
      sideEffects
        .databaseReads ===
        0,

    databaseWritesZero:
      sideEffects
        .databaseWrites ===
        0,

    ordersCreatedZero:
      sideEffects
        .ordersCreated ===
        0,

    ordersChangedZero:
      sideEffects
        .ordersChanged ===
        0,

    positionsChangedZero:
      sideEffects
        .positionsChanged ===
        0,
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          value !== true,
      )
      .map(
        ([key]) =>
          key,
      );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length ===
          0
            ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_VERIFIED"
            : "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_FAILED",

        baseUrl:
          verified.baseUrl,

        httpStatus:
          verified.httpStatus,

        staticChecks:
          staticResult.checks,

        runtimeChecks:
          checks,

        safety: {
          requestMode:
            "AUTHENTICATED_PROBE_ONLY",

          realTradingForcedOffByExecutionCommand:
            true,

          forwardOosAutomationForcedOffByExecutionCommand:
            true,

          databaseWrites:
            sideEffects
              .databaseWrites,

          ordersCreated:
            sideEffects
              .ordersCreated,

          positionsChanged:
            sideEffects
              .positionsChanged,
        },

        failed,

        nextGate:
          failed.length ===
          0
            ? "VERIFY_FORWARD_OOS_AUTOMATION_HELPER_CONTROLLED_ONE_SHOT_WITH_MOCKED_SUBPROCESS_V1"
            : "DO_NOT_RUN_NORMAL_AUTOMATION_ROUTE_INSPECT_PROBE_CONTRACT",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length ===
    0
      ? 0
      : 1;
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_ONE_SHOT_SMOKE_V1_FAILED",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          failed: [
            "smokeRuntime",
          ],
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
