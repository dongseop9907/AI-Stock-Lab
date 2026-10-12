const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const FILES = {
  producer:
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  controlled:
    "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
  evidence:
    "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  automation:
    "lib/research/run-true-forward-oos-automation-binding-v1.ts",
};

function read(rel) {
  const abs = path.join(ROOT, rel);

  return fs.existsSync(abs)
    ? fs.readFileSync(abs, "utf8")
    : "";
}

const producer = read(FILES.producer);
const controlled = read(FILES.controlled);
const evidence = read(FILES.evidence);
const automation = read(FILES.automation);

const checks = {
  producerExists:
    Boolean(producer),
  controlledProducerExists:
    Boolean(controlled),
  evidenceWrapperExists:
    Boolean(evidence),
  automationBindingExists:
    Boolean(automation),

  producerHasCrypto:
    producer.includes(
      'import crypto from "node:crypto";'
    ),

  producerHasProvenanceSchema:
    producer.includes(
      "FORWARD_OOS_CONTROLLED_PROVENANCE_V1"
    ),

  producerHasControlledMode:
    producer.includes(
      "FORWARD_OOS_PROVENANCE_MODE"
    ),

  producerHasRunId:
    producer.includes(
      "FORWARD_OOS_PROVENANCE_RUN_ID"
    ),

  producerHasCandidateFingerprint:
    producer.includes(
      "candidateFingerprint"
    ),

  producerHasIntegrityHash:
    producer.includes(
      "payloadHash"
    ) &&
    /algorithm:\s*[\r\n ]*"sha256"/.test(
      producer
    ),

  canonicalSessionFilePreserved:
    producer.includes(
      "alpha-v3-true-forward-top1-sessions-v1.json"
    ),

  evidenceGeneratesRunId:
    evidence.includes(
      "crypto.randomUUID()"
    ),

  evidencePassesControlledMode:
    evidence.includes(
      'FORWARD_OOS_PROVENANCE_MODE:'
    ) &&
    evidence.includes(
      '"CONTROLLED_NORMAL"'
    ),

  evidencePassesRunId:
    evidence.includes(
      "FORWARD_OOS_PROVENANCE_RUN_ID:"
    ),

  evidenceReportStoresRunId:
    evidence.includes(
      "evidenceRunId,"
    ),

  evidenceChecksSessionRunId:
    evidence.includes(
      "newSessionsCarryEvidenceRunId"
    ),

  evidenceChecksControlledMode:
    evidence.includes(
      "newSessionsCarryControlledMode"
    ),

  automationDefaultRunStepAcceptsEnv:
    automation.includes(
      "env: NodeJS.ProcessEnv = process.env"
    ),

  automationChildUsesProvidedEnv:
    automation.includes(
      "...env,"
    ) &&
    automation.includes(
      "defaultRunStep("
    ),

  controlledProducerStillForcesRealTradingOff:
    controlled.includes(
      'REAL_TRADING_ENABLED:\n            "false"'
    ) &&
    controlled.includes(
      'ENABLE_REAL_TRADING:\n            "false"'
    ) &&
    controlled.includes(
      'ENABLE_LIVE_TRADING:\n            "false"'
    ),

  noTradingEnableIntroduced:
    !producer.includes(
      'REAL_TRADING_ENABLED = "true"'
    ) &&
    !evidence.includes(
      'REAL_TRADING_ENABLED: "true"'
    ),

  noOrderMutationAddedToProducer:
    !producer.includes(
      "createPaperBuyOrder("
    ) &&
    !producer.includes(
      "executePaperBuyOrder("
    ),
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
          ? "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_PROVENANCE_PERSISTENCE_V1_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_PROVENANCE_PERSISTENCE_V1_STATIC_FAILED",

      checks,

      contract: {
        schemaVersion:
          "FORWARD_OOS_CONTROLLED_PROVENANCE_V1",

        sessionFields: [
          "provenance.mode",
          "provenance.runId",
          "provenance.evidenceFile",
          "provenance.canonicalSessionFile",
          "candidateFingerprint",
          "integrity.algorithm",
          "integrity.payloadHash"
        ],

        controlledMode:
          "CONTROLLED_NORMAL",

        evidenceJoinKey:
          "evidenceRunId <-> session.provenance.runId",

        canonicalSessionFile:
          "logs/alpha-v3-true-forward-top1-sessions-v1.json"
      },

      safety: {
        sourceOnly:
          true,
        producerExecuted:
          false,
        collectorExecuted:
          false,
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
          false
      },

      failed,

      nextGate:
        failed.length === 0
          ? "RUN_FORWARD_PIPELINE_TYPECHECK_DASHBOARD_CONTRACT_APP_TSC_BUILD"
          : "REPAIR_CONTROLLED_PROVENANCE_PERSISTENCE"
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
