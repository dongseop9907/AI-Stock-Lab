const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-true-forward-oos-summary.ts",
);

const source = fs.existsSync(target)
  ? fs.readFileSync(target, "utf8")
  : "";

const checks = {
  targetExists: Boolean(source),
  canonicalSessionFile: source.includes("alpha-v3-true-forward-top1-sessions-v1.json"),
  legacySessionFileRemoved: !source.includes("alpha-v3-forward-top1-sessions.json"),
  canonicalObservationDataset: source.includes("alpha-v3-entry-v3-forward-oos-observations.json"),
  legacyCheckpointRemoved: !source.includes("alpha-v3-true-forward-entry-v3-checkpoint.json"),
  observationsArrayAccepted: source.includes("checkpoint.observations"),
  canonicalStrictGate:
    source.includes("function isStrictTrueOosSession(") &&
    source.includes("FORWARD_OOS_CONTROLLED_PROVENANCE_V1") &&
    source.includes("CONTROLLED_NORMAL"),
  immutableSessionEvidenceRequired:
    source.includes("row?.frozen === true") &&
    source.includes("sourceDataCutoffAtCollection") &&
    source.includes("payloadHash"),
  legacyCompatibilityPreserved: source.includes("STRICT_TRUE_OOS"),
};

const failed = Object.entries(checks)
  .filter(([, ok]) => ok !== true)
  .map(([name]) => name);

console.log(JSON.stringify({
  status: failed.length === 0
    ? "AI_STOCK_LAB_FORWARD_OOS_SUMMARY_CANONICAL_OBSERVATION_BINDING_V1_STATIC_VERIFIED"
    : "AI_STOCK_LAB_FORWARD_OOS_SUMMARY_CANONICAL_OBSERVATION_BINDING_V1_STATIC_FAILED",
  classification: "CANONICAL_TRUE_FORWARD_SESSION_AND_COLLECTOR_OBSERVATION_SUMMARY_BINDING",
  checks,
  failed,
  safety: {
    staticOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    networkRequests: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    realTradingChanged: false,
  },
  nextAction: failed.length === 0
    ? "RUN_TYPECHECK_DIFF_AND_DEPLOY_THEN_VERIFY_1D_SUMMARY"
    : "REVIEW_FAILED_STATIC_CHECKS",
}, null, 2));

if (failed.length > 0) process.exitCode = 2;
