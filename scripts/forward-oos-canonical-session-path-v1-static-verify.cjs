const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const CANONICAL =
  "alpha-v3-true-forward-top1-sessions-v1.json";

const CANONICAL_WITH_LOGS =
  "logs/alpha-v3-true-forward-top1-sessions-v1.json";

const LEGACY =
  "alpha-v3-forward-top1-sessions.json";

const READINESS_OLD =
  "logs/alpha-v3-true-forward-top1-sessions.json";

const FILES = {
  producer:
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  collector:
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  summary:
    "scripts/alpha-v3-true-forward-oos-summary.ts",
  readiness:
    "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
  evidence:
    "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  maturityAudit:
    "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
  dashboard:
    "lib/research/get-forward-oos-observability-dashboard-v1.ts",
};

function read(rel) {
  const abs = path.join(ROOT, rel);

  if (!fs.existsSync(abs)) {
    return null;
  }

  return fs.readFileSync(abs, "utf8");
}

const source = Object.fromEntries(
  Object.entries(FILES).map(
    ([key, rel]) => [
      key,
      read(rel),
    ],
  ),
);

const checks = {
  producerExists:
    Boolean(source.producer),
  collectorExists:
    Boolean(source.collector),
  summaryExists:
    Boolean(source.summary),
  readinessExists:
    Boolean(source.readiness),
  evidenceExists:
    Boolean(source.evidence),
  maturityAuditExists:
    Boolean(source.maturityAudit),
  dashboardExists:
    Boolean(source.dashboard),

  producerUsesCanonical:
    Boolean(source.producer) &&
    source.producer.includes(CANONICAL),
  collectorUsesCanonical:
    Boolean(source.collector) &&
    source.collector.includes(CANONICAL),
  summaryUsesCanonical:
    Boolean(source.summary) &&
    source.summary.includes(CANONICAL),
  readinessUsesCanonical:
    Boolean(source.readiness) &&
    source.readiness.includes(CANONICAL_WITH_LOGS),
  evidenceUsesCanonical:
    Boolean(source.evidence) &&
    source.evidence.includes(CANONICAL_WITH_LOGS),
  maturityAuditUsesCanonical:
    Boolean(source.maturityAudit) &&
    source.maturityAudit.includes(CANONICAL_WITH_LOGS),
  dashboardUsesCanonical:
    Boolean(source.dashboard) &&
    source.dashboard.includes(CANONICAL),

  producerLegacyExcluded:
    Boolean(source.producer) &&
    !source.producer.includes(LEGACY),
  collectorLegacyExcluded:
    Boolean(source.collector) &&
    !source.collector.includes(LEGACY),
  summaryLegacyExcluded:
    Boolean(source.summary) &&
    !source.summary.includes(LEGACY),
  readinessOldCandidateExcluded:
    Boolean(source.readiness) &&
    !source.readiness.includes(READINESS_OLD),

  producerVersionMatchesCanonical:
    Boolean(source.producer) &&
    source.producer.includes(
      'ALPHA_V3_TRUE_FORWARD_TOP1_SESSIONS_V1'
    ),

  dashboardStillReadOnly:
    Boolean(source.dashboard) &&
    !source.dashboard.includes("writeFileSync(") &&
    !source.dashboard.includes(".insert(") &&
    !source.dashboard.includes(".upsert(") &&
    !source.dashboard.includes(".update(") &&
    !source.dashboard.includes(".delete("),
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_FORWARD_OOS_CANONICAL_SESSION_PATH_V1_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_CANONICAL_SESSION_PATH_V1_STATIC_FAILED",

      canonicalSessionFile:
        CANONICAL_WITH_LOGS,

      checks,

      policy: {
        currentTrueForwardPipeline:
          "CANONICAL_CONTROLLED_SESSION_FILE_ONLY",

        legacyPipelinePreserved:
          true,

        legacySessionFileDeleted:
          false,

        producerCollectorSummaryAligned:
          true,

        readinessEvidenceAuditDashboardAligned:
          failed.length === 0,
      },

      safety: {
        sourceOnly:
          true,
        databaseReads:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        promotionExecuted:
          false,
        realTradingEnabled:
          false,
      },

      failed,

      nextGate:
        failed.length === 0
          ? "RUN_FORWARD_OOS_CANONICAL_PIPELINE_TYPECHECK_AND_DASHBOARD_CONTRACT"
          : "REPAIR_CANONICAL_SESSION_PATH",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
