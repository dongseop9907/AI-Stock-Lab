const fs = require("fs");
const path = require("path");

const root = process.cwd();

const forwardPath = path.resolve(
  root,
  "logs/alpha-v3-forward-top1-sessions.json",
);

const statePath = path.resolve(
  root,
  "logs/alpha-v3-entry-v3-forward-shadow-oos-state.json",
);

if (!fs.existsSync(forwardPath)) {
  throw new Error(
    "FORWARD_TOP1_FILE_NOT_FOUND",
  );
}

const forward = JSON.parse(
  fs.readFileSync(
    forwardPath,
    "utf8",
  ),
);

const sessions =
  Array.isArray(forward.sessions)
    ? forward.sessions
    : [];

const badOct09Targets =
  sessions.filter(
    (row) =>
      row?.targetSessionDate ===
      "2026-10-09",
  );

const targetSession =
  sessions.find(
    (row) =>
      row?.sourceTradingDate ===
        "2026-10-08" &&
      row?.targetSessionDate ===
        "2026-10-12",
  );

let oosState = null;

if (fs.existsSync(statePath)) {
  try {
    oosState = JSON.parse(
      fs.readFileSync(
        statePath,
        "utf8",
      ),
    );
  } catch {
    oosState = {
      parseError: true,
    };
  }
}

const stateRows =
  Array.isArray(
    oosState?.observations,
  )
    ? oosState.observations
    : Array.isArray(
        oosState?.sessions,
      )
      ? oosState.sessions
      : [];

const prematureTargetRows =
  stateRows.filter(
    (row) =>
      row?.targetSessionDate ===
        "2026-10-12" &&
      (
        row?.filled === true ||
        row?.correctedEntry ||
        row?.returns ||
        row?.r1 !== undefined ||
        row?.r3 !== undefined ||
        row?.r5 !== undefined
      ),
  );

const checks = {
  forwardFileExists: true,

  invalidOct09ForwardTargets:
    badOct09Targets.length === 0,

  correctedSessionExists:
    Boolean(targetSession),

  correctedSessionFrozen:
    targetSession?.frozen === true,

  correctedTop1IsSamsung:
    targetSession?.top1?.stockCode ===
      "005930",

  sourceCutoffPreserved:
    targetSession?.sourceDataCutoffAtCollection ===
      "2026-10-08",

  historicalContractPreserved:
    targetSession?.frozenContract?.historicalCutoff ===
      "2026-10-07",

  thresholdPreserved:
    Number(
      targetSession?.frozenContract?.entryScoreThreshold,
    ) === 0.66,

  capPreserved:
    Number(
      targetSession?.frozenContract?.selectedCap,
    ) === 0.01,

  noPrematureTargetOutcome:
    prematureTargetRows.length === 0,
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, value]) =>
        !value,
    )
    .map(
      ([name]) =>
        name,
    );

const result = {
  status:
    failed.length === 0
      ? "ALPHA_V3_FORWARD_OOS_POST_CAPTURE_INTEGRITY_V1_VERIFIED"
      : "ALPHA_V3_FORWARD_OOS_POST_CAPTURE_INTEGRITY_V1_REVIEW",

  checks,
  failed,

  forward: {
    sessionCount:
      sessions.length,

    invalidOct09TargetCount:
      badOct09Targets.length,

    correctedSession:
      targetSession
        ? {
            sourceTradingDate:
              targetSession.sourceTradingDate,

            targetSessionDate:
              targetSession.targetSessionDate,

            capturedAt:
              targetSession.capturedAt,

            stockCode:
              targetSession.top1?.stockCode ??
              null,

            stockName:
              targetSession.top1?.stockName ??
              null,

            effectiveScore:
              targetSession.top1?.effectiveScore ??
              null,

            frozen:
              targetSession.frozen ===
              true,
          }
        : null,
  },

  oosState: {
    exists:
      fs.existsSync(statePath),

    rowCount:
      stateRows.length,

    prematureTargetOutcomeCount:
      prematureTargetRows.length,
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesWritten: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    productionChanged: false,
  },

  nextGate:
    failed.length === 0
      ? "WAIT_FOR_2026_10_12_AFTER_1540_KST_THEN_RUN_ENTRY_OOS_COLLECTOR"
      : "REVIEW_FORWARD_STATE_BEFORE_ANY_COLLECTION",
};

console.log(
  JSON.stringify(
    result,
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
