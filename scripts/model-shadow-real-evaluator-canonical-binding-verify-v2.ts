import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const FILES = {
  storage: "lib/models/model-shadow-outcome-storage.ts",
  binding: "lib/models/model-shadow-outcome-pipeline-binding.ts",
  evaluator: "lib/trading/evaluate-shadow-signals.ts",
  evaluateRoute: "app/api/signals/shadow/evaluate/route.ts",
  automationRoute: "app/api/trading/automation/run/route.ts",
};

function read(rel: string): string {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
}

function exportedNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /export\s+async\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)/g,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text))) names.add(m[1]);
  }
  return [...names];
}

function importsModule(text: string, moduleFragment: string): boolean {
  return text.includes(moduleFragment);
}

function callsAny(text: string, names: string[]): string[] {
  return names.filter((name) => {
    return text.includes(name + "(") || text.includes(name + " (");
  });
}

function linesMatching(text: string, patterns: RegExp[], limit = 80) {
  return text
    .split(/\r\n?/)
    .map((line, i) => ({ line: i + 1, text: line.trim() }))
    .filter((row) => patterns.some((p) => p.test(row.text)))
    .slice(0, limit);
}

const storage = read(FILES.storage);
const binding = read(FILES.binding);
const evaluator = read(FILES.evaluator);
const evaluateRoute = read(FILES.evaluateRoute);
const automationRoute = read(FILES.automationRoute);

const storageExports = exportedNames(storage);
const bindingExports = exportedNames(binding);

const canonicalStorageExports = storageExports.filter((name) =>
  /shadow|outcome|canonical/i.test(name)
);

const storageCallsFromBinding = callsAny(binding, canonicalStorageExports);
const bindingCallsFromEvaluator = callsAny(evaluator, bindingExports);
const bindingCallsFromRoute = callsAny(evaluateRoute, bindingExports);
const bindingCallsFromAutomation = callsAny(automationRoute, bindingExports);

const bindingImportedByEvaluator = importsModule(
  evaluator,
  "model-shadow-outcome-pipeline-binding",
);
const bindingImportedByRoute = importsModule(
  evaluateRoute,
  "model-shadow-outcome-pipeline-binding",
);
const bindingImportedByAutomation = importsModule(
  automationRoute,
  "model-shadow-outcome-pipeline-binding",
);

const evaluatorImportedByRoute = importsModule(
  evaluateRoute,
  "evaluate-shadow-signals",
);

const automationCallsShadowEvaluateRoute = automationRoute.includes(
  "/api/signals/shadow/evaluate",
);

const bindingMaps1d3d5d =
  /return_1d|return1d/i.test(binding) &&
  /return_3d|return3d/i.test(binding) &&
  /return_5d|return5d/i.test(binding);

const storageSupportsLifecycle =
  /PENDING/.test(storage) &&
  /COMPLETED/.test(storage);

const storageTouchesCanonicalTable =
  /model_shadow_signal_outcomes/.test(storage);

const evaluatorPersistsShadowTrack =
  /shadow_signal_tracks/.test(evaluator) &&
  /\.update\s*\(/.test(evaluator);

const bindingUsesCanonicalStorage =
  importsModule(binding, "model-shadow-outcome-storage") ||
  storageCallsFromBinding.length > 0;

const realEvaluatorPathUsesCanonicalBinding =
  bindingImportedByEvaluator ||
  bindingImportedByRoute ||
  bindingImportedByAutomation ||
  bindingCallsFromEvaluator.length > 0 ||
  bindingCallsFromRoute.length > 0 ||
  bindingCallsFromAutomation.length > 0;

const checks = {
  storageExists: storage.length > 0,
  bindingExists: binding.length > 0,
  evaluatorExists: evaluator.length > 0,
  evaluateRouteExists: evaluateRoute.length > 0,
  storageTouchesCanonicalTable,
  bindingUsesCanonicalStorage,
  bindingMaps1d3d5d,
  storageSupportsLifecycle,
  evaluatorPersistsShadowTrack,
  evaluateRouteCallsRealEvaluator: evaluatorImportedByRoute,
  realEvaluatorPathUsesCanonicalBinding,
  automationCallsShadowEvaluateRoute,
  noDatabaseReads: true,
  noDatabaseWrites: true,
  noOrdersCreated: true,
  noPositionsChanged: true,
  realTradingUnchanged: true,
};

const required = [
  "storageExists",
  "bindingExists",
  "evaluatorExists",
  "evaluateRouteExists",
  "storageTouchesCanonicalTable",
  "bindingUsesCanonicalStorage",
  "bindingMaps1d3d5d",
  "storageSupportsLifecycle",
  "evaluatorPersistsShadowTrack",
  "evaluateRouteCallsRealEvaluator",
  "realEvaluatorPathUsesCanonicalBinding",
  "automationCallsShadowEvaluateRoute",
] as const;

const failed = required.filter((key) => !checks[key]);

const report = {
  status:
    failed.length === 0
      ? "MODEL_SHADOW_REAL_EVALUATOR_CANONICAL_BINDING_V2_VERIFIED"
      : "MODEL_SHADOW_REAL_EVALUATOR_CANONICAL_BINDING_V2_NEEDS_REVIEW",
  files: FILES,
  storage: {
    exports: storageExports,
    canonicalStorageExports,
    lines: linesMatching(storage, [
      /model_shadow_signal_outcomes/,
      /PENDING/,
      /COMPLETED/,
      /return1d|return_1d/i,
      /return3d|return_3d/i,
      /return5d|return_5d/i,
    ]),
  },
  binding: {
    exports: bindingExports,
    storageCalls: storageCallsFromBinding,
    importedStorageModule: importsModule(binding, "model-shadow-outcome-storage"),
    lines: linesMatching(binding, [
      /model-shadow-outcome-storage/,
      /return1d|return_1d/i,
      /return3d|return_3d/i,
      /return5d|return_5d/i,
      /PENDING/,
      /COMPLETED/,
    ]),
  },
  realEvaluatorPath: {
    evaluatorImportedByRoute,
    bindingImportedByEvaluator,
    bindingImportedByRoute,
    bindingImportedByAutomation,
    bindingCallsFromEvaluator,
    bindingCallsFromRoute,
    bindingCallsFromAutomation,
    automationCallsShadowEvaluateRoute,
  },
  checks,
  failed,
  safety: {
    sourceFilesModified: 0,
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
      : "TRACE_EXACT_MISSING_REAL_EVALUATOR_CANONICAL_BINDING_EDGE",
};

fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "model-shadow-real-evaluator-canonical-binding-verify-v2.json",
  ),
  JSON.stringify(report, null, 2),
  "utf8",
);

console.log(JSON.stringify(report, null, 2));
process.exitCode = failed.length === 0 ? 0 : 1;
