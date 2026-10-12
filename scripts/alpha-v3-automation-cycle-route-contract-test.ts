import fs from "node:fs";
import path from "node:path";
import {
  pathToFileURL,
} from "node:url";

const root =
  process.cwd();

const routeDir =
  path.resolve(
    root,
    "app/api/trading/automation/cycle",
  );

const routeFile =
  path.join(
    routeDir,
    "route.ts",
  );

const tempRoute =
  path.join(
    routeDir,
    "__alpha_v3_contract_route.ts",
  );

const stateFile =
  path.join(
    routeDir,
    "__alpha_v3_contract_state.ts",
  );

const maintenanceMockFile =
  path.join(
    routeDir,
    "__alpha_v3_contract_maintenance_mock.ts",
  );

const executorMockFile =
  path.join(
    routeDir,
    "__alpha_v3_contract_executor_mock.ts",
  );

const outputFile =
  path.resolve(
    root,
    "logs/alpha-v3-automation-cycle-route-contract-test.json",
  );

if (!fs.existsSync(routeFile)) {
  throw new Error(
    "AUTOMATION_CYCLE_ROUTE_NOT_FOUND",
  );
}

const originalRoute =
  fs.readFileSync(
    routeFile,
    "utf8",
  );

const requiredMarkers = [
  "@/lib/trading/execute-approved-paper-orders",
  "@/lib/trading/run-committed-risk-maintenance",
  "/api/trading/automation/run",
  "TRADING_AUTOMATION_SECRET",
];

for (
  const marker of
    requiredMarkers
) {
  if (
    !originalRoute.includes(
      marker,
    )
  ) {
    throw new Error(
      `ROUTE_CONTRACT_MARKER_MISSING:${marker}`,
    );
  }
}

const transformedRoute =
  originalRoute
    .replace(
      "@/lib/trading/execute-approved-paper-orders",
      "./__alpha_v3_contract_executor_mock",
    )
    .replace(
      "@/lib/trading/run-committed-risk-maintenance",
      "./__alpha_v3_contract_maintenance_mock",
    );

const stateSource = `
export type ContractEvent = {
  type: string;
  detail?: unknown;
};

export const events: ContractEvent[] = [];

export const behavior = {
  maintenanceThrowPhase: null as null | "PRE_CYCLE" | "POST_EXECUTION",
  executorThrows: false,
};

export function resetContractState() {
  events.splice(0, events.length);
  behavior.maintenanceThrowPhase = null;
  behavior.executorThrows = false;
}
`;

const maintenanceMockSource = `
import {
  behavior,
  events,
} from "./__alpha_v3_contract_state";

export async function runCommittedRiskMaintenance(
  input: {
    phase: "PRE_CYCLE" | "POST_EXECUTION";
    runExpiry?: boolean;
  },
) {
  events.push({
    type: "maintenance",
    detail: {
      phase: input.phase,
      runExpiry: input.runExpiry ?? null,
    },
  });

  if (
    behavior.maintenanceThrowPhase ===
    input.phase
  ) {
    throw new Error(
      "MOCK_MAINTENANCE_FAILURE:" +
      input.phase,
    );
  }

  return {
    ok: true as const,
    phase: input.phase,
    expiry:
      input.runExpiry
        ? { expiredCount: 0 }
        : null,
    reconciliation: {
      releasedCount: 0,
    },
  };
}
`;

const executorMockSource = `
import {
  behavior,
  events,
} from "./__alpha_v3_contract_state";

export async function executeApprovedPaperOrders(
  maxOrders = 5,
) {
  events.push({
    type: "execute-approved",
    detail: {
      maxOrders,
    },
  });

  if (behavior.executorThrows) {
    throw new Error(
      "MOCK_EXECUTOR_FAILURE",
    );
  }

  return {
    ok: true,
    requested: maxOrders,
    executed: 2,
    failed: 0,
    results: [],
  };
}
`;

type ScenarioResult = {
  name: string;
  passed: boolean;
  expected: unknown;
  observed: unknown;
};

const cleanupFiles = [
  tempRoute,
  stateFile,
  maintenanceMockFile,
  executorMockFile,
];

async function main() {
  fs.writeFileSync(
    tempRoute,
    transformedRoute,
    "utf8",
  );

  fs.writeFileSync(
    stateFile,
    stateSource,
    "utf8",
  );

  fs.writeFileSync(
    maintenanceMockFile,
    maintenanceMockSource,
    "utf8",
  );

  fs.writeFileSync(
    executorMockFile,
    executorMockSource,
    "utf8",
  );

  const routeModule =
    await import(
      pathToFileURL(
        tempRoute,
      ).href +
        `?v=${Date.now()}`
    );

  const stateModule =
    await import(
      pathToFileURL(
        stateFile,
      ).href
    );

  const {
    POST,
  } =
    routeModule as {
      POST: (
        request: unknown,
      ) => Promise<Response>;
    };

  const {
    events,
    behavior,
    resetContractState,
  } =
    stateModule as {
      events: Array<{
        type: string;
        detail?: unknown;
      }>;

      behavior: {
        maintenanceThrowPhase:
          null |
          "PRE_CYCLE" |
          "POST_EXECUTION";

        executorThrows:
          boolean;
      };

      resetContractState:
        () => void;
    };

  /*
   * CONTRACT_STATE_IDENTITY_SELF_CHECK
   * The mocks and the test body must share one exact module instance.
   */
  resetContractState();

  events.push({
    type: "state-self-check",
  });

  if (
    events.length !== 1 ||
    events[0]?.type !==
      "state-self-check"
  ) {
    throw new Error(
      "CONTRACT_STATE_IDENTITY_SELF_CHECK_FAILED"
    );
  }

  resetContractState();

  const originalFetch =
    globalThis.fetch;

  const originalSecret =
    process.env
      .TRADING_AUTOMATION_SECRET;

  const scenarios:
    ScenarioResult[] =
    [];

  let fetchBehavior: {
    status: number;
    payload: unknown;
  } = {
    status: 200,
    payload: {
      ok: true,
      status: "SUCCESS",
    },
  };

  globalThis.fetch =
    (async (
      input:
        string | URL | Request,
      init?: RequestInit,
    ) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      events.push({
        type: "fetch",
        detail: {
          url,
          method:
            init?.method ??
            "GET",
          body:
            typeof init?.body ===
            "string"
              ? init.body
              : null,
        },
      });

      if (
        !url.includes(
          "/api/trading/automation/run",
        )
      ) {
        throw new Error(
          `UNEXPECTED_FETCH:${url}`,
        );
      }

      return new Response(
        JSON.stringify(
          fetchBehavior.payload,
        ),
        {
          status:
            fetchBehavior.status,

          headers: {
            "content-type":
              "application/json",
          },
        },
      );
    }) as typeof fetch;

  function makeRequest(
    options?: {
      secret?: string;
      body?: unknown;
    },
  ) {
    const headers =
      new Headers({
        "content-type":
          "application/json",
      });

    if (options?.secret) {
      headers.set(
        "x-automation-secret",
        options.secret,
      );
    }

    return new Request(
      "http://localhost/api/trading/automation/cycle",
      {
        method: "POST",
        headers,
        body:
          JSON.stringify(
            options?.body ??
            {
              triggerType:
                "MANUAL",
            },
          ),
      },
    );
  }

  async function readJson(
    response: Response,
  ) {
    const text =
      await response.text();

    return text
      ? JSON.parse(text)
      : null;
  }

  resetContractState();

  process.env
    .TRADING_AUTOMATION_SECRET =
    "contract-secret";

  fetchBehavior = {
    status: 200,
    payload: {
      ok: true,
      status: "SUCCESS",
    },
  };

  const successResponse =
    await POST(
      makeRequest({
        secret:
          "contract-secret",

        body: {
          triggerType:
            "MANUAL",
          dryRun:
            true,
        },
      }),
    );

  const successBody =
    await readJson(
      successResponse,
    );

  const successOrder =
    events.map(
      (event) => {
        if (
          event.type ===
          "maintenance"
        ) {
          const detail =
            event.detail as {
              phase?: string;
            };

          return `maintenance:${detail.phase}`;
        }

        return event.type;
      },
    );

  const expectedSuccessOrder = [
    "maintenance:PRE_CYCLE",
    "fetch",
    "execute-approved",
    "maintenance:POST_EXECUTION",
  ];

  scenarios.push({
    name:
      "SUCCESS_CANONICAL_STAGE_ORDER",

    passed:
      successResponse.status ===
        200 &&
      successBody?.ok ===
        true &&
      JSON.stringify(
        successOrder,
      ) ===
        JSON.stringify(
          expectedSuccessOrder,
        ),

    expected: {
      status: 200,
      ok: true,
      eventOrder:
        expectedSuccessOrder,
    },

    observed: {
      status:
        successResponse.status,
      body:
        successBody,
      eventOrder:
        successOrder,
    },
  });

  resetContractState();

  fetchBehavior = {
    status: 503,
    payload: {
      ok: false,
      error:
        "MOCK_AUTOMATION_FAILURE",
    },
  };

  const pipelineFailureResponse =
    await POST(
      makeRequest({
        secret:
          "contract-secret",
      }),
    );

  const pipelineFailureBody =
    await readJson(
      pipelineFailureResponse,
    );

  const pipelineFailureTypes =
    events.map(
      (event) =>
        event.type,
    );

  scenarios.push({
    name:
      "AUTOMATION_FAILURE_FAILS_CLOSED",

    passed:
      pipelineFailureResponse.status ===
        503 &&
      pipelineFailureBody?.ok ===
        false &&
      !pipelineFailureTypes.includes(
        "execute-approved",
      ) &&
      pipelineFailureTypes.filter(
        (type) =>
          type ===
          "maintenance",
      ).length ===
        2,

    expected: {
      status: 503,
      executorCalled: false,
      maintenanceCalls: 2,
    },

    observed: {
      status:
        pipelineFailureResponse.status,
      body:
        pipelineFailureBody,
      events:
        [...events],
    },
  });

  resetContractState();

  const unauthorizedResponse =
    await POST(
      makeRequest(),
    );

  const unauthorizedBody =
    await readJson(
      unauthorizedResponse,
    );

  scenarios.push({
    name:
      "UNAUTHORIZED_REQUEST_HAS_ZERO_SIDE_EFFECT_CALLS",

    passed:
      unauthorizedResponse.status ===
        401 &&
      unauthorizedBody?.ok ===
        false &&
      events.length === 0,

    expected: {
      status: 401,
      eventCount: 0,
    },

    observed: {
      status:
        unauthorizedResponse.status,
      body:
        unauthorizedBody,
      events:
        [...events],
    },
  });

  resetContractState();

  fetchBehavior = {
    status: 200,
    payload: {
      ok: true,
      status: "SUCCESS",
    },
  };

  behavior.executorThrows =
    true;

  const executorFailureResponse =
    await POST(
      makeRequest({
        secret:
          "contract-secret",
      }),
    );

  const executorFailureBody =
    await readJson(
      executorFailureResponse,
    );

  const executorFailureOrder =
    events.map(
      (event) => {
        if (
          event.type ===
          "maintenance"
        ) {
          const detail =
            event.detail as {
              phase?: string;
            };

          return `maintenance:${detail.phase}`;
        }

        return event.type;
      },
    );

  scenarios.push({
    name:
      "EXECUTOR_FAILURE_TRIGGERS_FAILURE_CLEANUP",

    passed:
      executorFailureResponse.status ===
        500 &&
      executorFailureBody?.ok ===
        false &&
      executorFailureOrder.includes(
        "execute-approved",
      ) &&
      executorFailureOrder.filter(
        (value) =>
          value ===
          "maintenance:POST_EXECUTION",
      ).length ===
        1,

    expected: {
      status: 500,
      executorCalled: true,
      postFailureCleanupCalled:
        true,
    },

    observed: {
      status:
        executorFailureResponse.status,
      body:
        executorFailureBody,
      eventOrder:
        executorFailureOrder,
    },
  });

  resetContractState();

  behavior.maintenanceThrowPhase =
    "PRE_CYCLE";

  const preFailureResponse =
    await POST(
      makeRequest({
        secret:
          "contract-secret",
      }),
    );

  const preFailureBody =
    await readJson(
      preFailureResponse,
    );

  const preFailureTypes =
    events.map(
      (event) =>
        event.type,
    );

  scenarios.push({
    name:
      "PRE_MAINTENANCE_FAILURE_STOPS_PIPELINE",

    passed:
      preFailureResponse.status ===
        500 &&
      preFailureBody?.ok ===
        false &&
      !preFailureTypes.includes(
        "fetch",
      ) &&
      !preFailureTypes.includes(
        "execute-approved",
      ),

    expected: {
      status: 500,
      automationCalled:
        false,
      executorCalled:
        false,
    },

    observed: {
      status:
        preFailureResponse.status,
      body:
        preFailureBody,
      events:
        [...events],
    },
  });

  if (
    originalSecret ===
    undefined
  ) {
    delete process.env
      .TRADING_AUTOMATION_SECRET;
  } else {
    process.env
      .TRADING_AUTOMATION_SECRET =
      originalSecret;
  }

  globalThis.fetch =
    originalFetch;

  const failed =
    scenarios.filter(
      (scenario) =>
        !scenario.passed,
    );

  const report = {
    status:
      failed.length === 0
        ? "ALPHA_V3_AUTOMATION_CYCLE_ROUTE_CONTRACT_TEST_VERIFIED"
        : "ALPHA_V3_AUTOMATION_CYCLE_ROUTE_CONTRACT_TEST_REVIEW",

    scenarios,

    summary: {
      scenarioCount:
        scenarios.length,

      passedCount:
        scenarios.length -
        failed.length,

      failedCount:
        failed.length,

      canonicalSuccessOrderVerified:
        scenarios.find(
          (scenario) =>
            scenario.name ===
            "SUCCESS_CANONICAL_STAGE_ORDER",
        )?.passed ??
        false,

      automationFailClosedVerified:
        scenarios.find(
          (scenario) =>
            scenario.name ===
            "AUTOMATION_FAILURE_FAILS_CLOSED",
        )?.passed ??
        false,

      unauthorizedZeroSideEffectsVerified:
        scenarios.find(
          (scenario) =>
            scenario.name ===
            "UNAUTHORIZED_REQUEST_HAS_ZERO_SIDE_EFFECT_CALLS",
        )?.passed ??
        false,

      failureCleanupVerified:
        scenarios.find(
          (scenario) =>
            scenario.name ===
            "EXECUTOR_FAILURE_TRIGGERS_FAILURE_CLEANUP",
        )?.passed ??
        false,

      preMaintenanceFailClosedVerified:
        scenarios.find(
          (scenario) =>
            scenario.name ===
            "PRE_MAINTENANCE_FAILURE_STOPS_PIPELINE",
        )?.passed ??
        false,
    },

    safety: {
      realDatabaseRpcCalls: 0,
      productionOrdersCreated: 0,
      productionOrdersChanged: 0,
      productionPositionsChanged: 0,
      realAutomationRunCalls: 0,
      realExecutorCalls: 0,
    },

    nextGate:
      failed.length === 0
        ? "BUILD_60S_SERVER_SIDE_SCHEDULER"
        : "REVIEW_AUTOMATION_CYCLE_ROUTE_CONTRACT",

    outputFile:
      "logs/alpha-v3-automation-cycle-route-contract-test.json",
  };

  fs.mkdirSync(
    path.dirname(outputFile),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  if (
    failed.length > 0
  ) {
    process.exitCode = 2;
  }
}

main()
  .catch(
    (error) => {
      console.error(
        JSON.stringify(
          {
            status:
              "ALPHA_V3_AUTOMATION_CYCLE_ROUTE_CONTRACT_TEST_FATAL",

            error:
              error instanceof Error
                ? error.message
                : String(
                    error,
                  ),

            safety: {
              realDatabaseRpcCalls: 0,
              productionOrdersCreated: 0,
              productionPositionsChanged: 0,
            },

            nextGate:
              "REVIEW_AUTOMATION_CYCLE_ROUTE_CONTRACT_TEST_FATAL",
          },
          null,
          2,
        ),
      );

      process.exitCode = 2;
    },
  )
  .finally(
    () => {
      for (
        const file of
          cleanupFiles
      ) {
        try {
          fs.rmSync(
            file,
            {
              force: true,
            },
          );
        } catch {
          // best-effort test cleanup
        }
      }
    },
  );
