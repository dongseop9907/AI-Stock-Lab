import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendVerifiedForwardOosProvenanceLedgerV1,
  readVerifiedForwardOosProvenanceLedgerV1,
  verifyForwardOosSessionAgainstLedgerV1,
  VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_V1,
} from "../lib/research/forward-oos-verified-provenance-ledger-v1";

const root =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "ai-stock-forward-ledger-v1-",
    ),
  );

try {
  const runId =
    "11111111-1111-4111-8111-111111111111";

  const session = {
    sourceTradingDate:
      "2026-10-08",
    targetSessionDate:
      "2026-10-12",
    top1: {
      stockCode:
        "005930",
    },
    provenance: {
      mode:
        "CONTROLLED_NORMAL",
      runId,
    },
    candidateFingerprint:
      "a".repeat(64),
    integrity: {
      algorithm:
        "sha256",
      payloadHash:
        "b".repeat(64),
    },
  };

  const first =
    appendVerifiedForwardOosProvenanceLedgerV1(
      {
        verifiedAt:
          "2026-10-12T00:00:00.000Z",
        runId,
        evidenceStatus:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_VERIFIED",
        evidenceFile:
          "logs/true-forward-oos-controlled-producer-evidence-run-v1.json",
        sessionFile:
          "logs/alpha-v3-true-forward-top1-sessions-v1.json",
        beforeHash:
          null,
        afterHash:
          "c".repeat(64),
        sessionDelta:
          1,
        sessions: [
          session,
        ],
      },
      root,
    );

  const ledger =
    readVerifiedForwardOosProvenanceLedgerV1(
      root,
    );

  const verified =
    verifyForwardOosSessionAgainstLedgerV1(
      session,
      ledger,
    );

  const duplicate =
    appendVerifiedForwardOosProvenanceLedgerV1(
      {
        verifiedAt:
          "2026-10-12T00:00:00.000Z",
        runId,
        evidenceStatus:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_VERIFIED",
        evidenceFile:
          "logs/true-forward-oos-controlled-producer-evidence-run-v1.json",
        sessionFile:
          "logs/alpha-v3-true-forward-top1-sessions-v1.json",
        beforeHash:
          null,
        afterHash:
          "c".repeat(64),
        sessionDelta:
          1,
        sessions: [
          session,
        ],
      },
      root,
    );

  const tamperedSession = {
    ...session,
    candidateFingerprint:
      "d".repeat(64),
  };

  const tamperedSessionResult =
    verifyForwardOosSessionAgainstLedgerV1(
      tamperedSession,
      ledger,
    );

  const ledgerFile =
    path.join(
      root,
      VERIFIED_FORWARD_OOS_PROVENANCE_LEDGER_V1,
    );

  const original =
    fs.readFileSync(
      ledgerFile,
      "utf8",
    );

  fs.writeFileSync(
    ledgerFile,
    original.replace(
      '"sessionDelta":1',
      '"sessionDelta":2',
    ),
    "utf8",
  );

  const tamperedLedger =
    readVerifiedForwardOosProvenanceLedgerV1(
      root,
    );

  const checks = {
    firstAppend:
      first.appended === true,
    ledgerValid:
      ledger.valid === true,
    oneEntry:
      ledger.entries.length === 1,
    verifiedSessionAccepted:
      verified.valid === true,
    duplicateRunSuppressed:
      duplicate.appended === false &&
      duplicate.duplicateSuppressed === true,
    tamperedSessionRejected:
      tamperedSessionResult.valid === false,
    tamperedLedgerRejected:
      tamperedLedger.valid === false &&
      tamperedLedger.chainValid === false,
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

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "AI_STOCK_LAB_FORWARD_OOS_VERIFIED_PROVENANCE_LEDGER_V1_CONTRACT_VERIFIED"
            : "AI_STOCK_LAB_FORWARD_OOS_VERIFIED_PROVENANCE_LEDGER_V1_CONTRACT_FAILED",
        checks,
        safety: {
          tempOnly: true,
          projectLogsWritten: 0,
          databaseWrites: 0,
          ordersCreated: 0,
          positionsChanged: 0,
          promotionExecuted: false,
          realTradingEnabled: false,
        },
        failed,
        nextGate:
          failed.length === 0
            ? "RUN_STATIC_PIPELINE_DASHBOARD_INTEGRITY_APP_TSC_BUILD"
            : "REPAIR_VERIFIED_PROVENANCE_LEDGER_CONTRACT",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
finally {
  fs.rmSync(
    root,
    {
      recursive: true,
      force: true,
    },
  );
}
