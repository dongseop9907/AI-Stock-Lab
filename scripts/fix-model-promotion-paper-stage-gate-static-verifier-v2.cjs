const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/model-promotion-paper-stage-gate-binding-v2-static-verify.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true },
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst files = {\n  helper:\n    \"lib/models/model-promotion-gate.ts\",\n  signal:\n    \"lib/trading/generate-entry-signals.ts\",\n  service:\n    \"lib/trading/paper-order-service.ts\",\n  route:\n    \"app/api/orders/paper/route.ts\",\n  stateMachine:\n    \"lib/models/model-promotion-state-machine.ts\",\n};\n\nconst source = {};\n\nfor (\n  const [name, rel] of\n  Object.entries(files)\n) {\n  const abs =\n    path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    throw new Error(\n      `REQUIRED_FILE_MISSING:${rel}`,\n    );\n  }\n\n  source[name] =\n    fs.readFileSync(abs, \"utf8\");\n}\n\nfunction indexOfRequired(\n  text,\n  needle,\n  label,\n) {\n  const index =\n    text.indexOf(needle);\n\n  if (index < 0) {\n    throw new Error(\n      `REQUIRED_MARKER_MISSING:${label}`,\n    );\n  }\n\n  return index;\n}\n\nconst signalFunction =\n  indexOfRequired(\n    source.signal,\n    \"export async function generateEntrySignals\",\n    \"SIGNAL_FUNCTION\",\n  );\n\nconst signalAutoOrder =\n  indexOfRequired(\n    source.signal,\n    \"const autoOrder\",\n    \"SIGNAL_AUTO_ORDER\",\n  );\n\nconst signalGate =\n  indexOfRequired(\n    source.signal,\n    'assertModelPromotionAllowsPaperRisk(',\n    \"SIGNAL_GATE_CALL\",\n  );\n\nconst signalBoundary =\n  indexOfRequired(\n    source.signal,\n    '\"ENTRY_SIGNAL_AUTO_ORDER\"',\n    \"SIGNAL_BOUNDARY\",\n  );\n\nconst serviceFunction =\n  indexOfRequired(\n    source.service,\n    \"export async function createPaperBuyOrder\",\n    \"SERVICE_FUNCTION\",\n  );\n\nconst serviceValidate =\n  indexOfRequired(\n    source.service,\n    \"validateRequest(input);\",\n    \"SERVICE_VALIDATE\",\n  );\n\nconst serviceGate =\n  indexOfRequired(\n    source.service,\n    'assertModelPromotionAllowsPaperRisk(',\n    \"SERVICE_GATE_CALL\",\n  );\n\nconst serviceBoundary =\n  indexOfRequired(\n    source.service,\n    '\"PAPER_ORDER_SERVICE\"',\n    \"SERVICE_BOUNDARY\",\n  );\n\nconst serviceResolveModel =\n  indexOfRequired(\n    source.service,\n    \"resolveOrderModel(\",\n    \"SERVICE_RESOLVE_ORDER_MODEL\",\n  );\n\nconst checks = {\n  helperReadsPromotionStage:\n    source.helper.includes(\n      '.from(\"ai_model_versions\")',\n    ) &&\n    source.helper.includes(\n      \"promotion_stage\",\n    ),\n\n  helperPaperGate:\n    source.helper.includes(\n      \"assertModelPromotionAllowsPaperRisk\",\n    ) &&\n    source.helper.includes(\n      \"canCreatePaperRiskForPromotionStage\",\n    ),\n\n  helperLiveGateDefinedForFutureWriter:\n    source.helper.includes(\n      \"assertModelPromotionAllowsLiveRisk\",\n    ) &&\n    source.helper.includes(\n      \"canCreateLiveRiskForPromotionStage\",\n    ),\n\n  signalImportsGate:\n    source.signal.includes(\n      'from \"@/lib/models/model-promotion-gate\"',\n    ),\n\n  signalGateInsideGenerateFunction:\n    signalGate >\n      signalFunction,\n\n  signalGateAfterAutoOrderResolution:\n    signalGate >\n      signalAutoOrder,\n\n  signalBoundaryAttachedToGate:\n    signalBoundary >\n      signalGate &&\n    signalBoundary -\n      signalGate <\n      400,\n\n  serviceImportsGate:\n    source.service.includes(\n      'from \"@/lib/models/model-promotion-gate\"',\n    ),\n\n  serviceAuthoritativeGateInsideFunction:\n    serviceGate >\n      serviceFunction,\n\n  serviceGateAfterInputValidation:\n    serviceGate >\n      serviceValidate,\n\n  serviceGateBeforeResolveOrderModel:\n    serviceGate <\n      serviceResolveModel,\n\n  serviceBoundaryAttachedToGate:\n    serviceBoundary >\n      serviceGate &&\n    serviceBoundary -\n      serviceGate <\n      400,\n\n  routeStillDelegatesToAuthoritativeService:\n    source.route.includes(\n      \"createPaperBuyOrder\",\n    ),\n\n  paperRiskStagesExplicit:\n    source.stateMachine.includes(\n      'stage ===\\n      \"PAPER\"',\n    ) &&\n    source.stateMachine.includes(\n      'stage ===\\n      \"LIMITED_LIVE\"',\n    ) &&\n    source.stateMachine.includes(\n      'stage ===\\n      \"PRODUCTION\"',\n    ),\n\n  candidateNotPaperRiskStage:\n    !source.stateMachine\n      .slice(\n        source.stateMachine.indexOf(\n          \"canCreatePaperRiskForPromotionStage\",\n        ),\n        source.stateMachine.indexOf(\n          \"canCreateLiveRiskForPromotionStage\",\n        ),\n      )\n      .includes(\n        'stage ===\\n      \"CANDIDATE\"',\n      ),\n\n  noRealTradingEnable:\n    !/real_order_enabled\\s*=\\s*true/i.test(\n      source.helper +\n      \"\\n\" +\n      source.signal +\n      \"\\n\" +\n      source.service,\n    ),\n\n  noLiveWriterAdded:\n    !/\\b(submitLiveOrder|executeLiveOrder|createLiveOrder|placeLiveOrder|sendLiveOrder)\\b/.test(\n      source.helper +\n      \"\\n\" +\n      source.signal +\n      \"\\n\" +\n      source.service,\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, ok]) => !ok)\n    .map(([name]) => name);\n\nconst report = {\n  status:\n    failed.length === 0\n      ? \"MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V2_STATIC_VERIFIED\"\n      : \"MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V2_STATIC_FAILED\",\n\n  checks,\n  failed,\n\n  placement: {\n    signal: {\n      functionIndex:\n        signalFunction,\n      autoOrderIndex:\n        signalAutoOrder,\n      gateIndex:\n        signalGate,\n      boundaryIndex:\n        signalBoundary,\n    },\n\n    service: {\n      functionIndex:\n        serviceFunction,\n      validateIndex:\n        serviceValidate,\n      gateIndex:\n        serviceGate,\n      resolveOrderModelIndex:\n        serviceResolveModel,\n      boundaryIndex:\n        serviceBoundary,\n    },\n  },\n\n  sourceBindingApplied:\n    true,\n\n  databaseWrites:\n    0,\n\n  realTradingChanged:\n    false,\n\n  nextGate:\n    failed.length === 0\n      ? \"RUN_IMPORT_SMOKE_AND_DB_READ_CONTRACT\"\n      : \"STOP_AND_DIAGNOSE_SOURCE_PLACEMENT\",\n};\n\nconsole.log(\n  JSON.stringify(\n    report,\n    null,\n    2,\n  ),\n);\n\nif (failed.length > 0) {\n  process.exitCode = 1;\n}\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_PROMOTION_PAPER_STAGE_GATE_STATIC_VERIFIER_V2_INSTALLED",
      generatedFile:
        "scripts/model-promotion-paper-stage-gate-binding-v2-static-verify.cjs",
      sourceFilesModified:
        0,
      databaseWrites:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
      realTradingChanged:
        false,
      nextAction:
        "RUN_V2_STATIC_THEN_IMPORT_AND_DB_READ_CONTRACT"
    },
    null,
    2,
  ),
);
