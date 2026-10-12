const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function read(rel) {
  const full = path.join(ROOT, rel);

  if (!fs.existsSync(full)) {
    return { rel, full, exists: false, text: "" };
  }

  return {
    rel,
    full,
    exists: true,
    text: fs.readFileSync(full, "utf8"),
  };
}

function lineHits(text, regex, max = 12) {
  const out = [];

  text.split(/\r?\n/).forEach((line, index) => {
    if (regex.test(line)) {
      out.push({
        line: index + 1,
        text: line.trim().slice(0, 220),
      });
    }
    regex.lastIndex = 0;
  });

  return out.slice(0, max);
}

function keyForcedFalse(text, key) {
  const escaped = key;

  const patterns = [
    new RegExp(
      escaped + "[\\s\\S]{0,160}(?:=|:)\\s*[\\\"']false[\\\"']",
      "i"
    ),
    new RegExp(
      "(?:=|:)\\s*[\\\"']false[\\\"'][\\s\\S]{0,160}" + escaped,
      "i"
    ),
    new RegExp(
      "process\\.env\\[['\\\"]?" +
        escaped +
        "['\\\"]?\\]\\s*=\\s*[\\\"']false[\\\"']",
      "i"
    ),
    new RegExp(
      "process\\.env\\." +
        escaped +
        "\\s*=\\s*[\\\"']false[\\\"']",
      "i"
    ),
  ];

  return patterns.some((re) => re.test(text));
}

function keyForcedTrue(text, key) {
  const escaped = key;

  const patterns = [
    new RegExp(
      escaped + "[\\s\\S]{0,160}(?:=|:)\\s*[\\\"']true[\\\"']",
      "i"
    ),
    new RegExp(
      "process\\.env\\[['\\\"]?" +
        escaped +
        "['\\\"]?\\]\\s*=\\s*[\\\"']true[\\\"']",
      "i"
    ),
    new RegExp(
      "process\\.env\\." +
        escaped +
        "\\s*=\\s*[\\\"']true[\\\"']",
      "i"
    ),
  ];

  return patterns.some((re) => re.test(text));
}

function loadEnvSafety() {
  const rel = ".env.local";
  const full = path.join(ROOT, rel);

  const keys = [
    "REAL_TRADING_ENABLED",
    "ENABLE_REAL_TRADING",
    "ENABLE_LIVE_TRADING",
  ];

  const result = {
    exists: fs.existsSync(full),
    values: {},
    safe: true,
  };

  for (const key of keys) {
    result.values[key] = null;
  }

  if (!result.exists) return result;

  for (const raw of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith("#")) continue;

    const i = line.indexOf("=");

    if (i <= 0) continue;

    const key = line.slice(0, i).trim();

    if (!keys.includes(key)) continue;

    let val = line.slice(i + 1).trim();

    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    result.values[key] = val;

    if (
      ["1", "true", "yes", "on"].includes(
        String(val).toLowerCase()
      )
    ) {
      result.safe = false;
    }
  }

  return result;
}

const runner =
  read("scripts/run-shadow-controlled-producer-0850.ps1");

const wrapper =
  read("scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts");

const controlled =
  read("scripts/true-forward-oos-controlled-normal-producer-v1.ts");

const producer =
  read("scripts/alpha-v3-true-forward-top1-producer-v1.ts");

const automationBinding =
  read("lib/research/run-true-forward-oos-automation-binding-v1.ts");

const envSafety = loadEnvSafety();

const realKeys = [
  "REAL_TRADING_ENABLED",
  "ENABLE_REAL_TRADING",
  "ENABLE_LIVE_TRADING",
];

const allExecutionSource =
  [
    runner.text,
    wrapper.text,
    controlled.text,
    producer.text,
    automationBinding.text,
  ].join("\n");

const controlledForceMap =
  Object.fromEntries(
    realKeys.map((key) => [
      key,
      keyForcedFalse(controlled.text, key),
    ])
  );

const wrapperForceMap =
  Object.fromEntries(
    realKeys.map((key) => [
      key,
      keyForcedFalse(wrapper.text, key),
    ])
  );

const anyUnsafeTrueMap =
  Object.fromEntries(
    realKeys.map((key) => [
      key,
      keyForcedTrue(allExecutionSource, key),
    ])
  );

const runnerHasWrapper =
  /true-forward-oos-controlled-producer-evidence-run-v1/i
    .test(runner.text);

const wrapperHasControlledProducer =
  /true-forward-oos-controlled-normal-producer-v1/i
    .test(wrapper.text);

const controlledHasCanonicalProducer =
  /alpha-v3-true-forward-top1-producer-v1/i
    .test(controlled.text);

const controlledFeatureFlag =
  /FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED/i
    .test(controlled.text);

const controlledExactConfirmation =
  /RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER/i
    .test(controlled.text);

const controlledWindowGuard =
  /08:45|0845|08:59|0859|OUTSIDE_0845_0859_KST_WINDOW/i
    .test(controlled.text);

const runnerDirectRealTradeGuard =
  realKeys.some(
    (key) => keyForcedFalse(runner.text, key)
  );

const downstreamAllRealTradeFlagsForcedOff =
  realKeys.every(
    (key) =>
      controlledForceMap[key] === true ||
      wrapperForceMap[key] === true
  );

const noRealTradeTrueAssignment =
  realKeys.every(
    (key) => anyUnsafeTrueMap[key] === false
  );

const evidenceProvenancePresent =
  /evidenceRunId/i.test(wrapper.text) &&
  /candidateFingerprint|integrity/i.test(
    wrapper.text + "\n" + producer.text
  );

const checks = {
  runnerExists: runner.exists,
  wrapperExists: wrapper.exists,
  controlledProducerExists: controlled.exists,
  canonicalProducerExists: producer.exists,
  automationBindingExists: automationBinding.exists,
  runnerInvokesEvidenceWrapper: runnerHasWrapper,
  evidenceWrapperReferencesControlledProducer: wrapperHasControlledProducer,
  controlledProducerReferencesCanonicalProducer: controlledHasCanonicalProducer,
  controlledProducerFeatureFlagPresent: controlledFeatureFlag,
  controlledProducerExactConfirmationPresent: controlledExactConfirmation,
  controlledWindowGuardPresent: controlledWindowGuard,
  downstreamAllRealTradingFlagsForcedOff: downstreamAllRealTradeFlagsForcedOff,
  noExecutionSourceForcesRealTradingTrue: noRealTradeTrueAssignment,
  envDoesNotEnableRealTrading: envSafety.safe,
  evidenceProvenanceContractPresent: evidenceProvenancePresent,
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([key]) => key);

const classification =
  failed.length === 0
    ? (
        runnerDirectRealTradeGuard
          ? "END_TO_END_SAFE_WITH_DEFENSE_IN_DEPTH_RUNNER_GUARD"
          : "END_TO_END_SAFE_WITH_DOWNSTREAM_FAIL_CLOSED_REAL_TRADING_GUARD"
      )
    : "SCHEDULED_PRODUCER_SAFETY_CHAIN_REVIEW_REQUIRED";

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_STAGE7_SCHEDULED_PRODUCER_SAFETY_CHAIN_AUDIT_V1_PASS"
      : "AI_STOCK_LAB_STAGE7_SCHEDULED_PRODUCER_SAFETY_CHAIN_AUDIT_V1_REVIEW",

  classification,

  chain: [
    "Windows Scheduled Task",
    "scripts/run-shadow-controlled-producer-0850.ps1",
    "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
    "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  ],

  checks,
  failed,

  realTradingDefense: {
    runnerDirectRealTradeGuard,
    informationalInterpretation:
      runnerDirectRealTradeGuard
        ? "Runner itself also forces a real-trading flag false."
        : "Runner has no direct real-trading flag assignment; downstream controlled execution boundary must force all real-trading flags off.",

    controlledProducerForceMap: controlledForceMap,
    wrapperForceMap,
    anyUnsafeTrueMap,

    downstreamAllRealTradeFlagsForcedOff,
    noRealTradeTrueAssignment,

    env: envSafety,
  },

  evidenceContract: {
    runnerHasWrapper,
    wrapperHasControlledProducer,
    controlledHasCanonicalProducer,
    evidenceProvenancePresent,
  },

  excerpts: {
    runner:
      lineHits(
        runner.text,
        /controlled|evidence|tsx|node|real.trading/i
      ),

    wrapper:
      lineHits(
        wrapper.text,
        /controlled|evidenceRunId|REAL_TRADING|ENABLE_REAL|ENABLE_LIVE/i
      ),

    controlledProducer:
      lineHits(
        controlled.text,
        /FORWARD_OOS_CONTROLLED|RUN_TRUE_FORWARD|REAL_TRADING|ENABLE_REAL|ENABLE_LIVE|0845|0859/i
      ),
  },

  safety: {
    readOnly: true,
    producerExecuted: false,
    collectorExecuted: false,
    networkRequests: 0,
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingChanged: false,
  },

  nextGate:
    failed.length === 0
      ? "SCHEDULED_TASK_DEFINITION_FINAL_REVIEW_THEN_ALLOW_NEXT_NATURAL_0850_RUN"
      : "REPAIR_SAFETY_CHAIN_BEFORE_NEXT_SCHEDULED_RUN",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
