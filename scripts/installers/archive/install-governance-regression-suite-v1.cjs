const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DIR = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const BACKUPS = path.join(DIR, "backups");
const RUNNER = path.join(DIR, "governance-regression-suite-v1.cjs");

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_GOVERNANCE_REGRESSION_SUITE_V1_INSTALL_FAILED",
    reason,
    ...extra
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(DIR)) fail("SCRIPTS_DIRECTORY_NOT_FOUND");
if (!fs.existsSync(PACKAGE)) fail("PACKAGE_JSON_NOT_FOUND");

fs.mkdirSync(BACKUPS, { recursive: true });

const backup = path.join(
  BACKUPS,
  "package.before-governance-regression-suite-v1.json"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(PACKAGE, backup);
}

const runnerSource = "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst { spawnSync } = require(\"child_process\");\n\nconst ROOT = process.cwd();\nconst DIR = path.join(ROOT, \"scripts\");\n\nconst TESTS = [\n  [\"PURPOSE_GATE\", [\"MODEL_ORDER_PURPOSE_GATE_REGRESSION_V1_VERIFIED\"], false, \"PASS\"],\n  [\"SHADOW_SIGNAL_READINESS\", [\"MODEL_SHADOW_REAL_SIGNAL_GENERATION_READINESS_AUDIT_V1_VERIFIED\"], false, \"PASS\"],\n  [\"CANONICAL_EVIDENCE_FAIL_CLOSED\", [\"MODEL_SHADOW_CANONICAL_EVIDENCE_FAIL_CLOSED_REGRESSION_V1_VERIFIED\"], false, \"PASS\"],\n  [\"SHADOW_TO_PAPER_RUNTIME_FAIL_CLOSED\", [\"MODEL_SHADOW_TO_PAPER_RUNTIME_FAIL_CLOSED_REGRESSION_V1_VERIFIED\"], true, \"PASS\"],\n  [\"RECOMMENDATION_RECORDING_SAFETY\", [\"MODEL_PROMOTION_RECOMMENDATION_RECORDING_SAFETY_AUDIT_V2_VERIFIED\"], true, \"PASS\"],\n  [\"PAPER_PROMOTION_APPLY_BOUNDARY\", [\"MODEL_PAPER_PROMOTION_APPLY_BOUNDARY_AUDIT_V1_VERIFIED\"], true, \"PASS\"],\n  [\"MANUAL_PAPER_APPLY_FAIL_CLOSED\", [\"MODEL_PROMOTION_MANUAL_PAPER_APPLY_FAIL_CLOSED_REGRESSION_V1_VERIFIED\"], true, \"PASS\"],\n  [\"MANUAL_EXPLICIT_CONFIRMATION\", [\"MODEL_PROMOTION_MANUAL_EXPLICIT_CONFIRMATION_REGRESSION_V1_VERIFIED\"], true, \"PASS\"],\n  [\"MANUAL_APPLY_ROUTE_DRY_RUN\", [\"MODEL_PROMOTION_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1_VERIFIED\"], true, \"PASS\"],\n  [\"MANUAL_PAPER_APPLY_TYPECHECK\", [\"MODEL_PROMOTION_MANUAL_PAPER_APPLY_TYPECHECK_V1_VERIFIED\"], true, \"PASS\"],\n  [\"REAL_SHADOW_CANONICAL_LIFECYCLE\", [\n    \"MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_WAITING_FOR_SIGNAL\",\n    \"MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_OBSERVING\",\n    \"MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_FIRST_OUTCOME_COMPLETED\",\n    \"MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_CAPTURE_GAP\",\n    \"MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_REVIEW_REQUIRED\",\n    \"MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_FAILED\"\n  ], true, \"LIFECYCLE\"]\n];\n\nfunction candidates() {\n  return fs.readdirSync(DIR, { withFileTypes: true })\n    .filter(e =>\n      e.isFile() &&\n      /\\.(ts|cjs)$/.test(e.name) &&\n      !e.name.startsWith(\"install-\") &&\n      e.name !== \"governance-regression-suite-v1.cjs\"\n    )\n    .map(e => ({ name: e.name, full: path.join(DIR, e.name) }));\n}\n\nconst files = candidates();\n\nfunction findScript(markers) {\n  const found = [];\n  for (const file of files) {\n    const text = fs.readFileSync(file.full, \"utf8\");\n    if (markers.some(m => text.includes(m))) found.push(file);\n  }\n  found.sort((a, b) => a.name.localeCompare(b.name));\n  return found[0] || null;\n}\n\nfunction runScript(file) {\n  const rel = path.relative(ROOT, file.full).replace(/\\\\/g, \"/\");\n  let command, args;\n\n  if (file.name.endsWith(\".cjs\")) {\n    command = process.execPath;\n    args = [rel];\n  } else {\n    const preferred = \"C:\\\\Program Files\\\\nodejs\\\\npx.cmd\";\n    command =\n      process.platform === \"win32\" && fs.existsSync(preferred)\n        ? preferred\n        : process.platform === \"win32\"\n          ? \"npx.cmd\"\n          : \"npx\";\n    args = [\"tsx\", \"--env-file=.env.local\", rel];\n  }\n\n  const r = spawnSync(command, args, {\n    cwd: ROOT,\n    encoding: \"utf8\",\n    shell: process.platform === \"win32\",\n    env: process.env,\n    maxBuffer: 16 * 1024 * 1024\n  });\n\n  return {\n    rel,\n    exitCode: typeof r.status === \"number\" ? r.status : 1,\n    stdout: r.stdout || \"\",\n    stderr: r.stderr || \"\",\n    spawnError: r.error ? String(r.error.message || r.error) : null\n  };\n}\n\nfunction lifecycleVerdict(text) {\n  if (text.includes(\"MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_WAITING_FOR_SIGNAL\"))\n    return [\"WAIT\", \"WAITING_FOR_SIGNAL\"];\n  if (text.includes(\"MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_OBSERVING\"))\n    return [\"WAIT\", \"CANONICAL_OUTCOME_MATURING\"];\n  if (text.includes(\"MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_FIRST_OUTCOME_COMPLETED\"))\n    return [\"PASS\", \"FIRST_OUTCOME_COMPLETED\"];\n  if (text.includes(\"MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_CAPTURE_GAP\"))\n    return [\"FAIL\", \"CAPTURE_GAP\"];\n  if (text.includes(\"MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_REVIEW_REQUIRED\"))\n    return [\"FAIL\", \"REVIEW_REQUIRED\"];\n  return [\"FAIL\", \"UNRECOGNIZED_LIFECYCLE_STATUS\"];\n}\n\nconst results = [];\n\nfor (const [id, markers, required, mode] of TESTS) {\n  const file = findScript(markers);\n\n  if (!file) {\n    results.push({\n      id,\n      verdict: required ? \"FAIL\" : \"SKIP\",\n      state: \"SCRIPT_NOT_FOUND\",\n      script: null,\n      exitCode: null\n    });\n    continue;\n  }\n\n  const run = runScript(file);\n  const text = run.stdout + \"\\n\" + run.stderr;\n  let verdict, state;\n\n  if (run.spawnError) {\n    verdict = \"FAIL\";\n    state = \"SPAWN_ERROR\";\n  } else if (mode === \"LIFECYCLE\") {\n    [verdict, state] = lifecycleVerdict(text);\n    if (run.exitCode !== 0 && verdict !== \"FAIL\") {\n      verdict = \"FAIL\";\n      state = \"NONZERO_EXIT\";\n    }\n  } else {\n    if (run.exitCode === 0 && text.includes(markers[0])) {\n      verdict = \"PASS\";\n      state = markers[0];\n    } else {\n      verdict = \"FAIL\";\n      state = run.exitCode !== 0\n        ? \"NONZERO_EXIT\"\n        : \"VERIFIED_MARKER_NOT_FOUND\";\n    }\n  }\n\n  results.push({\n    id,\n    verdict,\n    state,\n    script: run.rel,\n    exitCode: run.exitCode,\n    stdoutTail: run.stdout.trim().split(/\\r?\\n/).slice(-12),\n    stderrTail: run.stderr.trim().split(/\\r?\\n/).filter(Boolean).slice(-8),\n    spawnError: run.spawnError\n  });\n}\n\nconst summary = {\n  pass: results.filter(x => x.verdict === \"PASS\").length,\n  wait: results.filter(x => x.verdict === \"WAIT\").length,\n  skip: results.filter(x => x.verdict === \"SKIP\").length,\n  fail: results.filter(x => x.verdict === \"FAIL\").length\n};\nsummary.total = results.length;\nsummary.systemStatus = summary.fail === 0 ? \"SAFE\" : \"REVIEW_REQUIRED\";\n\nconst report = {\n  status:\n    summary.fail > 0\n      ? \"AI_STOCK_LAB_GOVERNANCE_REGRESSION_SUITE_V1_FAILED\"\n      : summary.wait > 0\n        ? \"AI_STOCK_LAB_GOVERNANCE_REGRESSION_SUITE_V1_SAFE_WAIT\"\n        : \"AI_STOCK_LAB_GOVERNANCE_REGRESSION_SUITE_V1_VERIFIED\",\n  summary,\n  results,\n  interpretation: {\n    waitIsFailure: false,\n    waitMeaning:\n      \"Real post-SHADOW evidence is not available or not mature yet.\",\n    skipMeaning:\n      \"Optional legacy regression script was not found.\"\n  },\n  safety: {\n    suiteIntroducesNoDatabaseWriteLogic: true,\n    excludesKnownIsolatedWriteCleanupPositivePath: true,\n    realTradingEnable: false\n  },\n  nextGate:\n    summary.fail > 0\n      ? \"FIX_FIRST_FAILED_GOVERNANCE_GATE_BEFORE_ADVANCING\"\n      : \"KEEP_SHADOW_AND_CONTINUE_INDEPENDENT_DEVELOPMENT\"\n};\n\nfs.mkdirSync(path.join(ROOT, \"logs\"), { recursive: true });\nfs.writeFileSync(\n  path.join(ROOT, \"logs\", \"governance-regression-suite-v1.json\"),\n  JSON.stringify(report, null, 2),\n  \"utf8\"\n);\n\nconsole.log(\"\\n=== AI STOCK LAB GOVERNANCE REGRESSION SUITE V1 ===\");\nfor (const item of results) {\n  const tag = `[${item.verdict}]`.padEnd(7);\n  console.log(tag, item.id, item.script ? `(${item.script})` : \"\");\n}\nconsole.log(\"----------------------------------------\");\nconsole.log(\n  `PASS: ${summary.pass} WAIT: ${summary.wait} SKIP: ${summary.skip} FAIL: ${summary.fail}`\n);\nconsole.log(`SYSTEM STATUS: ${summary.systemStatus}`);\nconsole.log(\"----------------------------------------\");\nconsole.log(JSON.stringify(report, null, 2));\n\nprocess.exitCode = summary.fail === 0 ? 0 : 1;\n";

try {
  new Function(
    "require",
    "__dirname",
    "__filename",
    "process",
    "console",
    runnerSource
  );
} catch (error) {
  fail("GENERATED_RUNNER_SYNTAX_ERROR", {
    error: error instanceof Error ? error.message : String(error)
  });
}

fs.writeFileSync(RUNNER, runnerSource, "utf8");

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
} catch (error) {
  fail("PACKAGE_JSON_PARSE_FAILED", {
    error: error instanceof Error ? error.message : String(error)
  });
}

if (!pkg.scripts || typeof pkg.scripts !== "object") pkg.scripts = {};
pkg.scripts["test:governance"] =
  "node ./scripts/governance-regression-suite-v1.cjs";

fs.writeFileSync(
  PACKAGE,
  JSON.stringify(pkg, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  status: "AI_STOCK_LAB_GOVERNANCE_REGRESSION_SUITE_V1_INSTALLED",
  generatedFile: "scripts/governance-regression-suite-v1.cjs",
  packageScript: "npm run test:governance",
  backup: "scripts/backups/package.before-governance-regression-suite-v1.json",
  behavior: {
    PASS: "gate verified",
    WAIT: "real-market evidence wait; not failure",
    SKIP: "optional legacy gate not found",
    FAIL: "required gate failed"
  },
  safety: {
    installerDatabaseWrites: 0,
    knownWriteCleanupPositivePathExcluded: true,
    realTradingEnable: false
  },
  nextAction: "RUN_NPM_GOVERNANCE_REGRESSION_SUITE"
}, null, 2));
