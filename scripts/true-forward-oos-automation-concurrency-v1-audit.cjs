const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const targetRel =
  "lib/research/run-true-forward-oos-automation-binding-v1.ts";

const target = path.join(ROOT, targetRel);

function out(obj, error = false) {
  (error ? console.error : console.log)(
    JSON.stringify(obj, null, 2),
  );
}

if (!fs.existsSync(target)) {
  out({
    status:
      "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_CONCURRENCY_V1_AUDIT_FAILED",
    message: "TARGET_FILE_NOT_FOUND",
    target: targetRel,
  }, true);

  process.exitCode = 1;
  return;
}

const source =
  fs.readFileSync(target, "utf8");

const patterns = {
  lockFile:
    /lock.?file|LOCK_FILE|\.lock\b/i.test(source),

  exclusiveOpen:
    /openSync\s*\([^)]*["']wx["']/i.test(source) ||
    /flag[s]?\s*:\s*["']wx["']/i.test(source),

  atomicLockDirectory:
    /mkdirSync\s*\([^)]*(lock|LOCK)/i.test(source),

  staleLockRecovery:
    /stale.{0,80}lock|lock.{0,80}stale/i.test(source),

  lockCleanup:
    /unlinkSync|rmSync/.test(source) &&
    /lock/i.test(source),

  pidRecorded:
    /\bprocess\.pid\b/.test(source) &&
    /lock|owner|run/i.test(source),

  inProcessGuard:
    /\binFlight\b|\bisRunning\b|\brunningPromise\b|\bmutex\b|\bsemaphore\b/i.test(source),

  stateAtomicWrite:
    /AI_STOCK_LAB_ATOMIC_FORWARD_OOS_STATE_WRITE_V1/.test(source) &&
    /renameSync\s*\(/.test(source),

  completedIdempotency:
    /completed\.has\s*\(/.test(source),

  retryHardening:
    /AI_STOCK_LAB_RETRYABLE_FORWARD_OOS_FAILED_EXIT_V1/.test(source),
};

const concurrencyProtection =
  patterns.exclusiveOpen ||
  patterns.atomicLockDirectory ||
  patterns.inProcessGuard;

const gaps = [];

if (!concurrencyProtection) {
  gaps.push(
    "NO_EXPLICIT_CROSS_PROCESS_OR_IN_PROCESS_AUTOMATION_LOCK_DETECTED",
  );
}

if (
  (patterns.lockFile ||
    patterns.exclusiveOpen ||
    patterns.atomicLockDirectory) &&
  !patterns.staleLockRecovery
) {
  gaps.push(
    "LOCK_PRESENT_BUT_NO_EXPLICIT_STALE_LOCK_RECOVERY_DETECTED",
  );
}

if (
  (patterns.lockFile ||
    patterns.exclusiveOpen ||
    patterns.atomicLockDirectory) &&
  !patterns.lockCleanup
) {
  gaps.push(
    "LOCK_PRESENT_BUT_NO_EXPLICIT_LOCK_CLEANUP_DETECTED",
  );
}

const assessment =
  gaps.length === 0
    ? "CONCURRENCY_GUARD_BASELINE_PRESENT"
    : "READY_FOR_CONCURRENCY_HARDENING";

out({
  status:
    "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_CONCURRENCY_V1_AUDIT_COMPLETE",

  assessment,

  patterns,

  gaps,

  interpretation: {
    stateRecovery:
      patterns.stateAtomicWrite
        ? "ATOMIC_STATE_WRITE_PRESENT"
        : "ATOMIC_STATE_WRITE_NOT_DETECTED",

    stepIdempotency:
      patterns.completedIdempotency
        ? "COMPLETED_STEP_SUPPRESSION_PRESENT"
        : "COMPLETED_STEP_SUPPRESSION_NOT_DETECTED",

    retrySafety:
      patterns.retryHardening
        ? "EXPLICIT_RETRY_HARDENING_PRESENT"
        : "EXPLICIT_RETRY_HARDENING_NOT_DETECTED",

    concurrentInvocation:
      concurrencyProtection
        ? "GUARDED"
        : "POTENTIAL_DUPLICATE_EXECUTION_RISK",
  },

  safety: {
    readOnly: true,
    sourceFilesModified: 0,
    stateFilesWritten: 0,
    canonicalForwardFilesWritten: 0,
    subprocessesSpawnedByAudit: 0,
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingEnabled: false,
  },

  nextGate:
    concurrencyProtection
      ? "VERIFY_CONCURRENCY_CONTRACT"
      : "ADD_FAIL_CLOSED_SINGLE_RUN_LOCK_AND_SYNTHETIC_CONCURRENCY_CONTRACT",
});

process.exitCode = 0;
