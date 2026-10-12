import {
  strict as assert,
} from "node:assert";

import {
  classifyIntegrityRepairDecision,
  resolveMarketDataMaintenanceConfig,
  runMarketDataMaintenanceOnce,
} from "./alpha-v3-market-data-maintenance-scheduler";

function jsonResponse(
  payload:
    unknown,
  status:
    number = 200,
): Response {
  return new Response(
    JSON.stringify(
      payload,
    ),
    {
      status,
      headers: {
        "content-type":
          "application/json",
      },
    },
  );
}

function cleanIntegrityPayload() {
  return {
    ok:
      true,
    result: {
      status:
        "CLEAN",
      before: {
        status:
          "CLEAN",
        counts: {
          issues: 0,
          errors: 0,
          warnings: 0,
          repairable: 0,
        },
        issues: [],
      },
      after: {
        status:
          "CLEAN",
        counts: {
          issues: 0,
          errors: 0,
          warnings: 0,
          repairable: 0,
        },
        issues: [],
      },
    },
  };
}

function repairableMissingBarPayload() {
  return {
    ok:
      true,
    result: {
      status:
        "ERROR",
      before: {
        status:
          "ERROR",
        counts: {
          issues: 2,
          errors: 2,
          warnings: 0,
          repairable: 2,
        },
        issues: [
          {
            severity:
              "ERROR",
            issueType:
              "MISSING_STOCK_BAR",
            stockCode:
              "000660",
            tradingDate:
              "2026-09-04",
            repairable:
              true,
          },
          {
            severity:
              "ERROR",
            issueType:
              "MISSING_STOCK_BAR",
            stockCode:
              "005380",
            tradingDate:
              "2026-09-04",
            repairable:
              true,
          },
        ],
      },
      after: {
        status:
          "ERROR",
        counts: {
          issues: 2,
          errors: 2,
          warnings: 0,
          repairable: 2,
        },
        issues: [
          {
            severity:
              "ERROR",
            issueType:
              "MISSING_STOCK_BAR",
            repairable:
              true,
          },
          {
            severity:
              "ERROR",
            issueType:
              "MISSING_STOCK_BAR",
            repairable:
              true,
          },
        ],
      },
    },
  };
}

function nonRepairablePayload() {
  return {
    ok:
      true,
    result: {
      status:
        "ERROR",
      after: {
        status:
          "ERROR",
        issues: [
          {
            severity:
              "ERROR",
            issueType:
              "CORRUPT_PRICE_BAR",
            repairable:
              false,
          },
        ],
      },
    },
  };
}

function unsupportedRepairablePayload() {
  return {
    ok:
      true,
    result: {
      status:
        "ERROR",
      after: {
        status:
          "ERROR",
        issues: [
          {
            severity:
              "ERROR",
            issueType:
              "EXTREME_RETURN",
            repairable:
              true,
          },
        ],
      },
    },
  };
}

async function runScenario(
  integrityPayload:
    unknown,
) {
  const calls:
    Array<{
      url: string;
      body: any;
    }> = [];

  let integrityCall =
    0;

  const fetchFn =
    async (
      input:
        string | URL,
      init?:
        RequestInit,
    ) => {
      const url =
        String(input);

      const body =
        typeof init?.body ===
          "string"
          ? JSON.parse(
              init.body,
            )
          : null;

      calls.push({
        url,
        body,
      });

      if (
        url.endsWith(
          "/api/market/regime/v7/integrity",
        )
      ) {
        integrityCall +=
          1;

        if (
          body?.repair ===
          true
        ) {
          return jsonResponse({
            ok:
              true,
            result: {
              status:
                "REPAIRED",
              repairRequested:
                true,
              repairAttempted:
                true,
              repairSucceeded:
                true,
              after:
                cleanIntegrityPayload()
                  .result.after,
            },
          });
        }

        if (
          integrityCall >=
            2 &&
          classifyIntegrityRepairDecision(
            integrityPayload,
          ).shouldRepair
        ) {
          return jsonResponse(
            cleanIntegrityPayload(),
          );
        }

        return jsonResponse(
          integrityPayload,
        );
      }

      if (
        url.endsWith(
          "/api/market/regime/v7/quality-gate/capture",
        )
      ) {
        return jsonResponse({
          ok:
            true,
          result: {
            gate: {
              status:
                "PASS",
            },
          },
        });
      }

      return jsonResponse({
        ok:
          true,
      });
    };

  const config =
    resolveMarketDataMaintenanceConfig(
      {
        MARKET_DATA_MAINTENANCE_BASE_URL:
          "http://localhost:3000/",
        MARKET_DATA_MAINTENANCE_HOUR_KST:
          "16",
        MARKET_DATA_MAINTENANCE_MINUTE_KST:
          "40",
        MARKET_DATA_MAINTENANCE_POLL_MS:
          "60000",
      },
    );

  const result =
    await runMarketDataMaintenanceOnce(
      config,
      {
        fetchFn,
        now:
          new Date(
            "2026-10-08T10:30:00.000Z",
          ),
      },
    );

  return {
    calls,
    result,
  };
}

async function main() {
  const checks:
    Record<string, boolean> = {};

  const cleanDecision =
    classifyIntegrityRepairDecision(
      cleanIntegrityPayload(),
    );

  checks.cleanDoesNotRepair =
    cleanDecision.shouldRepair ===
      false &&
    cleanDecision.reason ===
      "NO_ERRORS";

  const repairableDecision =
    classifyIntegrityRepairDecision(
      repairableMissingBarPayload(),
    );

  checks.missingStockBarsRepair =
    repairableDecision.shouldRepair ===
      true &&
    repairableDecision.errorCount ===
      2 &&
    repairableDecision.repairableErrorCount ===
      2;

  const nonRepairableDecision =
    classifyIntegrityRepairDecision(
      nonRepairablePayload(),
    );

  checks.nonRepairableErrorBlocksRepair =
    nonRepairableDecision.shouldRepair ===
      false &&
    nonRepairableDecision.reason ===
      "NON_REPAIRABLE_ERROR_PRESENT";

  const unsupportedDecision =
    classifyIntegrityRepairDecision(
      unsupportedRepairablePayload(),
    );

  checks.unsupportedRepairableTypeBlocksRepair =
    unsupportedDecision.shouldRepair ===
      false &&
    unsupportedDecision.reason ===
      "UNSUPPORTED_REPAIRABLE_ERROR_TYPE" &&
    unsupportedDecision.unsupportedIssueTypes.includes(
      "EXTREME_RETURN",
    );

  const clean =
    await runScenario(
      cleanIntegrityPayload(),
    );

  checks.cleanPathFourCalls =
    clean.calls.length ===
      4;

  checks.cleanPathNoRepair =
    clean.result.selfHealing
      .repairAttempted ===
      false &&
    clean.calls.every(
      (call) =>
        call.body?.repair !==
        true,
    );

  const repair =
    await runScenario(
      repairableMissingBarPayload(),
    );

  const integrityCalls =
    repair.calls.filter(
      (call) =>
        call.url.endsWith(
          "/api/market/regime/v7/integrity",
        ),
    );

  checks.repairPathSixCalls =
    repair.calls.length ===
      6;

  checks.exactRepairSequence =
    integrityCalls.length ===
      3 &&
    integrityCalls[0]
      ?.body?.repair ===
      false &&
    integrityCalls[1]
      ?.body?.repair ===
      true &&
    integrityCalls[2]
      ?.body?.repair ===
      false;

  checks.repairThenVerification =
    repair.result.selfHealing
      .repairAttempted ===
      true &&
    repair.result.selfHealing
      .verificationPerformed ===
      true;

  const blocked =
    await runScenario(
      nonRepairablePayload(),
    );

  checks.nonRepairablePathNoRepair =
    blocked.calls.length ===
      4 &&
    blocked.calls.every(
      (call) =>
        call.body?.repair !==
        true,
    );

  checks.qualityAlwaysLast =
    clean.calls[
      clean.calls.length -
      1
    ]?.url.endsWith(
      "/api/market/regime/v7/quality-gate/capture",
    ) ===
      true &&
    repair.calls[
      repair.calls.length -
      1
    ]?.url.endsWith(
      "/api/market/regime/v7/quality-gate/capture",
    ) ===
      true &&
    blocked.calls[
      blocked.calls.length -
      1
    ]?.url.endsWith(
      "/api/market/regime/v7/quality-gate/capture",
    ) ===
      true;

  checks.noOrderEndpoints =
    [
      ...clean.calls,
      ...repair.calls,
      ...blocked.calls,
    ].every(
      (call) =>
        !call.url.includes(
          "/api/orders/",
        ) &&
        !call.url.includes(
          "/api/signals/entry/",
        ) &&
        !call.url.includes(
          "/api/trading/automation/",
        ),
    );

  assert.equal(
    repair.result.safety
      .warningOnlyAutoRepair,
    false,
  );

  assert.equal(
    repair.result.safety
      .extremeReturnAutoRepair,
    false,
  );

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          !value,
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
            ? "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_SELF_HEALING_CONTRACT_VERIFIED"
            : "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_SELF_HEALING_CONTRACT_REVIEW",

        checks,
        failed,

        repairPolicy: {
          allowlistedErrorTypes: [
            "MISSING_STOCK_BAR",
          ],
          repairRequiresEveryErrorRepairable:
            true,
          warningOnlyAutoRepair:
            false,
          extremeReturnAutoRepair:
            false,
          explicitPostRepairRescan:
            true,
          qualityGateAlwaysRunsLast:
            true,
        },

        safety: {
          realNetworkCalls:
            0,
          databaseWrites:
            0,
          productionOrderEndpointCalled:
            false,
          ordersCreated:
            0,
          positionsChanged:
            0,
        },

        nextGate:
          failed.length ===
          0
            ? "TARGETED_TYPESCRIPT_AND_MANUAL_CLEAN_STATE_SMOKE"
            : "REVIEW_V3_SELF_HEALING_CONTRACT",
      },
      null,
      2,
    ),
  );

  if (
    failed.length >
    0
  ) {
    process.exitCode =
      2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_SELF_HEALING_CONTRACT_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
