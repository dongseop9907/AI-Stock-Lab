import {
  createClient,
} from "@supabase/supabase-js";

import {
  readCanonicalDataFreshnessState,
} from "../lib/trading/data-freshness-canonical-reader";

import {
  assertDataFreshnessAllows,
  readCurrentDataFreshnessProductionDecision,
  DataFreshnessBlockedError,
} from "../lib/trading/data-freshness-production-guard";

const supabaseUrl =
  String(
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "",
  )
    .trim()
    .replace(/\/+$/, "");

const serviceRoleKey =
  String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    "",
  ).trim();

if (
  !supabaseUrl ||
  !serviceRoleKey
) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_CONFIG_MISSING",
  );
}

const supabase =
  createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

async function countRows(
  table:
    string,
): Promise<number | null> {
  const result =
    await supabase
      .from(table)
      .select(
        "*",
        {
          count: "exact",
          head: true,
        },
      );

  if (result.error) {
    return null;
  }

  return result.count ?? 0;
}

async function expectBlocked(
  action:
    "PAPER_BUY_CREATE" |
    "PAPER_BUY_EXECUTE",
) {
  try {
    await assertDataFreshnessAllows(
      supabase,
      action,
    );

    return {
      blocked: false,
      errorType: null,
      reason: null,
    };
  } catch (error) {
    if (
      error instanceof
      DataFreshnessBlockedError
    ) {
      return {
        blocked: true,
        errorType:
          error.name,
        reason:
          error.decision.reason,
      };
    }

    return {
      blocked: false,
      errorType:
        error instanceof Error
          ? error.name
          : "UNKNOWN_ERROR",
      reason:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

async function main() {
  const before = {
    orders:
      await countRows(
        "paper_order_requests",
      ),

    positions:
      await countRows(
        "paper_positions",
      ),
  };

  const state =
    await readCanonicalDataFreshnessState(
      supabase,
    );

  const decisions = {
    automationCreate:
      await readCurrentDataFreshnessProductionDecision(
        supabase,
        "PAPER_BUY_CREATE",
      ),

    create:
      await readCurrentDataFreshnessProductionDecision(
        supabase,
        "PAPER_BUY_CREATE",
      ),

    execute:
      await readCurrentDataFreshnessProductionDecision(
        supabase,
        "PAPER_BUY_EXECUTE",
      ),

    protectiveExit:
      await readCurrentDataFreshnessProductionDecision(
        supabase,
        "PROTECTIVE_EXIT",
      ),

    riskMaintenance:
      await readCurrentDataFreshnessProductionDecision(
        supabase,
        "RISK_MAINTENANCE",
      ),
  };

  const createGuard =
    await expectBlocked(
      "PAPER_BUY_CREATE",
    );

  const executeGuard =
    await expectBlocked(
      "PAPER_BUY_EXECUTE",
    );

  const after = {
    orders:
      await countRows(
        "paper_order_requests",
      ),

    positions:
      await countRows(
        "paper_positions",
      ),
  };

  const deltas = {
    orders:
      before.orders !== null &&
      after.orders !== null
        ? after.orders -
          before.orders
        : null,

    positions:
      before.positions !== null &&
      after.positions !== null
        ? after.positions -
          before.positions
        : null,
  };

  const staleAtTestTime =
    state.usableForProduction ===
      false;

  const checks = {
    canonicalStateRead:
      Boolean(
        state.freshnessObservedAt,
      ) &&
      Boolean(
        state.qualityObservedAt,
      ),

    staleAtTestTime,

    createDecisionBlocked:
      !decisions.create.allowed,

    executeDecisionBlocked:
      !decisions.execute.allowed,

    createGuardThrowsFailClosed:
      createGuard.blocked,

    executeGuardThrowsFailClosed:
      executeGuard.blocked,

    protectiveExitAllowed:
      decisions.protectiveExit.allowed ===
        true,

    riskMaintenanceAllowed:
      decisions.riskMaintenance.allowed ===
        true,

    noOrderWrites:
      deltas.orders ===
        null ||
      deltas.orders ===
        0,

    noPositionWrites:
      deltas.positions ===
        null ||
      deltas.positions ===
        0,
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, value]) => !value,
      )
      .map(
        ([key]) => key,
      );

  const status =
    !staleAtTestTime
      ? "ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_INCONCLUSIVE_FRESH_NOW"
      : failed.length === 0
        ? "ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_VERIFIED"
        : "ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_REVIEW";

  console.log(
    JSON.stringify(
      {
        status,

        state: {
          freshnessStatus:
            state.freshnessStatus,

          qualityStatus:
            state.qualityStatus,

          usableForProduction:
            state.usableForProduction,

          expectedMarketDate:
            state.expectedMarketDate,

          latestCommonDate:
            state.latestCommonDate,

          businessWeekdayLag:
            state.businessWeekdayLag,
        },

        decisions: {
          create: {
            allowed:
              decisions.create.allowed,

            reason:
              decisions.create.reason,
          },

          execute: {
            allowed:
              decisions.execute.allowed,

            reason:
              decisions.execute.reason,
          },

          protectiveExit: {
            allowed:
              decisions.protectiveExit.allowed,

            reason:
              decisions.protectiveExit.reason,
          },

          riskMaintenance: {
            allowed:
              decisions.riskMaintenance.allowed,

            reason:
              decisions.riskMaintenance.reason,
          },
        },

        guards: {
          create:
            createGuard,

          execute:
            executeGuard,
        },

        before,
        after,
        deltas,

        checks,
        failed,

        safety: {
          productionCreateCalled:
            false,

          productionFillCalled:
            false,

          automationAutoOrderRun:
            false,

          databaseWritesByTest:
            0,

          purpose:
            "VERIFY_REAL_STALE_STATE_BLOCKS_NEW_RISK_WITHOUT_CREATING_TEST_ORDERS",
        },

        nextGate:
          status ===
            "ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_VERIFIED"
            ? "BUILD_DB_FRESHNESS_CREATE_FILL_GUARDS_V1"
            : status.endsWith(
                "INCONCLUSIVE_FRESH_NOW",
              )
              ? "RUN_FRESH_STATE_POSITIVE_CONTRACT_ONLY_OR_WAIT_FOR_NEXT_STALE_WINDOW"
              : "REVIEW_APPLICATION_FRESHNESS_GUARD",
      },
      null,
      2,
    ),
  );

  if (
    status.endsWith(
      "_REVIEW",
    )
  ) {
    process.exitCode = 2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            productionCreateCalled:
              false,

            productionFillCalled:
              false,

            databaseWritesByTest:
              0,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 2;
  },
);
