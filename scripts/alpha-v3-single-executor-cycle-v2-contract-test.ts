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
    "__alpha_v3_v2_contract_route.ts",
  );

const stateFile =
  path.join(
    routeDir,
    "__alpha_v3_v2_contract_state.ts",
  );

const maintenanceMockFile =
  path.join(
    routeDir,
    "__alpha_v3_v2_contract_maintenance_mock.ts",
  );

const executorMockFile =
  path.join(
    routeDir,
    "__alpha_v3_v2_contract_executor_mock.ts",
  );

const cleanupFiles = [
  tempRoute,
  stateFile,
  maintenanceMockFile,
  executorMockFile,
];

type Scenario = {
  name: string;
  passed: boolean;
  observed: unknown;
};

async function main() {
  if (!fs.existsSync(routeFile)) {
    throw new Error(
      "AUTOMATION_CYCLE_ROUTE_NOT_FOUND",
    );
  }

  const original =
    fs.readFileSync(
      routeFile,
      "utf8",
    );

  const transformed =
    original
      .replace(
        "@/lib/trading/run-committed-risk-maintenance",
        "./__alpha_v3_v2_contract_maintenance_mock",
      )
      .replace(
        "@/lib/trading/execute-approved-paper-orders",
        "./__alpha_v3_v2_contract_executor_mock",
      );

  fs.writeFileSync(
    stateFile,
    `
export const events: Array<{
  type: string;
  detail?: unknown;
}> = [];

export function resetState() {
  events.splice(0, events.length);
}
`,
    "utf8",
  );

  fs.writeFileSync(
    maintenanceMockFile,
    `
import {
  events,
} from "./__alpha_v3_v2_contract_state";

export async function runCommittedRiskMaintenance(
  input: {
    phase: string;
    runExpiry?: boolean;
  },
) {
  events.push({
    type: "maintenance",
    detail: input,
  });

  return {
    ok: true,
    phase: input.phase,
    expiry: input.runExpiry
      ? { expiredCount: 0 }
      : null,
    reconciliation: {
      releasedCount: 0,
    },
  };
}
`,
    "utf8",
  );

  fs.writeFileSync(
    executorMockFile,
    `
import {
  events,
} from "./__alpha_v3_v2_contract_state";

export async function executeApprovedPaperOrders(
  maxOrders = 5,
) {
  events.push({
    type: "cycle-executor",
    detail: {
      maxOrders,
    },
  });

  throw new Error(
    "CYCLE_EXECUTOR_MUST_NOT_BE_CALLED",
  );
}
`,
    "utf8",
  );

  fs.writeFileSync(
    tempRoute,
    transformed,
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
      POST:
        (request: Request) =>
          Promise<Response>;
    };

  const {
    events,
    resetState,
  } =
    stateModule as {
      events:
        Array<{
          type: string;
          detail?: unknown;
        }>;

      resetState:
        () => void;
    };

  const originalFetch =
    globalThis.fetch;

  const originalSecret =
    process.env
      .TRADING_AUTOMATION_SECRET;

  process.env
    .TRADING_AUTOMATION_SECRET =
    "v2-contract-secret";

  let fetchStatus =
    200;

  let fetchPayload:
    unknown = {
      ok: true,
      status: "SUCCESS",
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

      if (
        !url.includes(
          "/api/trading/automation/run",
        )
      ) {
        throw new Error(
          `UNEXPECTED_FETCH:${url}`,
        );
      }

      events.push({
        type: "automation-run",
        detail: {
          status:
            fetchStatus,
          body:
            typeof init?.body ===
            "string"
              ? init.body
              : null,
        },
      });

      return new Response(
        JSON.stringify(
          fetchPayload,
        ),
        {
          status:
            fetchStatus,
          headers: {
            "content-type":
              "application/json",
          },
        },
      );
    }) as typeof fetch;

  function makeRequest(
    body: Record<
      string,
      unknown
    >,
    secret =
      "v2-contract-secret",
  ) {
    return new Request(
      "http://localhost/api/trading/automation/cycle",
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          "x-automation-secret":
            secret,
        },
        body:
          JSON.stringify(
            body,
          ),
      },
    );
  }

  async function json(
    response: Response,
  ) {
    return JSON.parse(
      await response.text(),
    );
  }

  const scenarios:
    Scenario[] = [];

  /*
   * Success: wrapper executor must never run.
   */
  resetState();

  fetchStatus = 200;
  fetchPayload = {
    ok: true,
    status: "SUCCESS",
  };

  const successResponse =
    await POST(
      makeRequest({
        triggerType:
          "MANUAL",
        autoOrder:
          true,
        maxOrders:
          3,
      }),
    );

  const successPayload =
    await json(
      successResponse,
    );

  const successTypes =
    events.map(
      (event) =>
        event.type,
    );

  scenarios.push({
    name:
      "SUCCESS_HAS_SINGLE_EXECUTOR_OWNER",

    passed:
      successResponse.status ===
        200 &&
      successPayload?.ok ===
        true &&
      !successTypes.includes(
        "cycle-executor",
      ) &&
      successTypes.join(",") ===
        "maintenance,automation-run,maintenance",

    observed: {
      status:
        successResponse.status,
      payload:
        successPayload,
      events:
        [...events],
    },
  });

  /*
   * HTTP 200 PARTIAL_FAILURE is semantically failed.
   */
  resetState();

  fetchStatus = 200;
  fetchPayload = {
    ok: false,
    status:
      "PARTIAL_FAILURE",
  };

  const partialResponse =
    await POST(
      makeRequest({
        triggerType:
          "SCHEDULED",
        autoOrder:
          false,
      }),
    );

  const partialPayload =
    await json(
      partialResponse,
    );

  const partialTypes =
    events.map(
      (event) =>
        event.type,
    );

  scenarios.push({
    name:
      "PARTIAL_FAILURE_HTTP_200_FAILS_CLOSED",

    passed:
      partialResponse.status ===
        500 &&
      partialPayload?.ok ===
        false &&
      !partialTypes.includes(
        "cycle-executor",
      ) &&
      partialTypes.join(",") ===
        "maintenance,automation-run,maintenance",

    observed: {
      status:
        partialResponse.status,
      payload:
        partialPayload,
      events:
        [...events],
    },
  });

  /*
   * HTTP failure also remains fail-closed.
   */
  resetState();

  fetchStatus = 503;
  fetchPayload = {
    ok: false,
    status:
      "FAILED",
  };

  const httpFailureResponse =
    await POST(
      makeRequest({
        triggerType:
          "SCHEDULED",
        autoOrder:
          true,
      }),
    );

  const httpFailurePayload =
    await json(
      httpFailureResponse,
    );

  const httpFailureTypes =
    events.map(
      (event) =>
        event.type,
    );

  scenarios.push({
    name:
      "HTTP_FAILURE_FAILS_CLOSED",

    passed:
      httpFailureResponse.status ===
        503 &&
      httpFailurePayload?.ok ===
        false &&
      !httpFailureTypes.includes(
        "cycle-executor",
      ) &&
      httpFailureTypes.join(",") ===
        "maintenance,automation-run,maintenance",

    observed: {
      status:
        httpFailureResponse.status,
      payload:
        httpFailurePayload,
      events:
        [...events],
    },
  });

  /*
   * Bad secret returns before every operational call.
   */
  resetState();

  const unauthorizedResponse =
    await POST(
      makeRequest(
        {
          autoOrder:
            false,
        },
        "wrong-secret",
      ),
    );

  scenarios.push({
    name:
      "UNAUTHORIZED_ZERO_OPERATIONAL_CALLS",

    passed:
      unauthorizedResponse.status ===
        401 &&
      events.length ===
        0,

    observed: {
      status:
        unauthorizedResponse.status,
      events:
        [...events],
    },
  });

  globalThis.fetch =
    originalFetch;

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

  const failed =
    scenarios.filter(
      (scenario) =>
        !scenario.passed,
    );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "ALPHA_V3_SINGLE_EXECUTOR_CYCLE_V2_CONTRACT_TEST_VERIFIED"
            : "ALPHA_V3_SINGLE_EXECUTOR_CYCLE_V2_CONTRACT_TEST_REVIEW",

        scenarios,

        summary: {
          scenarioCount:
            scenarios.length,

          passedCount:
            scenarios.length -
            failed.length,

          failedCount:
            failed.length,

          cycleExecutorCallsExpected:
            0,
        },

        safety: {
          realDatabaseCalls:
            0,
          realNetworkCalls:
            0,
          realOrdersCreated:
            0,
          realOrdersChanged:
            0,
          realPositionsChanged:
            0,
        },

        nextGate:
          failed.length === 0
            ? "RUN_MANUAL_PROXY_PROBE_ONLY_SAFE_TEST"
            : "REVIEW_SINGLE_EXECUTOR_CYCLE_V2",
      },
      null,
      2,
    ),
  );

  if (
    failed.length > 0
  ) {
    process.exitCode =
      2;
  }
}

void main()
  .catch(
    (error) => {
      console.error(
        JSON.stringify(
          {
            status:
              "ALPHA_V3_SINGLE_EXECUTOR_CYCLE_V2_CONTRACT_TEST_FATAL",

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
          // best-effort cleanup
        }
      }
    },
  );
