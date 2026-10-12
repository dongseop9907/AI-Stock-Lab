import {
  resolveOrderModel,
} from "../lib/models/resolve-order-model";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const TEST_MODEL_ID =
  "4ad531c1-021e-4787-9e32-ec91600ba740";

const ENTRY_MODEL_ID =
  "3045646b-599b-41cd-9650-43e539fb7a95";

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

async function readControls() {
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
        "emergency_stop,automation_enabled,paper_order_enabled,real_order_enabled",
      )
      .eq(
        "control_key",
        "global",
      )
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `CONTROL_READ_FAILED:${
        error?.message ??
        "NOT_FOUND"
      }`,
    );
  }

  return data;
}

async function readModels() {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "ai_model_versions",
      )
      .select(
        "id,model_name,purpose,status,promotion_stage",
      )
      .in(
        "id",
        [
          TEST_MODEL_ID,
          ENTRY_MODEL_ID,
        ],
      );

  if (error) {
    throw new Error(
      `MODEL_READ_FAILED:${error.message}`,
    );
  }

  return data ?? [];
}

function sameControls(
  a: any,
  b: any,
) {
  return (
    a?.emergency_stop ===
      b?.emergency_stop &&
    a?.automation_enabled ===
      b?.automation_enabled &&
    a?.paper_order_enabled ===
      b?.paper_order_enabled &&
    a?.real_order_enabled ===
      b?.real_order_enabled
  );
}

async function main() {
  const models =
    await readModels();

  const testModel =
    models.find(
      (row) =>
        row.id ===
        TEST_MODEL_ID,
    );

  const entryModel =
    models.find(
      (row) =>
        row.id ===
        ENTRY_MODEL_ID,
    );

  if (!testModel) {
    throw new Error(
      "TEST_MODEL_NOT_FOUND",
    );
  }

  if (!entryModel) {
    throw new Error(
      "ENTRY_MODEL_NOT_FOUND",
    );
  }

  if (
    testModel.purpose !==
      "TEST"
  ) {
    throw new Error(
      `EXPECTED_TEST_PURPOSE:${testModel.purpose}`,
    );
  }

  if (
    testModel.promotion_stage !==
      "PAPER"
  ) {
    throw new Error(
      `EXPECTED_TEST_MODEL_PAPER_STAGE:${testModel.promotion_stage}`,
    );
  }

  const beforeControls =
    await readControls();

  const [
    beforeOrders,
    beforePositions,
    beforeEvents,
  ] =
    await Promise.all([
      countRows(
        "paper_order_requests",
      ),
      countRows(
        "paper_positions",
      ),
      countRows(
        "model_promotion_events",
      ),
    ]);

  let blocked = false;
  let blockMessage:
    string | null = null;

  try {
    await resolveOrderModel(
      TEST_MODEL_ID,
      "PAPER",
    );
  } catch (error) {
    blocked = true;
    blockMessage =
      error instanceof Error
        ? error.message
        : String(error);
  }

  const afterControls =
    await readControls();

  const [
    afterOrders,
    afterPositions,
    afterEvents,
  ] =
    await Promise.all([
      countRows(
        "paper_order_requests",
      ),
      countRows(
        "paper_positions",
      ),
      countRows(
        "model_promotion_events",
      ),
    ]);

  const checks = {
    testModelPurposeIsTest:
      testModel.purpose ===
        "TEST",

    testModelPromotionStageIsPaper:
      testModel.promotion_stage ===
        "PAPER",

    resolverBlocksTestPurpose:
      blocked ===
        true,

    noOrdersCreated:
      afterOrders ===
        beforeOrders,

    noPositionsChanged:
      afterPositions ===
        beforePositions,

    promotionEventsUnchanged:
      afterEvents ===
        beforeEvents,

    controlsUnchanged:
      sameControls(
        beforeControls,
        afterControls,
      ),

    realTradingStillOff:
      afterControls.real_order_enabled ===
        false,
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, ok]) => !ok,
      )
      .map(
        ([name]) => name,
      );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "MODEL_ORDER_PURPOSE_GATE_REGRESSION_V1_VERIFIED"
            : "MODEL_ORDER_PURPOSE_GATE_REGRESSION_V1_FAILED",

        testModel: {
          id:
            testModel.id,
          name:
            testModel.model_name,
          purpose:
            testModel.purpose,
          legacyStatus:
            testModel.status,
          promotionStage:
            testModel.promotion_stage,
        },

        resolver: {
          tradingMode:
            "PAPER",
          blocked,
          blockMessage,
        },

        counts: {
          orders:
            `${beforeOrders}->${afterOrders}`,
          positions:
            `${beforePositions}->${afterPositions}`,
          promotionEvents:
            `${beforeEvents}->${afterEvents}`,
        },

        controls: {
          before:
            beforeControls,
          after:
            afterControls,
        },

        checks,
        failed,

        safety: {
          databaseWrites:
            0,
          ordersCreated:
            afterOrders -
            beforeOrders,
          positionsChanged:
            afterPositions -
            beforePositions,
          controlsChanged:
            !sameControls(
              beforeControls,
              afterControls,
            ),
          realTradingChanged:
            false,
        },

        nextGate:
          failed.length === 0
            ? "PURPOSE_GATE_ALREADY_HARDENED_CONTINUE_SHADOW_EVIDENCE_LIFECYCLE"
            : "PATCH_RESOLVE_ORDER_MODEL_TO_REQUIRE_ENTRY_TIMING_PURPOSE",
      },
      null,
      2,
    ),
  );

  if (
    failed.length >
      0
  ) {
    process.exitCode = 1;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "MODEL_ORDER_PURPOSE_GATE_REGRESSION_V1_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            databaseWrites:
              0,
            realTradingChanged:
              false,
          },
          nextGate:
            "STOP_AND_DIAGNOSE_PURPOSE_GATE",
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
