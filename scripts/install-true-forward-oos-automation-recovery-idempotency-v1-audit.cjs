const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const bindingRel =
  "lib/research/run-true-forward-oos-automation-binding-v1.ts";

const contractRel =
  "scripts/true-forward-oos-automation-binding-v1-contract-test.ts";

const auditRel =
  "scripts/true-forward-oos-automation-recovery-idempotency-v1-static-audit.cjs";

const binding = path.join(ROOT, bindingRel);
const contract = path.join(ROOT, contractRel);
const audit = path.join(ROOT, auditRel);

function fail(message, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_RECOVERY_IDEMPOTENCY_V1_INSTALL_FAILED",
    message,
    ...extra
  }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(binding)) {
  fail("BINDING_FILE_NOT_FOUND", { binding: bindingRel });
  return;
}

const auditSource = String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const bindingRel =
  "lib/research/run-true-forward-oos-automation-binding-v1.ts";

const contractRel =
  "scripts/true-forward-oos-automation-binding-v1-contract-test.ts";

const binding = path.join(ROOT, bindingRel);
const contract = path.join(ROOT, contractRel);

function read(rel) {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full)
    ? fs.readFileSync(full, "utf8")
    : "";
}

function contexts(source, regex, radius = 4) {
  const lines = source.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      regex.lastIndex = 0;

      out.push({
        aroundLine: i + 1,
        lines: lines
          .slice(
            Math.max(0, i - radius),
            Math.min(lines.length, i + radius + 1),
          )
          .map((text, offset) => ({
            line: Math.max(0, i - radius) + offset + 1,
            text,
          })),
      });
    } else {
      regex.lastIndex = 0;
    }
  }

  return out.slice(0, 12);
}

if (!fs.existsSync(binding)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_RECOVERY_IDEMPOTENCY_V1_STATIC_AUDIT_FAILED",
    failed: ["bindingExists"],
  }, null, 2));
  process.exitCode = 1;
  return;
}

const src = read(bindingRel);
const test = read(contractRel);

const facts = {
  bindingExists: src.length > 0,
  contractExists: test.length > 0,

  stateInterface:
    /interface\s+ForwardOosAutomationState/.test(src),

  completedState:
    /\bcompleted\s*:\s*ForwardOosAutomationStep\[\]/.test(src),

  blockedReasonState:
    /\bblockedReason\s*:\s*string\s*\|\s*null/.test(src),

  loadStateDependency:
    /\bloadState\??\s*:/.test(src),

  saveStateDependency:
    /\bsaveState\??\s*:/.test(src),

  persistentStateFile:
    /true-forward-oos-automation-binding-v1-state\.json/.test(src),

  failClosedExitCheck:
    /result\.exitCode\s*!==\s*0/.test(src),

  failurePersistsState:
    /persist\s*\(\s*reason\s*\)/.test(src),

  completedReadPresent:
    /\bcompleted\b/.test(src),

  completedMutationPresent:
    /\.completed\b[\s\S]{0,240}(push|concat|new Set)|completed[\s\S]{0,240}(push|concat|new Set)/.test(src),

  duplicateSuppressionCandidate:
    /completed[\s\S]{0,320}(includes|has)\s*\(/.test(src) ||
    /(includes|has)\s*\([\s\S]{0,120}completed/.test(src),

  stateDateBinding:
    /\bkstDate\b/.test(src),

  atomicWriteCandidate:
    /renameSync|rename\s*\(|\.tmp\b|temporary/i.test(src),

  contractHasFailureCase:
    /failedProduce|FAILED_CLOSED|FAILED_EXIT/.test(test),

  contractHasResumeCase:
    /resume|restart|retry|secondRun|second run|rerun/i.test(test),

  contractHasDuplicateSuppressionCase:
    /idempot|duplicate|already completed|skip completed|completed.*skip/i.test(test),
};

const hardRequired = [
  "bindingExists",
  "stateInterface",
  "completedState",
  "blockedReasonState",
  "loadStateDependency",
  "saveStateDependency",
  "persistentStateFile",
  "failClosedExitCheck",
  "failurePersistsState",
  "stateDateBinding",
];

const hardFailed =
  hardRequired.filter((key) => facts[key] !== true);

const gaps = [];

if (!facts.duplicateSuppressionCandidate) {
  gaps.push("NO_EXPLICIT_COMPLETED_STEP_DUPLICATE_SUPPRESSION_DETECTED");
}

if (!facts.contractHasResumeCase) {
  gaps.push("NO_EXPLICIT_FAILURE_RESUME_CONTRACT_DETECTED");
}

if (!facts.contractHasDuplicateSuppressionCase) {
  gaps.push("NO_EXPLICIT_IDEMPOTENCY_CONTRACT_DETECTED");
}

if (!facts.atomicWriteCandidate) {
  gaps.push("NO_ATOMIC_STATE_WRITE_PATTERN_DETECTED");
}

const status =
  hardFailed.length > 0
    ? "BLOCKED_AUTOMATION_RECOVERY_BASELINE_INCOMPLETE"
    : gaps.length > 0
      ? "READY_FOR_RECOVERY_IDEMPOTENCY_HARDENING"
      : "AUTOMATION_RECOVERY_IDEMPOTENCY_BASELINE_PRESENT";

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_RECOVERY_IDEMPOTENCY_V1_STATIC_AUDIT_COMPLETE",

  assessment: status,

  facts,
  hardFailed,
  gaps,

  context: {
    completed:
      contexts(src, /\bcompleted\b/, 3),

    persist:
      contexts(src, /\bpersist\s*\(/, 4),

    stateIo:
      contexts(src, /\b(loadState|saveState|defaultLoadState|defaultSaveState)\b/, 3),
  },

  safety: {
    readOnly: true,
    sourceFilesModified: 0,
    canonicalForwardFilesWritten: 0,
    stateFilesWritten: 0,
    producerExecuted: false,
    collectorExecuted: false,
    evaluatorExecuted: false,
    summaryExecuted: false,
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingEnabled: false,
  },

  nextGate:
    hardFailed.length > 0
      ? "REPAIR_AUTOMATION_BASELINE_FIRST"
      : gaps.length > 0
        ? "ADD_SYNTHETIC_RECOVERY_IDEMPOTENCY_CONTRACT"
        : "RUN_EXISTING_RECOVERY_IDEMPOTENCY_CONTRACTS",
}, null, 2));

process.exitCode =
  hardFailed.length === 0
    ? 0
    : 1;
`;

fs.mkdirSync(path.dirname(audit), {
  recursive: true,
});

fs.writeFileSync(
  audit,
  auditSource,
  "utf8",
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_RECOVERY_IDEMPOTENCY_V1_AUDIT_INSTALLED",

  generatedFile: auditRel,

  inspectedTargets: [
    bindingRel,
    contractRel,
  ],

  purpose: [
    "CHECK_COMPLETED_STEP_DUPLICATE_SUPPRESSION",
    "CHECK_FAILURE_STATE_PERSISTENCE",
    "CHECK_RESTART_RECOVERY_CONTRACT",
    "CHECK_STATE_WRITE_SAFETY",
  ],

  productSourceChanges: 0,

  safety: {
    runtimeAutomationExecuted: false,
    canonicalForwardFilesWritten: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingEnabled: false,
  },

  nextAction:
    "RUN_STATIC_RECOVERY_IDEMPOTENCY_AUDIT",
}, null, 2));
