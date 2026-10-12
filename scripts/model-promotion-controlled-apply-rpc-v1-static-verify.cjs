const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261009000400_model_promotion_controlled_apply_v1.sql";

const moduleRel =
  "lib/models/model-promotion-apply.ts";

const migration =
  fs.readFileSync(
    path.resolve(
      root,
      migrationRel,
    ),
    "utf8",
  );

const moduleSource =
  fs.readFileSync(
    path.resolve(
      root,
      moduleRel,
    ),
    "utf8",
  );

const checks = {
  replacesGuardTriggerFunction:
    /create\s+or\s+replace\s+function\s+public\.enforce_model_promotion_stage_transition_v1/i.test(
      migration,
    ),

  directStageUpdateBlocked:
    migration.includes(
      "MODEL_PROMOTION_DIRECT_STAGE_UPDATE_BLOCKED",
    ),

  controlledApplyRpc:
    /create\s+or\s+replace\s+function\s+public\.apply_model_promotion_transition_v1/i.test(
      migration,
    ),

  rpcSecurityDefiner:
    /security\s+definer/i.test(
      migration,
    ),

  rowLock:
    /for\s+update/i.test(
      migration,
    ),

  controlledSessionFlag:
    migration.includes(
      "app.model_promotion_controlled_apply_v1",
    ),

  manualApprovalSessionFlag:
    migration.includes(
      "app.model_promotion_manual_approval_v1",
    ),

  limitedLiveManualApproval:
    /'PAPER'[\s\S]{0,200}'LIMITED_LIVE'/.test(
      migration,
    ) &&
    migration.includes(
      "MODEL_PROMOTION_MANUAL_APPROVAL_REQUIRED",
    ),

  productionManualApproval:
    /'LIMITED_LIVE'[\s\S]{0,200}'PRODUCTION'/.test(
      migration,
    ),

  degradedRecoveryManualApproval:
    /'DEGRADED'[\s\S]{0,200}'SHADOW'/.test(
      migration,
    ),

  writesAuditEvent:
    /insert\s+into\s+public\.model_promotion_events/i.test(
      migration,
    ),

  appliedAndBlockedAudit:
    migration.includes(
      "'APPLIED'",
    ) &&
    migration.includes(
      "'BLOCKED'",
    ),

  serviceRoleOnlyExecution:
    /grant\s+execute[\s\S]*to\s+service_role/i.test(
      migration,
    ) &&
    /revoke\s+all[\s\S]*from\s+authenticated/i.test(
      migration,
    ),

  noTradingControlMutation:
    !/(update|insert\s+into|delete\s+from)\s+public\.trading_system_controls/i.test(
      migration,
    ),

  noOrderMutation:
    !/(update|insert\s+into|delete\s+from)\s+public\.paper_order_requests/i.test(
      migration,
    ),

  noPositionMutation:
    !/(update|insert\s+into|delete\s+from)\s+public\.paper_positions/i.test(
      migration,
    ),

  noRealTradingEnable:
    !/real_order_enabled\s*=\s*true/i.test(
      migration +
      "\n" +
      moduleSource,
    ),

  moduleCallsOnlyControlledRpc:
    moduleSource.includes(
      '"apply_model_promotion_transition_v1"',
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "MODEL_PROMOTION_CONTROLLED_APPLY_RPC_V1_STATIC_VERIFIED"
          : "MODEL_PROMOTION_CONTROLLED_APPLY_RPC_V1_STATIC_FAILED",
      checks,
      failed,
      databaseApplied:
        false,
      promotionStageChanged:
        false,
      realTradingChanged:
        false,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 1;
}
