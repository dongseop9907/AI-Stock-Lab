const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const bindingRel =
  "lib/research/run-true-forward-oos-automation-binding-v1.ts";

const binding =
  fs.readFileSync(
    path.join(
      ROOT,
      bindingRel
    ),
    "utf8"
  );

const checks = {
  importsCanonicalKrxCalendar:
    binding.includes(
      'from "../trading/krx-trading-calendar"'
    ),

  importsIsKrxTradingDate:
    binding.includes(
      "isKrxTradingDate"
    ),

  hasExplicitKrxGuardMarker:
    binding.includes(
      "ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1"
    ),

  checksCanonicalTradingDate:
    /isKrxTradingDate\s*\(/.test(
      binding
    ),

  hasNonTradingDaySkipStatus:
    binding.includes(
      "SKIPPED_NON_KRX_TRADING_DAY"
    ),

  noDatabaseDependencyAdded:
    !/createSupabaseServerClient|market_exchange_calendar_overrides/.test(
      binding
    ),

  noOrderCreationSurface:
    !/createOrder|placeOrder|submitOrder|orders\.insert/i.test(
      binding
    ),

  noPromotionApplySurface:
    !/PROMOTE_SHADOW_TO_PAPER|applyPromotion/i.test(
      binding
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, value]) =>
      value !== true
    )
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_STATIC_VERIFIED"
          : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_STATIC_FAILED",

      checks,

      safety: {
        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        promotionApplied:
          false,

        realTradingEnabled:
          false,
      },

      failed,

      nextGate:
        failed.length === 0
          ? "RUN_KRX_GUARD_CONTRACT"
          : "REPAIR_BINDING_KRX_GUARD_SOURCE",
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
