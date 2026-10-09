const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();
const DIR = path.join(ROOT, "scripts");

const TESTS = [
  ["PURPOSE_GATE", ["MODEL_ORDER_PURPOSE_GATE_REGRESSION_V1_VERIFIED"], false, "PASS"],
  ["SHADOW_SIGNAL_READINESS", ["MODEL_SHADOW_REAL_SIGNAL_GENERATION_READINESS_AUDIT_V1_VERIFIED"], false, "PASS"],
  ["CANONICAL_EVIDENCE_FAIL_CLOSED", ["MODEL_SHADOW_CANONICAL_EVIDENCE_FAIL_CLOSED_REGRESSION_V1_VERIFIED"], false, "PASS"],
  ["SHADOW_TO_PAPER_RUNTIME_FAIL_CLOSED", ["MODEL_SHADOW_TO_PAPER_RUNTIME_FAIL_CLOSED_REGRESSION_V1_VERIFIED"], true, "PASS"],
  ["RECOMMENDATION_RECORDING_SAFETY", ["MODEL_PROMOTION_RECOMMENDATION_RECORDING_SAFETY_AUDIT_V2_VERIFIED"], true, "PASS"],
  ["PAPER_PROMOTION_APPLY_BOUNDARY", ["MODEL_PAPER_PROMOTION_APPLY_BOUNDARY_AUDIT_V1_VERIFIED"], true, "PASS"],
  ["MANUAL_PAPER_APPLY_FAIL_CLOSED", ["MODEL_PROMOTION_MANUAL_PAPER_APPLY_FAIL_CLOSED_REGRESSION_V1_VERIFIED"], true, "PASS"],
  ["MANUAL_EXPLICIT_CONFIRMATION", ["MODEL_PROMOTION_MANUAL_EXPLICIT_CONFIRMATION_REGRESSION_V1_VERIFIED"], true, "PASS"],
  ["MANUAL_APPLY_ROUTE_DRY_RUN", ["MODEL_PROMOTION_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1_VERIFIED"], true, "PASS"],
  ["MANUAL_PAPER_APPLY_TYPECHECK", ["MODEL_PROMOTION_MANUAL_PAPER_APPLY_TYPECHECK_V1_VERIFIED"], true, "PASS"],
  ["REAL_SHADOW_CANONICAL_LIFECYCLE", [
    "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_WAITING_FOR_SIGNAL",
    "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_OBSERVING",
    "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_FIRST_OUTCOME_COMPLETED",
    "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_CAPTURE_GAP",
    "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_REVIEW_REQUIRED",
    "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_FAILED"
  ], true, "LIFECYCLE"]
];

function candidates() {
  return fs.readdirSync(DIR, { withFileTypes: true })
    .filter(e =>
      e.isFile() &&
      /\.(ts|cjs)$/.test(e.name) &&
      !e.name.startsWith("install-") &&
      e.name !== "governance-regression-suite-v1.cjs"
    )
    .map(e => ({ name: e.name, full: path.join(DIR, e.name) }));
}

const files = candidates();

function findScript(markers) {
  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(file.full, "utf8");
    if (markers.some(m => text.includes(m))) found.push(file);
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found[0] || null;
}

function runScript(file) {
  const rel = path.relative(ROOT, file.full).replace(/\\/g, "/");
  let command, args;

  if (file.name.endsWith(".cjs")) {
    command = process.execPath;
    args = [rel];
  } else {
    const preferred = "C:\\Program Files\\nodejs\\npx.cmd";
    command =
      process.platform === "win32" && fs.existsSync(preferred)
        ? preferred
        : process.platform === "win32"
          ? "npx.cmd"
          : "npx";
    args = ["tsx", "--env-file=.env.local", rel];
  }

  const r = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });

  return {
    rel,
    exitCode: typeof r.status === "number" ? r.status : 1,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    spawnError: r.error ? String(r.error.message || r.error) : null
  };
}

function lifecycleVerdict(text) {
  if (text.includes("MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_WAITING_FOR_SIGNAL"))
    return ["WAIT", "WAITING_FOR_SIGNAL"];
  if (text.includes("MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_OBSERVING"))
    return ["WAIT", "CANONICAL_OUTCOME_MATURING"];
  if (text.includes("MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_FIRST_OUTCOME_COMPLETED"))
    return ["PASS", "FIRST_OUTCOME_COMPLETED"];
  if (text.includes("MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_CAPTURE_GAP"))
    return ["FAIL", "CAPTURE_GAP"];
  if (text.includes("MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_REVIEW_REQUIRED"))
    return ["FAIL", "REVIEW_REQUIRED"];
  return ["FAIL", "UNRECOGNIZED_LIFECYCLE_STATUS"];
}

const results = [];

for (const [id, markers, required, mode] of TESTS) {
  const file = findScript(markers);

  if (!file) {
    results.push({
      id,
      verdict: required ? "FAIL" : "SKIP",
      state: "SCRIPT_NOT_FOUND",
      script: null,
      exitCode: null
    });
    continue;
  }

  const run = runScript(file);
  const text = run.stdout + "\n" + run.stderr;
  let verdict, state;

  if (run.spawnError) {
    verdict = "FAIL";
    state = "SPAWN_ERROR";
  } else if (mode === "LIFECYCLE") {
    [verdict, state] = lifecycleVerdict(text);
    if (run.exitCode !== 0 && verdict !== "FAIL") {
      verdict = "FAIL";
      state = "NONZERO_EXIT";
    }
  } else {
    if (run.exitCode === 0 && text.includes(markers[0])) {
      verdict = "PASS";
      state = markers[0];
    } else {
      verdict = "FAIL";
      state = run.exitCode !== 0
        ? "NONZERO_EXIT"
        : "VERIFIED_MARKER_NOT_FOUND";
    }
  }

  results.push({
    id,
    verdict,
    state,
    script: run.rel,
    exitCode: run.exitCode,
    stdoutTail: run.stdout.trim().split(/\r?\n/).slice(-12),
    stderrTail: run.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-8),
    spawnError: run.spawnError
  });
}

const summary = {
  pass: results.filter(x => x.verdict === "PASS").length,
  wait: results.filter(x => x.verdict === "WAIT").length,
  skip: results.filter(x => x.verdict === "SKIP").length,
  fail: results.filter(x => x.verdict === "FAIL").length
};
summary.total = results.length;
summary.systemStatus = summary.fail === 0 ? "SAFE" : "REVIEW_REQUIRED";

const report = {
  status:
    summary.fail > 0
      ? "AI_STOCK_LAB_GOVERNANCE_REGRESSION_SUITE_V1_FAILED"
      : summary.wait > 0
        ? "AI_STOCK_LAB_GOVERNANCE_REGRESSION_SUITE_V1_SAFE_WAIT"
        : "AI_STOCK_LAB_GOVERNANCE_REGRESSION_SUITE_V1_VERIFIED",
  summary,
  results,
  interpretation: {
    waitIsFailure: false,
    waitMeaning:
      "Real post-SHADOW evidence is not available or not mature yet.",
    skipMeaning:
      "Optional legacy regression script was not found."
  },
  safety: {
    suiteIntroducesNoDatabaseWriteLogic: true,
    excludesKnownIsolatedWriteCleanupPositivePath: true,
    realTradingEnable: false
  },
  nextGate:
    summary.fail > 0
      ? "FIX_FIRST_FAILED_GOVERNANCE_GATE_BEFORE_ADVANCING"
      : "KEEP_SHADOW_AND_CONTINUE_INDEPENDENT_DEVELOPMENT"
};

fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, "logs", "governance-regression-suite-v1.json"),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log("\n=== AI STOCK LAB GOVERNANCE REGRESSION SUITE V1 ===");
for (const item of results) {
  const tag = `[${item.verdict}]`.padEnd(7);
  console.log(tag, item.id, item.script ? `(${item.script})` : "");
}
console.log("----------------------------------------");
console.log(
  `PASS: ${summary.pass} WAIT: ${summary.wait} SKIP: ${summary.skip} FAIL: ${summary.fail}`
);
console.log(`SYSTEM STATUS: ${summary.systemStatus}`);
console.log("----------------------------------------");
console.log(JSON.stringify(report, null, 2));

process.exitCode = summary.fail === 0 ? 0 : 1;
