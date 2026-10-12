const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-paper-promotion-actual-execution-review-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_STATIC_FAILED",

    failed: [
      "gateExists"
    ],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  /*
   * Important:
   * This gate intentionally contains quoted strings such as
   * ".insert(", ".delete()" and "applyManualPaperPromotion("
   * because it audits another source file.
   *
   * Therefore static safety checks MUST detect executable imports/calls,
   * not mere quoted inspection needles.
   */

  const importsActualApplyService =
    /import\s*\{[^}]*\bapplyManualPaperPromotion\b[^}]*\}\s*from\s*["'][^"']*model-promotion-manual-apply["']/s.test(
      source
    );

  const directlyCallsActualApplyService =
    /\bawait\s+applyManualPaperPromotion\s*\(/.test(
      source
    ) ||
    /\breturn\s+applyManualPaperPromotion\s*\(/.test(
      source
    );

  const importsPromotionRoute =
    /from\s*["'][^"']*app\/api\/models\/promotion\/apply\/route["']/.test(
      source
    ) ||
    /import\s*\(\s*["'][^"']*app\/api\/models\/promotion\/apply\/route["']\s*\)/.test(
      source
    );

  const importsSupabaseRuntime =
    /from\s*["'][^"']*(?:supabase|supabase-server|supabase-client)[^"']*["']/.test(
      source
    ) ||
    /\bcreateClient\s*\(/.test(
      source
    );

  const hasExecutableDbMutationChain =
    /\b(?:supabase|db|client)\s*\.\s*from\s*\([^)]*\)\s*(?:\.[\s\S]{0,120}?)*?\.(?:insert|update|upsert|delete)\s*\(/.test(
      source
    );

  const checks = {
    gateExists:
      true,

    finalAuthorizationRequired:
      source.includes(
        "runPaperPromotionFinalAuthorizationGateV1"
      ),

    actualApplySourceReadOnly:
      source.includes(
        "lib/models/model-promotion-manual-apply.ts"
      ) &&
      source.includes(
        "readFileSync"
      ),

    eventInsertChecked:
      source.includes(
        "eventInsertExists"
      ),

    eventBeforeStageChecked:
      source.includes(
        "eventInsertedBeforeStageUpdate"
      ),

    compareAndSetShadowChecked:
      source.includes(
        "stageUpdateCompareAndSetShadow"
      ),

    compensationDeleteChecked:
      source.includes(
        "compensationDeleteExists"
      ) &&
      source.includes(
        "compensationTargetsInsertedEvent"
      ),

    updateFailureThrowChecked:
      source.includes(
        "MODEL_PROMOTION_MANUAL_APPLY_STAGE_UPDATE_FAILED:"
      ),

    exactPhraseChecked:
      source.includes(
        "exactPhraseStillBound"
      ),

    entryTimingChecked:
      source.includes(
        "entryTimingOnly"
      ),

    canonicalFailClosedChecked:
      source.includes(
        "canonicalEvidenceFailClosed"
      ),

    recommendationReadyChecked:
      source.includes(
        "recommendationMustBeReady"
      ),

    noApplyImport:
      importsActualApplyService ===
        false &&
      directlyCallsActualApplyService ===
        false,

    noPromotionRouteImport:
      importsPromotionRoute ===
        false,

    noDatabaseWriteSurface:
      importsSupabaseRuntime ===
        false &&
      hasExecutableDbMutationChain ===
        false,

    noOrderSurface:
      !/\b(?:createOrder|placeOrder|submitOrder)\s*\(/i.test(
        source
      ),

    noRealTradingEnable:
      !/(?:REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\s*=\s*["']true["']/.test(
        source
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_STATIC_FAILED",

    verifierVersion:
      "V3_EXECUTABLE_SURFACE_AWARE",

    checks,

    diagnostics: {
      importsActualApplyService,
      directlyCallsActualApplyService,
      importsPromotionRoute,
      importsSupabaseRuntime,
      hasExecutableDbMutationChain,
    },

    safety: {
      sourceOnly:
        true,

      finalAuthorizationExecuted:
        false,

      actualPromotionApplyExecuted:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_ACTUAL_PROMOTION_EXECUTION_REVIEW_CONTRACT"
        : "REPAIR_ACTUAL_PROMOTION_EXECUTION_REVIEW_GATE_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
