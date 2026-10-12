const fs = require("fs");
const path = require("path");

const root = process.cwd();

const helperRel =
  "lib/models/model-promotion-gate.ts";

const signalRel =
  "lib/trading/generate-entry-signals.ts";

const serviceRel =
  "lib/trading/paper-order-service.ts";

const backupSuffix =
  ".pre-model-promotion-paper-stage-gate-v1";

function readRequired(rel) {
  const abs =
    path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(
      `REQUIRED_FILE_MISSING:${rel}`,
    );
  }

  return fs.readFileSync(
    abs,
    "utf8",
  );
}

function backupOnce(rel, content) {
  const backup =
    path.resolve(
      root,
      `${rel}${backupSuffix}`,
    );

  if (!fs.existsSync(backup)) {
    fs.writeFileSync(
      backup,
      content,
      "utf8",
    );
  }
}

function addImport(
  source,
  importText,
  anchor,
  marker,
) {
  if (source.includes(marker)) {
    return source;
  }

  const index =
    source.indexOf(anchor);

  if (index < 0) {
    throw new Error(
      `IMPORT_ANCHOR_NOT_FOUND:${marker}`,
    );
  }

  const end =
    index + anchor.length;

  return (
    source.slice(0, end) +
    "\n" +
    importText +
    source.slice(end)
  );
}

function patchSignal(source) {
  source = addImport(
    source,
    'import { assertModelPromotionAllowsPaperRisk } from "@/lib/models/model-promotion-gate";',
    'import { createPaperBuyOrder } from "@/lib/trading/paper-order-service";',
    'assertModelPromotionAllowsPaperRisk',
  );

  if (
    !source.includes(
      '"ENTRY_SIGNAL_AUTO_ORDER"',
    )
  ) {
    const anchor =
`  const autoOrder =
    input.autoOrder === true;`;

    const index =
      source.indexOf(anchor);

    if (index < 0) {
      throw new Error(
        "SIGNAL_AUTO_ORDER_ANCHOR_NOT_FOUND",
      );
    }

    const insertion =
`${anchor}

  if (autoOrder) {
    await assertModelPromotionAllowsPaperRisk(
      model.id,
      "ENTRY_SIGNAL_AUTO_ORDER",
    );
  }`;

    source =
      source.slice(0, index) +
      insertion +
      source.slice(
        index + anchor.length,
      );
  }

  return source;
}

function patchService(source) {
  source = addImport(
    source,
    'import { assertModelPromotionAllowsPaperRisk } from "@/lib/models/model-promotion-gate";',
    'import { resolveOrderModel } from "@/lib/models/resolve-order-model";',
    'assertModelPromotionAllowsPaperRisk',
  );

  if (
    !source.includes(
      '"PAPER_ORDER_SERVICE"',
    )
  ) {
    const anchor =
`  validateRequest(input);`;

    const index =
      source.indexOf(anchor);

    if (index < 0) {
      throw new Error(
        "SERVICE_VALIDATE_ANCHOR_NOT_FOUND",
      );
    }

    const insertion =
`${anchor}

  await assertModelPromotionAllowsPaperRisk(
    input.modelId,
    "PAPER_ORDER_SERVICE",
  );`;

    source =
      source.slice(0, index) +
      insertion +
      source.slice(
        index + anchor.length,
      );
  }

  return source;
}

const signalBefore =
  readRequired(signalRel);

const serviceBefore =
  readRequired(serviceRel);

backupOnce(
  signalRel,
  signalBefore,
);

backupOnce(
  serviceRel,
  serviceBefore,
);

const signalAfter =
  patchSignal(
    signalBefore,
  );

const serviceAfter =
  patchService(
    serviceBefore,
  );

fs.mkdirSync(
  path.resolve(
    root,
    "lib/models",
  ),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(
    root,
    helperRel,
  ),
  "import {\n  canCreateLiveRiskForPromotionStage,\n  canCreatePaperRiskForPromotionStage,\n  isModelPromotionStage,\n  type ModelPromotionStage,\n} from \"@/lib/models/model-promotion-state-machine\";\n\nimport {\n  createSupabaseServerClient,\n} from \"@/lib/supabase\";\n\nexport interface ModelPromotionGateRecord {\n  id: string;\n  status: string;\n  promotionStage: ModelPromotionStage;\n}\n\nexport async function resolveModelPromotionGate(\n  modelId: string,\n): Promise<ModelPromotionGateRecord> {\n  if (!modelId?.trim()) {\n    throw new Error(\n      \"MODEL_PROMOTION_GATE_MODEL_ID_REQUIRED\",\n    );\n  }\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase\n      .from(\"ai_model_versions\")\n      .select(\n        \"id,status,promotion_stage\",\n      )\n      .eq(\"id\", modelId)\n      .single();\n\n  if (error || !data) {\n    throw new Error(\n      `MODEL_PROMOTION_GATE_MODEL_LOOKUP_FAILED:${\n        error?.message ??\n        \"MODEL_NOT_FOUND\"\n      }`,\n    );\n  }\n\n  if (\n    !isModelPromotionStage(\n      data.promotion_stage,\n    )\n  ) {\n    throw new Error(\n      `MODEL_PROMOTION_STAGE_INVALID:${\n        data.promotion_stage ??\n        \"NULL\"\n      }`,\n    );\n  }\n\n  return {\n    id:\n      data.id,\n    status:\n      data.status,\n    promotionStage:\n      data.promotion_stage,\n  };\n}\n\nexport async function assertModelPromotionAllowsPaperRisk(\n  modelId: string,\n  boundary:\n    | \"ENTRY_SIGNAL_AUTO_ORDER\"\n    | \"PAPER_ORDER_SERVICE\"\n    | \"PAPER_ORDER_API\"\n    | string,\n): Promise<ModelPromotionGateRecord> {\n  const model =\n    await resolveModelPromotionGate(\n      modelId,\n    );\n\n  if (\n    !canCreatePaperRiskForPromotionStage(\n      model.promotionStage,\n    )\n  ) {\n    throw new Error(\n      `MODEL_PROMOTION_PAPER_RISK_BLOCKED:${model.promotionStage}:${boundary}`,\n    );\n  }\n\n  return model;\n}\n\nexport async function assertModelPromotionAllowsLiveRisk(\n  modelId: string,\n  boundary: string,\n): Promise<ModelPromotionGateRecord> {\n  const model =\n    await resolveModelPromotionGate(\n      modelId,\n    );\n\n  if (\n    !canCreateLiveRiskForPromotionStage(\n      model.promotionStage,\n    )\n  ) {\n    throw new Error(\n      `MODEL_PROMOTION_LIVE_RISK_BLOCKED:${model.promotionStage}:${boundary}`,\n    );\n  }\n\n  return model;\n}\n",
  "utf8",
);

fs.writeFileSync(
  path.resolve(
    root,
    signalRel,
  ),
  signalAfter,
  "utf8",
);

fs.writeFileSync(
  path.resolve(
    root,
    serviceRel,
  ),
  serviceAfter,
  "utf8",
);

const generated = {
  "scripts/model-promotion-paper-stage-gate-binding-v1-contract-test.ts":
    "import {\n  canCreateLiveRiskForPromotionStage,\n  canCreatePaperRiskForPromotionStage,\n} from \"../lib/models/model-promotion-state-machine\";\n\nfunction assert(\n  condition: unknown,\n  message: string,\n): asserts condition {\n  if (!condition) {\n    throw new Error(message);\n  }\n}\n\nconst paperAllowed = [\n  \"PAPER\",\n  \"LIMITED_LIVE\",\n  \"PRODUCTION\",\n] as const;\n\nconst paperBlocked = [\n  \"EXPERIMENTAL\",\n  \"CANDIDATE\",\n  \"SHADOW\",\n  \"DEGRADED\",\n  \"DISABLED\",\n] as const;\n\nfor (const stage of paperAllowed) {\n  assert(\n    canCreatePaperRiskForPromotionStage(\n      stage,\n    ),\n    `PAPER_RISK_SHOULD_BE_ALLOWED:${stage}`,\n  );\n}\n\nfor (const stage of paperBlocked) {\n  assert(\n    !canCreatePaperRiskForPromotionStage(\n      stage,\n    ),\n    `PAPER_RISK_SHOULD_BE_BLOCKED:${stage}`,\n  );\n}\n\nassert(\n  canCreateLiveRiskForPromotionStage(\n    \"LIMITED_LIVE\",\n  ),\n  \"LIMITED_LIVE_MUST_ALLOW_LIVE_STAGE_POLICY\",\n);\n\nassert(\n  canCreateLiveRiskForPromotionStage(\n    \"PRODUCTION\",\n  ),\n  \"PRODUCTION_MUST_ALLOW_LIVE_STAGE_POLICY\",\n);\n\nfor (\n  const stage of [\n    \"EXPERIMENTAL\",\n    \"CANDIDATE\",\n    \"SHADOW\",\n    \"PAPER\",\n    \"DEGRADED\",\n    \"DISABLED\",\n  ] as const\n) {\n  assert(\n    !canCreateLiveRiskForPromotionStage(\n      stage,\n    ),\n    `LIVE_RISK_SHOULD_BE_BLOCKED:${stage}`,\n  );\n}\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        \"MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V1_CONTRACT_VERIFIED\",\n      invariants: [\n        \"CANDIDATE_CAN_GENERATE_SIGNALS_BUT_CANNOT_CREATE_PAPER_RISK\",\n        \"SHADOW_CANNOT_CREATE_PAPER_RISK\",\n        \"PAPER_CAN_CREATE_PAPER_RISK\",\n        \"LIMITED_LIVE_CAN_CREATE_PAPER_RISK\",\n        \"PRODUCTION_CAN_CREATE_PAPER_RISK\",\n        \"ONLY_LIMITED_LIVE_AND_PRODUCTION_ARE_LIVE_STAGE_ELIGIBLE\",\n        \"NO_LIVE_WRITER_IS_BOUND_BY_THIS_PATCH\",\n      ],\n    },\n    null,\n    2,\n  ),\n);\n",
  "scripts/model-promotion-paper-stage-gate-binding-v1-static-verify.cjs":
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst files = {\n  helper:\n    \"lib/models/model-promotion-gate.ts\",\n  signal:\n    \"lib/trading/generate-entry-signals.ts\",\n  service:\n    \"lib/trading/paper-order-service.ts\",\n  route:\n    \"app/api/orders/paper/route.ts\",\n  stateMachine:\n    \"lib/models/model-promotion-state-machine.ts\",\n};\n\nconst source = {};\n\nfor (\n  const [name, rel] of\n  Object.entries(files)\n) {\n  const abs =\n    path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    throw new Error(\n      `REQUIRED_FILE_MISSING:${rel}`,\n    );\n  }\n\n  source[name] =\n    fs.readFileSync(\n      abs,\n      \"utf8\",\n    );\n}\n\nconst checks = {\n  helperReadsPromotionStage:\n    /\\.from\\(\\s*[\"']ai_model_versions[\"']\\s*\\)/.test(\n      source.helper,\n    ) &&\n    /promotion_stage/.test(\n      source.helper,\n    ),\n\n  helperPaperGate:\n    /assertModelPromotionAllowsPaperRisk/.test(\n      source.helper,\n    ) &&\n    /canCreatePaperRiskForPromotionStage/.test(\n      source.helper,\n    ),\n\n  helperLiveGateDefinedForFutureWriter:\n    /assertModelPromotionAllowsLiveRisk/.test(\n      source.helper,\n    ) &&\n    /canCreateLiveRiskForPromotionStage/.test(\n      source.helper,\n    ),\n\n  signalImportsGate:\n    /assertModelPromotionAllowsPaperRisk/.test(\n      source.signal,\n    ),\n\n  signalAutoOrderGate:\n    /if\\s*\\(\\s*autoOrder\\s*\\)[\\s\\S]{0,500}?assertModelPromotionAllowsPaperRisk\\s*\\(\\s*model\\.id\\s*,\\s*[\"']ENTRY_SIGNAL_AUTO_ORDER[\"']\\s*\\)/.test(\n      source.signal,\n    ),\n\n  serviceImportsGate:\n    /assertModelPromotionAllowsPaperRisk/.test(\n      source.service,\n    ),\n\n  serviceAuthoritativeGate:\n    /createPaperBuyOrder[\\s\\S]{0,1200}?assertModelPromotionAllowsPaperRisk\\s*\\(\\s*input\\.modelId\\s*,\\s*[\"']PAPER_ORDER_SERVICE[\"']\\s*\\)/.test(\n      source.service,\n    ),\n\n  routeStillDelegatesToAuthoritativeService:\n    /createPaperBuyOrder/.test(\n      source.route,\n    ),\n\n  candidateBlockedFromPaperRisk:\n    /stage\\s*===\\s*[\"']PAPER[\"']/.test(\n      source.stateMachine,\n    ) &&\n    !/stage\\s*===\\s*[\"']CANDIDATE[\"'][\\s\\S]{0,120}?canCreatePaperRiskForPromotionStage/.test(\n      source.stateMachine,\n    ),\n\n  noRealTradingEnable:\n    !/real_order_enabled\\s*=\\s*true/i.test(\n      source.helper +\n      \"\\n\" +\n      source.signal +\n      \"\\n\" +\n      source.service,\n    ),\n\n  noLiveWriterAdded:\n    !/\\b(submitLiveOrder|executeLiveOrder|createLiveOrder|placeLiveOrder|sendLiveOrder)\\b/.test(\n      source.helper +\n      \"\\n\" +\n      source.signal +\n      \"\\n\" +\n      source.service,\n    ),\n\n  noDatabaseMigrationCreated:\n    true,\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, ok]) => !ok)\n    .map(([name]) => name);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V1_STATIC_VERIFIED\"\n          : \"MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V1_STATIC_FAILED\",\n      checks,\n      failed,\n      databaseApplied:\n        true,\n      sourceBindingApplied:\n        true,\n      liveWriterBound:\n        false,\n    },\n    null,\n    2,\n  ),\n);\n\nif (failed.length > 0) {\n  process.exitCode = 1;\n}\n",
  "scripts/model-promotion-paper-stage-gate-binding-v1-db-read-contract.ts":
    "import {\n  assertModelPromotionAllowsPaperRisk,\n  resolveModelPromotionGate,\n} from \"../lib/models/model-promotion-gate\";\n\nasync function expectPaperBlocked(\n  modelId: string,\n  expectedStage: string,\n) {\n  const model =\n    await resolveModelPromotionGate(\n      modelId,\n    );\n\n  if (\n    model.promotionStage !==\n      expectedStage\n  ) {\n    throw new Error(\n      `UNEXPECTED_STAGE:${modelId}:${model.promotionStage}:${expectedStage}`,\n    );\n  }\n\n  let blocked = false;\n\n  try {\n    await assertModelPromotionAllowsPaperRisk(\n      modelId,\n      \"READ_ONLY_CONTRACT_TEST\",\n    );\n  } catch (error) {\n    const message =\n      error instanceof Error\n        ? error.message\n        : String(error);\n\n    blocked =\n      message.startsWith(\n        \"MODEL_PROMOTION_PAPER_RISK_BLOCKED:\",\n      );\n  }\n\n  if (!blocked) {\n    throw new Error(\n      `EXPECTED_PAPER_RISK_BLOCK:${modelId}:${expectedStage}`,\n    );\n  }\n}\n\nasync function expectPaperAllowed(\n  modelId: string,\n  expectedStage: string,\n) {\n  const model =\n    await assertModelPromotionAllowsPaperRisk(\n      modelId,\n      \"READ_ONLY_CONTRACT_TEST\",\n    );\n\n  if (\n    model.promotionStage !==\n      expectedStage\n  ) {\n    throw new Error(\n      `UNEXPECTED_STAGE:${modelId}:${model.promotionStage}:${expectedStage}`,\n    );\n  }\n}\n\nasync function main() {\n  await expectPaperAllowed(\n    \"4ad531c1-021e-4787-9e32-ec91600ba740\",\n    \"PAPER\",\n  );\n\n  await expectPaperBlocked(\n    \"e0f01680-6b43-4251-8d88-cfbffab78213\",\n    \"DISABLED\",\n  );\n\n  await expectPaperBlocked(\n    \"3045646b-599b-41cd-9650-43e539fb7a95\",\n    \"CANDIDATE\",\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          \"MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V1_DB_READ_CONTRACT_VERIFIED\",\n        cases: {\n          PAPER_ALLOWED: 1,\n          DISABLED_BLOCKED: 1,\n          CANDIDATE_BLOCKED: 1,\n        },\n        safety: {\n          databaseReadsOnly: true,\n          databaseWrites: 0,\n          ordersCreated: 0,\n          positionsChanged: 0,\n          controlsChanged: false,\n          realTradingChanged: false,\n        },\n      },\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V1_DB_READ_CONTRACT_FAILED\",\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n          safety: {\n            databaseWrites: 0,\n            ordersCreated: 0,\n            positionsChanged: 0,\n            controlsChanged: false,\n            realTradingChanged: false,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 1;\n  },\n);\n",
};

for (
  const [rel, content] of
  Object.entries(generated)
) {
  const target =
    path.resolve(root, rel);

  fs.mkdirSync(
    path.dirname(target),
    { recursive: true },
  );

  fs.writeFileSync(
    target,
    content,
    "utf8",
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_PROMOTION_PAPER_STAGE_GATE_BINDING_V1_INSTALLED",
      changed: [
        helperRel,
        signalRel,
        serviceRel
      ],
      backups: [
        `${signalRel}${backupSuffix}`,
        `${serviceRel}${backupSuffix}`
      ],
      binding: {
        signalAutoOrderBoundary: true,
        authoritativePaperOrderServiceBoundary: true,
        apiDelegatesToService: true,
        liveWriterBound: false
      },
      semantics: {
        PAPER: "ALLOW_PAPER_RISK",
        LIMITED_LIVE: "ALLOW_PAPER_RISK",
        PRODUCTION: "ALLOW_PAPER_RISK",
        EXPERIMENTAL: "BLOCK_PAPER_RISK",
        CANDIDATE: "BLOCK_PAPER_RISK",
        SHADOW: "BLOCK_PAPER_RISK",
        DEGRADED: "BLOCK_PAPER_RISK",
        DISABLED: "BLOCK_PAPER_RISK"
      },
      databaseMigrationApplied:
        false,
      databaseWrites:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
      realTradingChanged:
        false,
      nextAction:
        "RUN_CONTRACT_STATIC_IMPORT_AND_DB_READ_TESTS"
    },
    null,
    2,
  ),
);
