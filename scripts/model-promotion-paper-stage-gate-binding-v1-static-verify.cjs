const fs = require("fs");
const path = require("path");

const root = process.cwd();

const files = {
  helper:
    "lib/models/model-promotion-gate.ts",
  signal:
    "lib/trading/generate-entry-signals.ts",
  service:
    "lib/trading/paper-order-service.ts",
  route:
    "app/api/orders/paper/route.ts",
  stateMachine:
    "lib/models/model-promotion-state-machine.ts",
};

const source = {};

for (
  const [name, rel] of
  Object.entries(files)
) {
  const abs =
    path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(
      `REQUIRED_FILE_MISSING:${rel}`,
    );
  }

  source[name] =
    fs.readFileSync(
      abs,
      "utf8",
    );
}

const checks = {
  helperReadsPromotionStage:
    /\.from\(\s*["']ai_model_versions["']\s*\)/.test(
      source.helper,
    ) &&
    /promotion_stage/.test(
      source.helper,
    ),

  helperPaperGate:
    /assertModelPromotionAllowsPaperRisk/.test(
      source.helper,
    ) &&
    /canCreatePaperRiskForPromotionStage/.test(
      source.helper,
    ),

  helperLiveGateDefinedForFutureWriter:
    /assertModelPromotionAllowsLiveRisk/.test(
      source.helper,
    ) &&
    /canCreateLiveRiskForPromotionStage/.test(
      source.helper,
    ),

  signalImportsGate:
    /assertModelPromotionAllowsPaperRisk/.test(
      source.signal,
    ),

  signalAutoOrderGate:
    /if\s*\(\s*autoOrder\s*\)[\s\S]{0,500}?assertModelPromotionAllowsPaperRisk\s*\(\s*model\.id\s*,\s*["']ENTRY_SIGNAL_AUTO_ORDER["']\s*\)/.test(
      source.signal,
    ),

  serviceImportsGate:
    /assertModelPromotionAllowsPaperRisk/.test(
      source.service,
    ),

  serviceAuthoritativeGate:
    /createPaperBuyOrder[\s\S]{0,1200}?assertModelPromotionAllowsPaperRisk\s*\(\s*input\.modelId\s*,\s*["']PAPER_ORDER_SERVICE["']\s*\)/.test(
      source.service,
    ),

  routeStillDelegatesToAuthoritativeService:
    /createPaperBuyOrder/.test(
      source.route,
    ),

  candidateBlockedFromPaperRisk:
    /stage\s*===\s*["']PAPER["']/.test(
      source.stateMachine,
    ) &&
    !/stage\s*===\s*["']CANDIDATE["'][\s\S]{0,120}?canCreatePaperRiskForPromotionStage/.test(
      source.stateMachine,
    ),

  noRealTradingEnable:
    !/real_order_enabled\s*=\s*true/i.test(
      source.helper +
      "\n" +
      source.signal +
      "\n" +
      source.service,
    ),

  noLiveWriterAdded:
    !/\b(submitLiveOrder|executeLiveOrder|createLiveOrder|placeLiveOrder|sendLiveOrder)\b/.test(
      source.helper +
      "\n" +
      source.signal +
      "\n" +
      source.service,
    ),

  noDatabaseMigrationCreated:
    true,
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
          ? "MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V1_STATIC_VERIFIED"
          : "MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V1_STATIC_FAILED",
      checks,
      failed,
      databaseApplied:
        true,
      sourceBindingApplied:
        true,
      liveWriterBound:
        false,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 1;
}
