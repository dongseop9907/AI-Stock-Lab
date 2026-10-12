import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  CONTROLLED_NORMAL_PRODUCER_CONFIRM,
  runControlledNormalProducerV1,
} from "./true-forward-oos-controlled-normal-producer-v1";

const ROOT =
  process.cwd();

const FORWARD_FILE_CANDIDATES = [
  "logs/alpha-v3-true-forward-oos.json",
  "logs/alpha-v3-true-forward-oos-v1.json",
  "logs/alpha-v3-true-forward-top1-sessions-v1.json",
];

function hashText(
  text: string,
) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function findForwardFile() {
  for (
    const rel of FORWARD_FILE_CANDIDATES
  ) {
    const abs =
      path.join(
        ROOT,
        rel,
      );

    if (
      fs.existsSync(abs)
    ) {
      return {
        rel,
        abs,
      };
    }
  }

  return null;
}

function loadForwardSnapshot() {
  const file =
    findForwardFile();

  if (!file) {
    return {
      exists: false,
      file: null,
      hash: null,
      sessionCount: 0,
      sessions: [] as any[],
    };
  }

  const text =
    fs.readFileSync(
      file.abs,
      "utf8",
    );

  let parsed: any =
    null;

  try {
    parsed =
      JSON.parse(text);
  } catch {
    parsed =
      null;
  }

  const sessions =
    Array.isArray(
      parsed?.sessions,
    )
      ? parsed.sessions
      : [];

  return {
    exists: true,
    file:
      file.rel,
    hash:
      hashText(text),
    sessionCount:
      sessions.length,
    sessions,
  };
}

function sessionKey(
  row: any,
) {
  return [
    row?.sourceTradingDate ?? "",
    row?.targetSessionDate ?? "",
  ].join("|");
}

function diffSessions(
  before: any[],
  after: any[],
) {
  const beforeKeys =
    new Set(
      before.map(
        sessionKey,
      ),
    );

  return after.filter(
    row =>
      !beforeKeys.has(
        sessionKey(row),
      ),
  );
}

export async function runControlledProducerEvidenceV1(
  input: {
    now?: Date;
    dryRun?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const before =
    loadForwardSnapshot();

  const dryRun =
    input.dryRun === true;

  const evidenceRunId =
    dryRun
      ? null
      : crypto.randomUUID();

  const env = {
    ...process.env,
    ...(input.env ?? {}),

    FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED:
      "true",

    FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_CONFIRM:
      CONTROLLED_NORMAL_PRODUCER_CONFIRM,

    FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
      "false",

    FORWARD_OOS_PROVENANCE_MODE:
      dryRun
        ? "DRY_RUN"
        : "CONTROLLED_NORMAL",

    FORWARD_OOS_PROVENANCE_RUN_ID:
      evidenceRunId ??
      "",

    FORWARD_OOS_PROVENANCE_EVIDENCE_FILE:
      "logs/true-forward-oos-controlled-producer-evidence-run-v1.json",

    REAL_TRADING_ENABLED:
      "false",

    ENABLE_REAL_TRADING:
      "false",

    ENABLE_LIVE_TRADING:
      "false",
  };

  const controlled =
    await runControlledNormalProducerV1({
      now:
        input.now,

      dryRun:
        input.dryRun,

      env,
    });

  const after =
    loadForwardSnapshot();

  const newSessions =
    diffSessions(
      before.sessions,
      after.sessions,
    );

  const checks = {
    beforeSnapshotCaptured:
      true,

    afterSnapshotCaptured:
      true,

    realTradingDisabled:
      env.REAL_TRADING_ENABLED ===
        "false" &&
      env.ENABLE_REAL_TRADING ===
        "false" &&
      env.ENABLE_LIVE_TRADING ===
        "false",

    probeModeDisabled:
      env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY ===
      "false",

    dryRunDidNotMutateForwardFile:
      !dryRun ||
      (
        before.hash ===
          after.hash &&
        before.sessionCount ===
          after.sessionCount
      ),

    normalRunCreatedAtMostOneSession:
      dryRun ||
      newSessions.length <= 1,

    noDuplicateNewSessionKeys:
      new Set(
        newSessions.map(
          sessionKey,
        ),
      ).size ===
      newSessions.length,

    newSessionsCarryEvidenceRunId:
      dryRun ||
      newSessions.every(
        row =>
          row?.provenance?.runId ===
          evidenceRunId,
      ),

    newSessionsCarryControlledMode:
      dryRun ||
      newSessions.every(
        row =>
          row?.provenance?.mode ===
          "CONTROLLED_NORMAL",
      ),

    newSessionsCarryFingerprintAndIntegrity:
      dryRun ||
      newSessions.every(
        row =>
          typeof row?.candidateFingerprint ===
            "string" &&
          row.candidateFingerprint.length >
            0 &&
          row?.integrity?.algorithm ===
            "sha256" &&
          typeof row?.integrity?.payloadHash ===
            "string" &&
          row.integrity.payloadHash.length >
            0,
      ),
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, value]) =>
          value !== true,
      )
      .map(
        ([key]) =>
          key,
      );

  const report = {
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_FAILED",

    mode:
      dryRun
        ? "DRY_RUN"
        : "CONTROLLED_NORMAL",

    evidenceRunId,

    controlledResult:
      controlled,

    before: {
      exists:
        before.exists,

      file:
        before.file,

      hash:
        before.hash,

      sessionCount:
        before.sessionCount,
    },

    after: {
      exists:
        after.exists,

      file:
        after.file,

      hash:
        after.hash,

      sessionCount:
        after.sessionCount,
    },

    delta: {
      sessionCount:
        after.sessionCount -
        before.sessionCount,

      newSessions:
        newSessions.map(
          row => ({
            sourceTradingDate:
              row?.sourceTradingDate ??
              null,

            targetSessionDate:
              row?.targetSessionDate ??
              null,

            capturedAt:
              row?.capturedAt ??
              null,

            candidateCount:
              row?.candidateCount ??
              null,

            provenance:
              row?.provenance ??
              null,

            candidateFingerprint:
              row?.candidateFingerprint ??
              null,

            integrity:
              row?.integrity ??
              null,
          }),
        ),
    },

    checks,

    safety: {
      probeMode:
        false,

      realTradingEnabled:
        false,

      ordersCreatedExpected:
        0,

      positionsChangedExpected:
        0,
    },

    failed,

    nextGate:
      failed.length === 0
        ? (
            dryRun
              ? "READY_FOR_2026_10_12_CONTROLLED_NORMAL_PRODUCER_EVIDENCE_RUN"
              : "VERIFY_NEW_FORWARD_SESSION_CONTENT_AND_BEGIN_1D_3D_5D_OUTCOME_COLLECTION"
          )
        : "REPAIR_CONTROLLED_PRODUCER_EVIDENCE_RUN",
  };

  const logsDir =
    path.join(
      ROOT,
      "logs",
    );

  fs.mkdirSync(
    logsDir,
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    path.join(
      logsDir,
      "true-forward-oos-controlled-producer-evidence-run-v1.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ),
    "utf8",
  );

  return report;
}

async function main() {
  const dryRun =
    process.argv.includes(
      "--dry-run",
    );

  const report =
    await runControlledProducerEvidenceV1({
      dryRun,
    });

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    report.failed.length === 0
      ? 0
      : 1;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-controlled-producer-evidence-run-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_ERROR",

            error:
              String(
                error instanceof Error
                  ? error.stack ??
                    error.message
                  : error
              ),
          },
          null,
          2,
        ),
      );

      process.exitCode = 1;
    },
  );
}
