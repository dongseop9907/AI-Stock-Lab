const fs = require("fs");
const path = require("path");

const out = path.join(
  process.cwd(),
  "scripts",
  "model-shadow-real-evaluator-canonical-binding-verify-v1.ts"
);

const source = String.raw`
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const FILES = {
  storage:
    "lib/models/model-shadow-outcome-storage.ts",

  binding:
    "lib/models/model-shadow-outcome-pipeline-binding.ts",

  evaluator:
    "lib/trading/evaluate-shadow-signals.ts",

  evaluateRoute:
    "app/api/signals/shadow/evaluate/route.ts",

  automationRoute:
    "app/api/trading/automation/run/route.ts",
};

function read(relativePath: string): string {
  const full = path.join(
    ROOT,
    relativePath,
  );

  if (!fs.existsSync(full)) {
    return "";
  }

  return fs.readFileSync(
    full,
    "utf8",
  );
}

function exportedFunctions(
  text: string,
): string[] {
  const names = new Set<string>();

  const patterns = [
    /export\s+async\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;

    while (
      (match = pattern.exec(text))
    ) {
      names.add(match[1]);
    }
  }

  return [...names];
}

function matchingLines(
  text: string,
  patterns: RegExp[],
) {
  return text
    .split(/\r?\n/)
    .map((value, index) => ({
      line: index + 1,
      text: value.trim(),
    }))
    .filter(({ text }) =>
      patterns.some(
        (pattern) =>
          pattern.test(text),
      ),
    )
    .slice(0, 80);
}

function called(
  text: string,
  name: string,
): boolean {
  const escaped =
    name.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

  return new RegExp(
    "\\b" +
      escaped +
      "\\s*\\(",
  ).test(text);
}

const storage =
  read(FILES.storage);

const binding =
  read(FILES.binding);

const evaluator =
  read(FILES.evaluator);

const evaluateRoute =
  read(FILES.evaluateRoute);

const automationRoute =
  read(FILES.automationRoute);

const storageExports =
  exportedFunctions(storage);

const bindingExports =
  exportedFunctions(binding);

const canonicalMutationExports =
  storageExports.filter(
    (name) =>
      /shadow|outcome|canonical/i.test(
        name,
      ) &&
      /update|patch|sync|complete|apply|evaluation|seed/i.test(
        name,
      ),
  );

const storageCallsFromBinding =
  canonicalMutationExports.filter(
    (name) =>
      called(
        binding,
        name,
      ),
  );

const bindingCallsFromEvaluator =
  bindingExports.filter(
    (name) =>
      called(
        evaluator,
        name,
      ),
  );

const bindingCallsFromRoute =
  bindingExports.filter(
    (name) =>
      called(
        evaluateRoute,
        name,
      ),
  );

const bindingCallsFromAutomation =
  bindingExports.filter(
    (name) =>
      called(
        automationRoute,
        name,
      ),
  );

const bindingImportedByEvaluator =
  evaluator.includes(
    "model-shadow-outcome-pipeline-binding",
  );

const bindingImportedByRoute =
  evaluateRoute.includes(
    "model-shadow-outcome-pipeline-binding",
  );

const bindingImportedByAutomation =
  automationRoute.includes(
    "model-shadow-outcome-pipeline-binding",
  );

const evaluatorImportedByRoute =
  evaluateRoute.includes(
    "evaluate-shadow-signals",
  );

const automationCallsEvaluateRoute =
  automationRoute.includes(
    "/api/signals/shadow/evaluate",
  );

const bindingHasReturnMapping =
  /return_1d|return1d/i.test(
    binding,
  ) &&
  /return_3d|return3d/i.test(
    binding,
  ) &&
  /return_5d|return5d/i.test(
    binding,
  );

const storageHasLifecycle =
  /PENDING/.test(storage) &&
  /COMPLETED/.test(storage);

const evaluatorHasPersistence =
  evaluator.includes(
    "shadow_signal_tracks",
  ) &&
  /\.update\s*\(/.test(
    evaluator,
  );

const bindingUsesStorage =
  storageCallsFromBinding.length > 0 ||
  binding.includes(
    "model-shadow-outcome-storage",
  );

const realEvaluatorPathUsesBinding =
  bindingImportedByEvaluator ||
  bindingImportedByRoute ||
  bindingImportedByAutomation ||
  bindingCallsFromEvaluator.length > 0 ||
  bindingCallsFromRoute.length > 0 ||
  bindingCallsFromAutomation.length > 0;

const checks = {
  storageExists:
    storage.length > 0,

  bindingExists:
    binding.length > 0,

  evaluatorExists:
    evaluator.length > 0,

  evaluateRouteExists:
    evaluateRoute.length > 0,

  canonicalMutationExportFound:
    canonicalMutationExports.length > 0,

  bindingUsesCanonicalStorage:
    bindingUsesStorage,

  bindingMaps1d3d5d:
    bindingHasReturnMapping,

  storageSupportsPendingCompleted:
    storageHasLifecycle,

  evaluatorPersistsShadowTrack:
    evaluatorHasPersistence,

  evaluateRouteCallsRealEvaluator:
    evaluatorImportedByRoute,

  realEvaluatorPathUsesCanonicalBinding:
    realEvaluatorPathUsesBinding,

  automationCallsShadowEvaluateRoute:
    automationCallsEvaluateRoute,

  noDatabaseWrites:
    true,

  noOrdersCreated:
    true,

  noPositionsChanged:
    true,

  realTradingUnchanged:
    true,
};

const required = [
  "storageExists",
  "bindingExists",
  "evaluatorExists",
  "evaluateRouteExists",
  "canonicalMutationExportFound",
  "bindingUsesCanonicalStorage",
  "bindingMaps1d3d5d",
  "storageSupportsPendingCompleted",
  "evaluatorPersistsShadowTrack",
  "evaluateRouteCallsRealEvaluator",
  "realEvaluatorPathUsesCanonicalBinding",
  "automationCallsShadowEvaluateRoute",
];

const failed =
  required.filter(
    (key) =>
      !checks[
        key as keyof typeof checks
      ],
  );

const report = {
  status:
    failed.length === 0
      ? "MODEL_SHADOW_REAL_EVALUATOR_CANONICAL_BINDING_V1_VERIFIED"
      : "MODEL_SHADOW_REAL_EVALUATOR_CANONICAL_BINDING_V1_NEEDS_REVIEW",

  files: FILES,

  storage: {
    exports:
      storageExports,

    canonicalMutationExports,

    lifecycleLines:
      matchingLines(
        storage,
        [
          /PENDING/,
          /COMPLETED/,
          /model_shadow_signal_outcomes/,
          /return1d|return_1d/i,
          /return3d|return_3d/i,
          /return5d|return_5d/i,
        ],
      ),
  },

  binding: {
    exports:
      bindingExports,

    storageCalls:
      storageCallsFromBinding,

    returnMapping:
      bindingHasReturnMapping,

    lines:
      matchingLines(
        binding,
        [
          /model-shadow-outcome-storage/,
          /return1d|return_1d/i,
          /return3d|return_3d/i,
          /return5d|return_5d/i,
          /PENDING/,
          /COMPLETED/,
        ],
      ),
  },

  realEvaluatorPath: {
    evaluatorImportedByRoute,
    bindingImportedByEvaluator,
    bindingImportedByRoute,
    bindingImportedByAutomation,

    bindingCallsFromEvaluator,
    bindingCallsFromRoute,
    bindingCallsFromAutomation,

    automationCallsEvaluateRoute,
  },

  checks,

  failed,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionChange: false,
    controlsChange: false,
    realTradingChanged: false,
  },

  nextGate:
    failed.length === 0
      ? "VERIFY_CANONICAL_SHADOW_EVIDENCE_READER_AND_SHADOW_TO_PAPER_FAIL_CLOSED"
      : "PATCH_EXACT_REAL_EVALUATOR_TO_CANONICAL_BINDING_GAP",
};

fs.mkdirSync(
  path.join(
    ROOT,
    "logs",
  ),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "model-shadow-real-evaluator-canonical-binding-verify-v1.json",
  ),
  JSON.stringify(
    report,
    null,
    2,
  ),
  "utf8",
);

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
`;

fs.writeFileSync(
  out,
  source,
  "utf8",
);

console.log(JSON.stringify({
  status:
    "MODEL_SHADOW_REAL_EVALUATOR_CANONICAL_BINDING_VERIFY_V1_INSTALLED",

  generatedFile:
    "scripts/model-shadow-real-evaluator-canonical-binding-verify-v1.ts",

  mode:
    "READ_ONLY_REAL_EVALUATOR_BINDING_VERIFY",

  safety: {
    databaseWrites: 0,
    orderCreation: false,
    positionChange: false,
    promotionChange: false,
    controlsChange: false,
    realTradingEnable: false
  },

  nextAction:
    "RUN_CANONICAL_BINDING_VERIFY"
}, null, 2));
