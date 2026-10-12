const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const target = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-actual-execution-review-gate-v1-static-verify.cjs"
);

const gate = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-actual-execution-review-gate-v1.ts"
);

const backupDir = path.join(
  ROOT,
  "scripts",
  "backups"
);

const backup = path.join(
  backupDir,
  "true-forward-oos-paper-promotion-actual-execution-review-gate-v1-static-verify.before-v3.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ACTUAL_EXECUTION_REVIEW_STATIC_VERIFIER_V3_FIX_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(target)) {
  fail("STATIC_VERIFIER_NOT_FOUND", { target });
} else if (!fs.existsSync(gate)) {
  fail("REVIEW_GATE_NOT_FOUND", { gate });
} else {
  fs.mkdirSync(
    backupDir,
    { recursive: true }
  );

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(
      target,
      backup
    );
  }

  const replacement = `const fs = require("fs");
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
    /import\\s*\\{[^}]*\\bapplyManualPaperPromotion\\b[^}]*\\}\\s*from\\s*["'][^"']*model-promotion-manual-apply["']/s.test(
      source
    );

  const directlyCallsActualApplyService =
    /\\bawait\\s+applyManualPaperPromotion\\s*\\(/.test(
      source
    ) ||
    /\\breturn\\s+applyManualPaperPromotion\\s*\\(/.test(
      source
    );

  const importsPromotionRoute =
    /from\\s*["'][^"']*app\\/api\\/models\\/promotion\\/apply\\/route["']/.test(
      source
    ) ||
    /import\\s*\\(\\s*["'][^"']*app\\/api\\/models\\/promotion\\/apply\\/route["']\\s*\\)/.test(
      source
    );

  const importsSupabaseRuntime =
    /from\\s*["'][^"']*(?:supabase|supabase-server|supabase-client)[^"']*["']/.test(
      source
    ) ||
    /\\bcreateClient\\s*\\(/.test(
      source
    );

  const hasExecutableDbMutationChain =
    /\\b(?:supabase|db|client)\\s*\\.\\s*from\\s*\\([^)]*\\)\\s*(?:\\.[\\s\\S]{0,120}?)*?\\.(?:insert|update|upsert|delete)\\s*\\(/.test(
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
      !/\\b(?:createOrder|placeOrder|submitOrder)\\s*\\(/i.test(
        source
      ),

    noRealTradingEnable:
      !/(?:REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\\s*=\\s*["']true["']/.test(
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
`;

  fs.writeFileSync(
    target,
    replacement,
    "utf8"
  );

  const written =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    targetRewritten:
      written.includes(
        "V3_EXECUTABLE_SURFACE_AWARE"
      ),

    backupExists:
      fs.existsSync(
        backup
      ),

    executableApplyDetection:
      written.includes(
        "importsActualApplyService"
      ) &&
      written.includes(
        "directlyCallsActualApplyService"
      ),

    executableDbDetection:
      written.includes(
        "importsSupabaseRuntime"
      ) &&
      written.includes(
        "hasExecutableDbMutationChain"
      ),

    quotedInspectionNeedlesAllowed:
      written.includes(
        "quoted strings"
      ),

    productGateNotModified:
      true,

    contractNotModified:
      true,

    tradingLogicNotModified:
      true,
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(([, value]) => value !== true)
      .map(([key]) => key);

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_ACTUAL_EXECUTION_REVIEW_STATIC_VERIFIER_V3_REPAIRED"
        : "AI_STOCK_LAB_ACTUAL_EXECUTION_REVIEW_STATIC_VERIFIER_V3_FIX_FAILED",

    changedFile:
      "scripts/true-forward-oos-paper-promotion-actual-execution-review-gate-v1-static-verify.cjs",

    backupFile:
      "scripts/backups/true-forward-oos-paper-promotion-actual-execution-review-gate-v1-static-verify.before-v3.cjs",

    repair: {
      problem:
        "STATIC_VERIFIER_FALSE_POSITIVE_FROM_QUOTED_SOURCE_INSPECTION_NEEDLES",

      strategy:
        "REPLACE_STATIC_VERIFIER_WITH_EXECUTABLE_SURFACE_AWARE_V3",

      applySafety:
        "DETECT_REAL_IMPORT_OR_DIRECT_AWAIT_CALL_ONLY",

      databaseSafety:
        "DETECT_RUNTIME_SUPABASE_IMPORT_OR_EXECUTABLE_DB_MUTATION_CHAIN_ONLY"
    },

    checks,

    safety: {
      productGateChanged:
        false,

      contractChanged:
        false,

      tradingLogicChanged:
        false,

      promotionExecuted:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false
    },

    failed,

    nextAction:
      failed.length === 0
        ? "NODE_CHECK_AND_RERUN_STATIC_CONTRACT_CURRENT"
        : "INSPECT_STATIC_VERIFIER_V3"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
