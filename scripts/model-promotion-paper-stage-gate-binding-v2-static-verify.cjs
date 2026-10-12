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
    fs.readFileSync(abs, "utf8");
}

function indexOfRequired(
  text,
  needle,
  label,
) {
  const index =
    text.indexOf(needle);

  if (index < 0) {
    throw new Error(
      `REQUIRED_MARKER_MISSING:${label}`,
    );
  }

  return index;
}

const signalFunction =
  indexOfRequired(
    source.signal,
    "export async function generateEntrySignals",
    "SIGNAL_FUNCTION",
  );

const signalAutoOrder =
  indexOfRequired(
    source.signal,
    "const autoOrder",
    "SIGNAL_AUTO_ORDER",
  );

const signalGate =
  indexOfRequired(
    source.signal,
    'assertModelPromotionAllowsPaperRisk(',
    "SIGNAL_GATE_CALL",
  );

const signalBoundary =
  indexOfRequired(
    source.signal,
    '"ENTRY_SIGNAL_AUTO_ORDER"',
    "SIGNAL_BOUNDARY",
  );

const serviceFunction =
  indexOfRequired(
    source.service,
    "export async function createPaperBuyOrder",
    "SERVICE_FUNCTION",
  );

const serviceValidate =
  indexOfRequired(
    source.service,
    "validateRequest(input);",
    "SERVICE_VALIDATE",
  );

const serviceGate =
  indexOfRequired(
    source.service,
    'assertModelPromotionAllowsPaperRisk(',
    "SERVICE_GATE_CALL",
  );

const serviceBoundary =
  indexOfRequired(
    source.service,
    '"PAPER_ORDER_SERVICE"',
    "SERVICE_BOUNDARY",
  );

const serviceResolveModel =
  indexOfRequired(
    source.service,
    "resolveOrderModel(",
    "SERVICE_RESOLVE_ORDER_MODEL",
  );

const checks = {
  helperReadsPromotionStage:
    source.helper.includes(
      '.from("ai_model_versions")',
    ) &&
    source.helper.includes(
      "promotion_stage",
    ),

  helperPaperGate:
    source.helper.includes(
      "assertModelPromotionAllowsPaperRisk",
    ) &&
    source.helper.includes(
      "canCreatePaperRiskForPromotionStage",
    ),

  helperLiveGateDefinedForFutureWriter:
    source.helper.includes(
      "assertModelPromotionAllowsLiveRisk",
    ) &&
    source.helper.includes(
      "canCreateLiveRiskForPromotionStage",
    ),

  signalImportsGate:
    source.signal.includes(
      'from "@/lib/models/model-promotion-gate"',
    ),

  signalGateInsideGenerateFunction:
    signalGate >
      signalFunction,

  signalGateAfterAutoOrderResolution:
    signalGate >
      signalAutoOrder,

  signalBoundaryAttachedToGate:
    signalBoundary >
      signalGate &&
    signalBoundary -
      signalGate <
      400,

  serviceImportsGate:
    source.service.includes(
      'from "@/lib/models/model-promotion-gate"',
    ),

  serviceAuthoritativeGateInsideFunction:
    serviceGate >
      serviceFunction,

  serviceGateAfterInputValidation:
    serviceGate >
      serviceValidate,

  serviceGateBeforeResolveOrderModel:
    serviceGate <
      serviceResolveModel,

  serviceBoundaryAttachedToGate:
    serviceBoundary >
      serviceGate &&
    serviceBoundary -
      serviceGate <
      400,

  routeStillDelegatesToAuthoritativeService:
    source.route.includes(
      "createPaperBuyOrder",
    ),

  paperRiskStagesExplicit:
    source.stateMachine.includes(
      'stage ===\n      "PAPER"',
    ) &&
    source.stateMachine.includes(
      'stage ===\n      "LIMITED_LIVE"',
    ) &&
    source.stateMachine.includes(
      'stage ===\n      "PRODUCTION"',
    ),

  candidateNotPaperRiskStage:
    !source.stateMachine
      .slice(
        source.stateMachine.indexOf(
          "canCreatePaperRiskForPromotionStage",
        ),
        source.stateMachine.indexOf(
          "canCreateLiveRiskForPromotionStage",
        ),
      )
      .includes(
        'stage ===\n      "CANDIDATE"',
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
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

const report = {
  status:
    failed.length === 0
      ? "MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V2_STATIC_VERIFIED"
      : "MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V2_STATIC_FAILED",

  checks,
  failed,

  placement: {
    signal: {
      functionIndex:
        signalFunction,
      autoOrderIndex:
        signalAutoOrder,
      gateIndex:
        signalGate,
      boundaryIndex:
        signalBoundary,
    },

    service: {
      functionIndex:
        serviceFunction,
      validateIndex:
        serviceValidate,
      gateIndex:
        serviceGate,
      resolveOrderModelIndex:
        serviceResolveModel,
      boundaryIndex:
        serviceBoundary,
    },
  },

  sourceBindingApplied:
    true,

  databaseWrites:
    0,

  realTradingChanged:
    false,

  nextGate:
    failed.length === 0
      ? "RUN_IMPORT_SMOKE_AND_DB_READ_CONTRACT"
      : "STOP_AND_DIAGNOSE_SOURCE_PLACEMENT",
};

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 1;
}
