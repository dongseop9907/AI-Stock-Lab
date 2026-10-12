const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const files = {
  helper:
    "lib/research/forward-oos-verified-provenance-ledger-v1.ts",
  evidence:
    "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  dashboard:
    "lib/research/get-forward-oos-observability-dashboard-v1.ts",
  monitor:
    "scripts/forward-oos-data-quality-integrity-monitor-v1.ts",
  contract:
    "scripts/forward-oos-verified-provenance-ledger-v1-contract-test.ts",
};

function read(rel) {
  const file =
    path.join(
      ROOT,
      rel
    );

  return fs.existsSync(file)
    ? fs.readFileSync(
        file,
        "utf8"
      )
    : "";
}

const helper = read(files.helper);
const evidence = read(files.evidence);
const dashboard = read(files.dashboard);
const monitor = read(files.monitor);
const contract = read(files.contract);

const checks = {
  helperExists:
    Boolean(helper),
  appendOnlyJsonl:
    helper.includes(
      "true-forward-oos-controlled-producer-evidence-ledger-v1.jsonl"
    ) &&
    helper.includes(
      "fs.appendFileSync("
    ),
  hashChain:
    helper.includes(
      "previousEntryHash"
    ) &&
    helper.includes(
      "entryHash"
    ) &&
    helper.includes(
      "chainValid"
    ),
  sessionAttestation:
    helper.includes(
      "RUN_ID_NOT_VERIFIED_IN_LEDGER"
    ) &&
    helper.includes(
      "SESSION_ATTESTATION_MISMATCH"
    ),
  evidenceImportsLedger:
    evidence.includes(
      "appendVerifiedForwardOosProvenanceLedgerV1"
    ),
  evidenceGuard:
    evidence.includes(
      "failed.length === 0"
    ) &&
    evidence.includes(
      "newSessions.length === 1"
    ) &&
    evidence.includes(
      "verifiedLedgerAppend"
    ),
  dashboardVerifiedFilter:
    dashboard.includes(
      "rawSessions"
    ) &&
    dashboard.includes(
      "provenanceBlockedCount"
    ) &&
    dashboard.includes(
      "gateInvalidCount"
    ),
  dashboardFailClosed:
    dashboard.indexOf(
      "input.invalidCount >"
    ) <
    dashboard.indexOf(
      "input.sessionCount ==="
    ),
  monitorVerifiedFilter:
    monitor.includes(
      "verifiedSessions"
    ) &&
    monitor.includes(
      "provenanceIssues"
    ) &&
    monitor.includes(
      "ledgerIntegrityIssues"
    ),
  contractExists:
    Boolean(contract) &&
    contract.includes(
      "tamperedLedgerRejected"
    ),
  noRealTradingEnable:
    !evidence.includes(
      'REAL_TRADING_ENABLED: "true"'
    ) &&
    !dashboard.includes(
      'REAL_TRADING_ENABLED=true'
    ) &&
    !monitor.includes(
      'REAL_TRADING_ENABLED=true'
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_FORWARD_OOS_VERIFIED_PROVENANCE_LEDGER_V1_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_VERIFIED_PROVENANCE_LEDGER_V1_STATIC_FAILED",
      checks,
      contract: {
        ledger:
          "logs/true-forward-oos-controlled-producer-evidence-ledger-v1.jsonl",
        appendRule:
          "NORMAL + ALL CHECKS PASS + EXACTLY ONE NEW SESSION",
        dashboardRule:
          "COUNT ONLY LEDGER-ATTESTED CONTROLLED_NORMAL SESSIONS",
        integrityRule:
          "UNVERIFIED CANONICAL SESSION OR INVALID LEDGER => BLOCKED",
        waitRule:
          "ZERO CANONICAL SESSION + NO LEDGER => WAIT NORMAL",
      },
      safety: {
        sourceOnlyPatch: true,
        producerExecuted: false,
        collectorExecuted: false,
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        promotionExecuted: false,
        realTradingEnabled: false,
      },
      failed,
      nextGate:
        failed.length === 0
          ? "RUN_LEDGER_CONTRACT_FORWARD_PIPELINE_DASHBOARD_INTEGRITY_APP_TSC_BUILD"
          : "REPAIR_VERIFIED_PROVENANCE_LEDGER_V1",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
