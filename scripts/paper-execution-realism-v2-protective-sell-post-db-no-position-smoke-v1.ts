import { createSupabaseServerClient } from "../lib/supabase";
import { checkAndExecuteStopLosses } from "../lib/trading/check-stop-losses";
import { updateTrailingStops } from "../lib/trading/update-trailing-stops";

async function countRows(
  table: string,
): Promise<number> {
  const supabase =
    createSupabaseServerClient();

  const {
    count,
    error,
  } =
    await supabase
      .from(table)
      .select("*", {
        count: "exact",
        head: true,
      });

  if (error) {
    throw new Error(
      `COUNT_FAILED:${table}:${error.message}`,
    );
  }

  return count ?? 0;
}

async function readControl() {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "trading_system_controls",
      )
      .select(
        "emergency_stop,paper_order_enabled,real_order_enabled",
      )
      .eq(
        "control_key",
        "global",
      )
      .maybeSingle();

  if (error) {
    throw new Error(
      `CONTROL_READ_FAILED:${error.message}`,
    );
  }

  if (!data) {
    throw new Error(
      "CONTROL_ROW_MISSING",
    );
  }

  return data;
}

function sameControl(
  a: any,
  b: any,
) {
  return (
    a.emergency_stop ===
      b.emergency_stop &&
    a.paper_order_enabled ===
      b.paper_order_enabled &&
    a.real_order_enabled ===
      b.real_order_enabled
  );
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
    protectiveAudit:
      await countRows(
        "paper_protective_execution_fills_v2",
      ),
    control:
      await readControl(),
  };

  if (
    before.positions !==
      0
  ) {
    throw new Error(
      `NO_POSITION_SMOKE_REQUIRES_ZERO_POSITIONS:${before.positions}`,
    );
  }

  const stopLossResult =
    await checkAndExecuteStopLosses();

  const trailingResult =
    await updateTrailingStops();

  const after = {
    orders:
      await countRows(
        "paper_order_requests",
      ),
    positions:
      await countRows(
        "paper_positions",
      ),
    protectiveAudit:
      await countRows(
        "paper_protective_execution_fills_v2",
      ),
    control:
      await readControl(),
  };

  const checks = {
    startedWithZeroPositions:
      before.positions ===
      0,

    stopLossCompleted:
      stopLossResult !==
      undefined,

    trailingCompleted:
      trailingResult !==
      undefined,

    noOrdersCreated:
      after.orders ===
      before.orders,

    noPositionsCreated:
      after.positions ===
      before.positions,

    noProtectiveFillsCreated:
      after.protectiveAudit ===
      before.protectiveAudit,

    controlsUnchanged:
      sameControl(
        before.control,
        after.control,
      ),

    realTradingStillOff:
      after.control
        .real_order_enabled ===
      false,
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, ok]) =>
          !ok,
      )
      .map(
        ([name]) =>
          name,
      );

  const result = {
    status:
      failed.length ===
        0
        ? "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_POST_DB_NO_POSITION_SMOKE_V1_VERIFIED"
        : "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_POST_DB_NO_POSITION_SMOKE_V1_FAILED",

    services: {
      stopLoss:
        stopLossResult,
      trailing:
        trailingResult,
    },

    counts: {
      orders:
        `${before.orders}->${after.orders}`,
      positions:
        `${before.positions}->${after.positions}`,
      protectiveAudit:
        `${before.protectiveAudit}->${after.protectiveAudit}`,
    },

    checks,
    failed,

    control: {
      emergency_stop:
        after.control
          .emergency_stop,
      paper_order_enabled:
        after.control
          .paper_order_enabled,
      real_order_enabled:
        after.control
          .real_order_enabled,
    },

    safety: {
      ordersCreated:
        after.orders -
        before.orders,
      positionsCreated:
        after.positions -
        before.positions,
      protectiveFillsCreated:
        after.protectiveAudit -
        before.protectiveAudit,
      realTradingEnabledByScript:
        false,
    },

    nextGate:
      failed.length ===
        0
        ? "PAPER_EXECUTION_REALISM_V2_BUY_AND_PROTECTIVE_SELL_COMPLETE"
        : "STOP_AND_DIAGNOSE",
  };

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  if (
    failed.length >
      0
  ) {
    process.exitCode =
      1;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_POST_DB_NO_POSITION_SMOKE_V1_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            realTradingEnabledByScript:
              false,
          },
          nextGate:
            "STOP_AND_DIAGNOSE",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
