const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const audit = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-real-session-readiness-v1.ts"
);

if (!fs.existsSync(audit)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_V1_STATIC_FAILED",

    verifierVersion:
      "V2_STRING_ONLY_NO_REGEX",

    failed: [
      "auditExists"
    ],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      audit,
      "utf8"
    );

  const lower =
    source.toLowerCase();

  const checks = {
    auditExists:
      true,

    targetDatePinned:
      source.includes(
        '"2026-10-12"'
      ),

    krxCalendarBound:
      source.includes(
        "isKrxTradingDate"
      ) &&
      source.includes(
        "nextKrxTradingDate"
      ),

    controlledProducerChecked:
      source.includes(
        "FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED"
      ),

    exactPhraseChecked:
      source.includes(
        "RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER"
      ),

    automationOffChecked:
      source.includes(
        "FORWARD_OOS_AUTOMATION_ENABLED"
      ),

    realTradingFlagsChecked:
      source.includes(
        "REAL_TRADING_ENABLED"
      ) &&
      source.includes(
        "ENABLE_REAL_TRADING"
      ) &&
      source.includes(
        "ENABLE_LIVE_TRADING"
      ),

    maturityBindingChecked:
      source.includes(
        "addKrxTradingSessions("
      ),

    collectorBindingChecked:
      source.includes(
        "collectorSingleRunBinding"
      ),

    noSpawn:
      !source.includes(
        "spawn("
      ),

    noSupabaseSurface:
      !lower.includes(
        "supabase"
      ),

    noInsertSurface:
      !source.includes(
        ".insert("
      ) &&
      !source.includes(
        ".insert ("
      ),

    noUpdateSurface:
      !source.includes(
        ".update("
      ) &&
      !source.includes(
        ".update ("
      ),

    noDeleteSurface:
      !source.includes(
        ".delete("
      ) &&
      !source.includes(
        ".delete ("
      ),

    noOrderSurface:
      !lower.includes(
        "createorder("
      ) &&
      !lower.includes(
        "placeorder("
      ) &&
      !lower.includes(
        "submitorder("
      ),
  };

  const failed =
    Object.entries(
      checks
    )
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_FIRST_REAL_SESSION_READINESS_V1_STATIC_FAILED",

    verifierVersion:
      "V2_STRING_ONLY_NO_REGEX",

    checks,

    safety: {
      sourceOnly:
        true,

      producerExecuted:
        false,

      collectorExecuted:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_READINESS_CONTRACT_AND_CURRENT_AUDIT"
        : "REPAIR_FIRST_REAL_SESSION_READINESS_V1_STATIC"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
