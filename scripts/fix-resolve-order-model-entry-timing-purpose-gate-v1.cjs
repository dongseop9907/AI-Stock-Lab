const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "lib",
  "models",
  "resolve-order-model.ts"
);

const backup = path.join(
  process.cwd(),
  "lib",
  "models",
  "resolve-order-model.before-purpose-gate-v1.bak"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status: "FIX_RESOLVE_ORDER_MODEL_ENTRY_TIMING_PURPOSE_GATE_V1_FAILED",
    reason: "TARGET_NOT_FOUND",
    target
  }, null, 2));
  process.exit(1);
}

let source = fs.readFileSync(target, "utf8");

const marker = "MODEL_ORDER_PURPOSE_GATE_V1";

if (source.includes(marker)) {
  console.log(JSON.stringify({
    status: "FIX_RESOLVE_ORDER_MODEL_ENTRY_TIMING_PURPOSE_GATE_V1_ALREADY_APPLIED",
    file: "lib/models/resolve-order-model.ts",
    safety: {
      databaseWrites: 0,
      orderCreation: false,
      positionChange: false,
      promotionChange: false,
      controlsChange: false,
      realTradingEnable: false
    },
    nextAction: "RERUN_PURPOSE_GATE_REGRESSION"
  }, null, 2));
  process.exit(0);
}

if (!source.includes("createSupabaseServerClient")) {
  console.error(JSON.stringify({
    status: "FIX_RESOLVE_ORDER_MODEL_ENTRY_TIMING_PURPOSE_GATE_V1_FAILED",
    reason: "SUPABASE_CLIENT_IMPORT_NOT_FOUND"
  }, null, 2));
  process.exit(1);
}

const functionRegex =
  /(export\s+async\s+function\s+resolveOrderModel\s*\(\s*modelId\b[\s\S]*?\)\s*(?::\s*[^{]+)?\s*\{)/m;

const match = source.match(functionRegex);

if (!match) {
  console.error(JSON.stringify({
    status: "FIX_RESOLVE_ORDER_MODEL_ENTRY_TIMING_PURPOSE_GATE_V1_FAILED",
    reason: "RESOLVE_ORDER_MODEL_SIGNATURE_NOT_FOUND",
    safety: {
      sourceModified: false
    }
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

const gate = `

  /*
   * MODEL_ORDER_PURPOSE_GATE_V1
   * Only ENTRY_TIMING models may cross the order-model boundary.
   */
  const purposeGateSupabase =
    createSupabaseServerClient();

  const {
    data: purposeGateModel,
    error: purposeGateError,
  } =
    await purposeGateSupabase
      .from("ai_model_versions")
      .select("purpose")
      .eq("id", modelId)
      .maybeSingle();

  if (
    purposeGateError ||
    !purposeGateModel
  ) {
    throw new Error(
      \`ORDER_MODEL_PURPOSE_LOOKUP_FAILED:\${
        purposeGateError?.message ??
        "MODEL_NOT_FOUND"
      }\`,
    );
  }

  if (
    purposeGateModel.purpose !==
    "ENTRY_TIMING"
  ) {
    throw new Error(
      "ORDER_MODEL_PURPOSE_NOT_ENTRY_TIMING",
    );
  }
`;

source = source.replace(
  functionRegex,
  `${match[1]}${gate}`
);

fs.writeFileSync(target, source, "utf8");

console.log(JSON.stringify({
  status: "FIX_RESOLVE_ORDER_MODEL_ENTRY_TIMING_PURPOSE_GATE_V1_APPLIED",
  file: "lib/models/resolve-order-model.ts",
  backup: "lib/models/resolve-order-model.before-purpose-gate-v1.bak",
  invariant: "ONLY_ENTRY_TIMING_PURPOSE_CAN_RESOLVE_FOR_ORDER_PATH",
  safety: {
    databaseWrites: 0,
    orderCreation: false,
    positionChange: false,
    promotionChange: false,
    controlsChange: false,
    realTradingEnable: false
  },
  nextAction: "RERUN_PURPOSE_GATE_REGRESSION"
}, null, 2));
