const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function readText(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    return { file: rel, exists: false, text: null, mtime: null, size: null };
  }

  const stat = fs.statSync(file);
  return {
    file: rel,
    exists: true,
    text: fs.readFileSync(file, "utf8"),
    mtime: stat.mtime.toISOString(),
    size: stat.size,
  };
}

function readJson(rel) {
  const item = readText(rel);
  if (!item.exists) return { ...item, parsed: null, parseError: null };

  try {
    return { ...item, parsed: JSON.parse(item.text), parseError: null };
  } catch (error) {
    return {
      ...item,
      parsed: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function countSessions(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;

  for (const key of ["sessions", "data", "items", "rows"]) {
    if (Array.isArray(value[key])) return value[key].length;
  }

  return 0;
}

function countObservations(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;

  for (const key of ["observations", "data", "items", "rows"]) {
    if (Array.isArray(value[key])) return value[key].length;
  }

  if (value.counts && Number.isFinite(Number(value.counts.observations))) {
    return Number(value.counts.observations);
  }

  return 0;
}

function loadEnvFlags() {
  const rel = ".env.local";
  const file = path.join(ROOT, rel);
  const result = {
    file: rel,
    exists: fs.existsSync(file),
    REAL_TRADING_ENABLED: null,
    ENABLE_MANUAL_MODEL_PROMOTION_APPLY: null,
    probeLikeFlags: {},
  };

  if (!result.exists) return result;

  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();

    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    if (key === "REAL_TRADING_ENABLED") {
      result.REAL_TRADING_ENABLED = val;
    }

    if (key === "ENABLE_MANUAL_MODEL_PROMOTION_APPLY") {
      result.ENABLE_MANUAL_MODEL_PROMOTION_APPLY = val;
    }

    if (/PROBE|DRY_RUN|FORWARD_OOS/i.test(key)) {
      if (/KEY|SECRET|TOKEN|PASSWORD/i.test(key)) continue;
      result.probeLikeFlags[key] = val;
    }
  }

  return result;
}

function ledgerInfo(rel) {
  const item = readText(rel);

  if (!item.exists) {
    return {
      file: rel,
      exists: false,
      mtime: null,
      entries: 0,
      nonEmptyLines: 0,
      jsonParseFailures: 0,
    };
  }

  const lines = item.text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  let parseFailures = 0;

  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      parseFailures += 1;
    }
  }

  return {
    file: rel,
    exists: true,
    mtime: item.mtime,
    entries: lines.length - parseFailures,
    nonEmptyLines: lines.length,
    jsonParseFailures: parseFailures,
  };
}

function tail(text, n = 25) {
  if (!text) return [];
  return text.split(/\r?\n/).slice(-n);
}

const requiredFiles = [
  "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
  "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
  "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
  "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
  "scripts/forward-oos-data-quality-integrity-monitor-v1.ts",
  "scripts/model-shadow-canonical-lifecycle-watch-v1.ts",
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
  "lib/research/forward-oos-verified-provenance-ledger-v1.ts",
  "scripts/run-shadow-controlled-producer-0850.ps1",
];

const files = Object.fromEntries(
  requiredFiles.map((rel) => [rel, fs.existsSync(path.join(ROOT, rel))])
);

const canonical = readJson(
  "logs/alpha-v3-true-forward-top1-sessions-v1.json"
);

const evidence = readJson(
  "logs/true-forward-oos-controlled-producer-evidence-run-v1.json"
);

const observations = readJson(
  "logs/alpha-v3-entry-v3-forward-oos-observations.json"
);

const ledger = ledgerInfo(
  "logs/true-forward-oos-controlled-producer-evidence-ledger-v1.jsonl"
);

const shadowLog = readText(
  "logs/shadow-auto-0850-latest.txt"
);

const envFlags = loadEnvFlags();

const sessionCount = countSessions(canonical.parsed);
const observationCount = countObservations(observations.parsed);

const evidenceObj =
  evidence.parsed && typeof evidence.parsed === "object"
    ? evidence.parsed
    : {};

const evidenceMode =
  evidenceObj.mode ??
  evidenceObj.runMode ??
  evidenceObj.executionMode ??
  null;

const controlledMode =
  evidenceObj.controlledMode ??
  evidenceObj?.provenance?.mode ??
  null;

const deltaSessionCount =
  Number(
    evidenceObj.deltaSessionCount ??
    evidenceObj?.delta?.sessionCount ??
    evidenceObj?.delta?.newSessionCount ??
    NaN
  );

const missingRequiredFiles =
  Object.entries(files)
    .filter(([, exists]) => !exists)
    .map(([rel]) => rel);

const realTradingSafe =
  envFlags.REAL_TRADING_ENABLED == null ||
  !["1", "true", "yes", "on"].includes(
    String(envFlags.REAL_TRADING_ENABLED).toLowerCase()
  );

const promotionApplySafe =
  envFlags.ENABLE_MANUAL_MODEL_PROMOTION_APPLY == null ||
  !["1", "true", "yes", "on"].includes(
    String(envFlags.ENABLE_MANUAL_MODEL_PROMOTION_APPLY).toLowerCase()
  );

const canonicalParseSafe =
  !canonical.exists || canonical.parseError == null;

const evidenceParseSafe =
  !evidence.exists || evidence.parseError == null;

const observationParseSafe =
  !observations.exists || observations.parseError == null;

const ledgerParseSafe =
  ledger.jsonParseFailures === 0;

const controlledEvidencePresent =
  sessionCount > 0 &&
  ledger.entries > 0 &&
  String(evidenceMode || "").toUpperCase() === "NORMAL" &&
  Number.isFinite(deltaSessionCount) &&
  deltaSessionCount === 1;

let classification =
  "WAITING_FOR_FIRST_VERIFIED_CONTROLLED_NORMAL_SESSION";

let nextGate =
  "RUN_OR_WAIT_FOR_NEXT_SCHEDULED_CONTROLLED_NORMAL_PRODUCER";

if (controlledEvidencePresent && observationCount === 0) {
  classification =
    "VERIFIED_CONTROLLED_SESSION_PRESENT_WAITING_FOR_MATURITY_OBSERVATION";
  nextGate =
    "WAIT_FOR_1D_MATURITY_THEN_RUN_MATURITY_AWARE_COLLECTOR";
} else if (controlledEvidencePresent && observationCount > 0) {
  classification =
    "FORWARD_EVIDENCE_ACCUMULATION_IN_PROGRESS";
  nextGate =
    "CONTINUE_LONG_DURATION_FORWARD_OOS_AND_PAPER_EVIDENCE_ACCUMULATION";
}

const hardFailures = [];

if (missingRequiredFiles.length > 0) {
  hardFailures.push("REQUIRED_PIPELINE_FILES_MISSING");
}

if (!realTradingSafe) {
  hardFailures.push("REAL_TRADING_ENABLED");
}

if (!promotionApplySafe) {
  hardFailures.push("MANUAL_PROMOTION_APPLY_ENABLED");
}

if (!canonicalParseSafe) {
  hardFailures.push("CANONICAL_SESSION_JSON_PARSE_FAILED");
}

if (!evidenceParseSafe) {
  hardFailures.push("EVIDENCE_RUN_JSON_PARSE_FAILED");
}

if (!observationParseSafe) {
  hardFailures.push("OBSERVATION_JSON_PARSE_FAILED");
}

if (!ledgerParseSafe) {
  hardFailures.push("VERIFIED_PROVENANCE_LEDGER_PARSE_FAILED");
}

if (hardFailures.length > 0) {
  classification =
    "STAGE7_BASELINE_REVIEW_REQUIRED";
  nextGate =
    "FIX_BASELINE_HARD_FAILURES_BEFORE_CONTROLLED_NORMAL_EXECUTION";
}

console.log(JSON.stringify({
  status:
    hardFailures.length === 0
      ? "AI_STOCK_LAB_STAGE7_FORWARD_OOS_PAPER_BASELINE_AUDIT_V1_PASS"
      : "AI_STOCK_LAB_STAGE7_FORWARD_OOS_PAPER_BASELINE_AUDIT_V1_REVIEW",

  classification,

  pipeline: {
    requiredFiles: files,
    missingRequiredFiles,
  },

  evidence: {
    canonicalSessionFile: {
      file: canonical.file,
      exists: canonical.exists,
      mtime: canonical.mtime,
      parseError: canonical.parseError,
      sessionCount,
    },

    controlledProducerEvidence: {
      file: evidence.file,
      exists: evidence.exists,
      mtime: evidence.mtime,
      parseError: evidence.parseError,
      mode: evidenceMode,
      controlledMode,
      deltaSessionCount:
        Number.isFinite(deltaSessionCount)
          ? deltaSessionCount
          : null,
    },

    verifiedProvenanceLedger: ledger,

    observations: {
      file: observations.file,
      exists: observations.exists,
      mtime: observations.mtime,
      parseError: observations.parseError,
      observationCount,
    },

    controlledEvidencePresent,
  },

  scheduledShadow: {
    runnerFileExists:
      files["scripts/run-shadow-controlled-producer-0850.ps1"] === true,

    latestLog: {
      file: shadowLog.file,
      exists: shadowLog.exists,
      mtime: shadowLog.mtime,
      size: shadowLog.size,
      tail: tail(shadowLog.text, 25),
    },
  },

  environmentSafety: {
    envFileExists: envFlags.exists,
    realTradingEnabledValue:
      envFlags.REAL_TRADING_ENABLED,
    realTradingSafe,
    manualPromotionApplyValue:
      envFlags.ENABLE_MANUAL_MODEL_PROMOTION_APPLY,
    manualPromotionApplySafe: promotionApplySafe,
    nonSecretForwardFlags:
      envFlags.probeLikeFlags,
  },

  integrity: {
    canonicalSessionJsonReadable: canonicalParseSafe,
    evidenceRunJsonReadable: evidenceParseSafe,
    observationJsonReadable: observationParseSafe,
    verifiedLedgerJsonlReadable: ledgerParseSafe,
  },

  hardFailures,

  safety: {
    readOnly: true,
    networkRequests: 0,
    databaseReads: 0,
    databaseWrites: 0,
    producerExecuted: false,
    collectorExecuted: false,
    paperOrdersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingChanged: false,
  },

  nextGate,
}, null, 2));

process.exitCode =
  hardFailures.length === 0
    ? 0
    : 1;
