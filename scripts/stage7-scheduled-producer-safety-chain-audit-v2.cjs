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

function lineHits(text, regex, max = 16) {
  const out = [];

  for (const [i, line] of text.split(/\r?\n/).entries()) {
    regex.lastIndex = 0;
    if (regex.test(line)) {
      out.push({
        line: i + 1,
        text: line.trim().slice(0, 240),
      });
      if (out.length >= max) break;
    }
  }

  return out;
}

function exactTrueAssignments(text, key) {
  const hits = [];
  const lines = text.split(/\r?\n/);

  const patterns = [
    new RegExp(
      "^\\s*" + key + "\\s*:\\s*[\"']true[\"']\\s*[,}]?",
      "i"
    ),
    new RegExp(
      "^\\s*" + key + "\\s*=\\s*[\"']true[\"']\\s*[;,]?",
      "i"
    ),
    new RegExp(
      "^\\s*process\\.env\\." + key +
      "\\s*=\\s*[\"']true[\"']\\s*;?",
      "i"
    ),
    new RegExp(
      "^\\s*process\\.env\\[[\"']" + key +
      "[\"']\\]\\s*=\\s*[\"']true[\"']\\s*;?",
      "i"
    ),
    new RegExp(
      "^\\s*\\$env:" + key +
      "\\s*=\\s*[\"']true[\"']\\s*$",
      "i"
    ),
  ];

  lines.forEach((line, index) => {
    if (patterns.some((re) => re.test(line))) {
      hits.push({
        line: index + 1,
        text: line.trim().slice(0, 240),
      });
    }
  });

  return hits;
}

function exactFalseBinding(text, key) {
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const sameLine = new RegExp(
      key + "\\s*:\\s*[\"']false[\"']",
      "i"
    );

    if (sameLine.test(line)) return true;

    const keyLine = new RegExp(
      "^\\s*" + key + "\\s*:\\s*$",
      "i"
    );

    if (keyLine.test(line)) {
      const next =
        (lines[i + 1] || "").trim();

      if (/^["']false["']\s*,?$/.test(next)) {
        return true;
      }
    }

    const procDot = new RegExp(
      "process\\.env\\." + key +
      "\\s*=\\s*[\"']false[\"']",
      "i"
    );

    const procBracket = new RegExp(
      "process\\.env\\[[\"']" + key +
      "[\"']\\]\\s*=\\s*[\"']false[\"']",
      "i"
    );

    const ps = new RegExp(
      "\\$env:" + key +
      "\\s*=\\s*[\"']false[\"']",
      "i"
    );

    if (
      procDot.test(line) ||
      procBracket.test(line) ||
      ps.test(line)
    ) {
      return true;
    }
  }

  return false;
}

function loadEnvSafety() {
  const full = path.join(ROOT, ".env.local");

  const keys = [
    "REAL_TRADING_ENABLED",
    "ENABLE_REAL_TRADING",
    "ENABLE_LIVE_TRADING",
  ];

  const values = Object.fromEntries(
    keys.map((key) => [key, null])
  );

  if (!fs.existsSync(full)) {
    return {
      exists: false,
      values,
      safe: true,
      enabledKeys: [],
    };
  }

  for (const raw of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    if (!keys.includes(key)) continue;

    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  const enabledKeys =
    keys.filter((key) =>
      ["1", "true", "yes", "on"].includes(
        String(values[key] ?? "").toLowerCase()
      )
    );

  return {
    exists: true,
    values,
    safe: enabledKeys.length === 0,
    enabledKeys,
  };
}

const runner =
  read("scripts/run-shadow-controlled-producer-0850.ps1");

const wrapper =
  read("scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts");

const controlled =
  read("scripts/true-forward-oos-controlled-normal-producer-v1.ts");

const binding =
  read("lib/research/run-true-forward-oos-automation-binding-v1.ts");

const producer =
  read("scripts/alpha-v3-true-forward-top1-producer-v1.ts");

const realKeys = [
  "REAL_TRADING_ENABLED",
  "ENABLE_REAL_TRADING",
  "ENABLE_LIVE_TRADING",
];

const envSafety = loadEnvSafety();

const runnerToWrapper =
  /true-forward-oos-controlled-producer-evidence-run-v1\.ts/i
    .test(runner.text);

const wrapperImportsControlled =
  /from\s+["'][^"']*true-forward-oos-controlled-normal-producer-v1["']/i
    .test(wrapper.text) ||
  /runControlledNormalProducerV1/i
    .test(wrapper.text);

const wrapperCallsControlled =
  /runControlledNormalProducerV1\s*\(/i
    .test(wrapper.text);

const controlledUsesAutomationBinding =
  /run-true-forward-oos-automation-binding-v1/i
    .test(controlled.text) ||
  /runTrueForwardOosAutomation/i
    .test(controlled.text) ||
  /runForwardOosAutomation/i
    .test(controlled.text);

const bindingMapsProduceToCanonical =
  /PRODUCE\s*:\s*[\r\n\s]*["']scripts\/alpha-v3-true-forward-top1-producer-v1\.ts["']/i
    .test(binding.text) ||
  (
    /PRODUCE\s*:/i.test(binding.text) &&
    /alpha-v3-true-forward-top1-producer-v1\.ts/i
      .test(binding.text)
  );

const indirectCanonicalChain =
  controlledUsesAutomationBinding &&
  bindingMapsProduceToCanonical;

const directCanonicalReference =
  /alpha-v3-true-forward-top1-producer-v1\.ts/i
    .test(controlled.text);

const canonicalProducerReachable =
  directCanonicalReference ||
  indirectCanonicalChain;

const wrapperFalseMap =
  Object.fromEntries(
    realKeys.map((key) => [
      key,
      exactFalseBinding(wrapper.text, key),
    ])
  );

const controlledFalseMap =
  Object.fromEntries(
    realKeys.map((key) => [
      key,
      exactFalseBinding(controlled.text, key),
    ])
  );

const allRuntimeSources = [
  ["runner", runner.text],
  ["wrapper", wrapper.text],
  ["controlled", controlled.text],
  ["binding", binding.text],
  ["producer", producer.text],
];

const unsafeAssignments =
  Object.fromEntries(
    realKeys.map((key) => {
      const hits = [];

      for (const [source, text] of allRuntimeSources) {
        for (const hit of exactTrueAssignments(text, key)) {
          hits.push({
            source,
            ...hit,
          });
        }
      }

      return [key, hits];
    })
  );

const noRuntimeSourceAssignsTrue =
  realKeys.every(
    (key) =>
      unsafeAssignments[key].length === 0
  );

const downstreamAllFlagsForcedFalse =
  realKeys.every(
    (key) =>
      wrapperFalseMap[key] ||
      controlledFalseMap[key]
  );

const controlledChecksRealTradeOff =
  /REAL_TRADING_MUST_REMAIN_DISABLED/i
    .test(controlled.text) &&
  realKeys.every(
    (key) =>
      new RegExp(key, "i").test(controlled.text)
  );

const controlledHasWindowGuard =
  /OUTSIDE_0845_0859_KST_WINDOW|08:45|0845/i
    .test(controlled.text) &&
  /08:59|0859|OUTSIDE_0845_0859_KST_WINDOW/i
    .test(controlled.text);

const controlledHasFeatureFlag =
  /FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED/i
    .test(controlled.text);

const controlledHasExactConfirmation =
  /RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER/i
    .test(controlled.text);

const provenanceContract =
  /evidenceRunId/i.test(wrapper.text) &&
  /FORWARD_OOS_PROVENANCE_RUN_ID/i.test(wrapper.text) &&
  (
    /candidateFingerprint/i.test(wrapper.text) ||
    /candidateFingerprint/i.test(producer.text)
  ) &&
  (
    /integrity/i.test(wrapper.text) ||
    /integrity/i.test(producer.text)
  );

const checks = {
  runnerExists: runner.exists,
  wrapperExists: wrapper.exists,
  controlledProducerExists: controlled.exists,
  automationBindingExists: binding.exists,
  canonicalProducerExists: producer.exists,

  runnerInvokesEvidenceWrapper:
    runnerToWrapper,

  wrapperImportsControlledProducer:
    wrapperImportsControlled,

  wrapperCallsControlledProducer:
    wrapperCallsControlled,

  canonicalProducerReachableDirectOrViaBinding:
    canonicalProducerReachable,

  automationBindingMapsProduceToCanonical:
    bindingMapsProduceToCanonical,

  controlledFeatureFlagPresent:
    controlledHasFeatureFlag,

  controlledExactConfirmationPresent:
    controlledHasExactConfirmation,

  controlledWindowGuardPresent:
    controlledHasWindowGuard,

  controlledRealTradingFailClosedGuardPresent:
    controlledChecksRealTradeOff,

  downstreamAllRealTradingFlagsForcedFalse:
    downstreamAllFlagsForcedFalse,

  noRuntimeSourceAssignsRealTradingTrue:
    noRuntimeSourceAssignsTrue,

  envDoesNotEnableRealTrading:
    envSafety.safe,

  provenanceContractPresent:
    provenanceContract,
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);

const classification =
  failed.length === 0
    ? "END_TO_END_SCHEDULED_CONTROLLED_PRODUCER_CHAIN_SAFE"
    : "SCHEDULED_CONTROLLED_PRODUCER_CHAIN_REVIEW_REQUIRED";

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_STAGE7_SCHEDULED_PRODUCER_SAFETY_CHAIN_AUDIT_V2_PASS"
      : "AI_STOCK_LAB_STAGE7_SCHEDULED_PRODUCER_SAFETY_CHAIN_AUDIT_V2_REVIEW",

  classification,

  checks,
  failed,

  executionChain: {
    runnerToWrapper,
    wrapperImportsControlled,
    wrapperCallsControlled,
    controlledUsesAutomationBinding,
    directCanonicalReference,
    bindingMapsProduceToCanonical,
    canonicalProducerReachable,

    expectedPath:
      directCanonicalReference
        ? "TASK -> RUNNER -> WRAPPER -> CONTROLLED -> CANONICAL PRODUCER"
        : "TASK -> RUNNER -> WRAPPER -> CONTROLLED -> AUTOMATION BINDING PRODUCE -> CANONICAL PRODUCER",
  },

  realTradingDefense: {
    wrapperFalseMap,
    controlledFalseMap,
    downstreamAllFlagsForcedFalse,
    controlledChecksRealTradeOff,
    unsafeAssignments,
    noRuntimeSourceAssignsTrue,
    envSafety,
  },

  evidenceDefense: {
    provenanceContract,
    controlledHasWindowGuard,
    controlledHasFeatureFlag,
    controlledHasExactConfirmation,
  },

  excerpts: {
    bindingProducerMap:
      lineHits(
        binding.text,
        /PRODUCE|alpha-v3-true-forward-top1-producer-v1/i
      ),

    wrapperSafety:
      lineHits(
        wrapper.text,
        /REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING|runControlledNormalProducerV1|evidenceRunId/i
      ),

    controlledSafety:
      lineHits(
        controlled.text,
        /REAL_TRADING_MUST_REMAIN_DISABLED|REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING|OUTSIDE_0845_0859_KST_WINDOW|RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER/i
      ),
  },

  safety: {
    readOnly: true,
    sourceFilesModified: 0,
    taskModified: false,
    producerExecuted: false,
    collectorExecuted: false,
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingChanged: false,
  },

  nextGate:
    failed.length === 0
      ? "ALLOW_NEXT_NATURAL_SCHEDULED_0850_CONTROLLED_RUN"
      : "FIX_ONLY_CONFIRMED_CHAIN_FAILURES_BEFORE_SCHEDULED_RUN",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
