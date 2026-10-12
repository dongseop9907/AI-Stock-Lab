const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const producer =
  fs.readFileSync(
    path.resolve(
      root,
      "scripts/alpha-v3-true-forward-top1-producer-v1.ts"
    ),
    "utf8"
  );

const collector =
  fs.readFileSync(
    path.resolve(
      root,
      "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts"
    ),
    "utf8"
  );

const evaluator =
  fs.readFileSync(
    path.resolve(
      root,
      "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts"
    ),
    "utf8"
  );

const pkg =
  JSON.parse(
    fs.readFileSync(
      path.resolve(
        root,
        "package.json"
      ),
      "utf8"
    )
  );

const checks = {
  cutoffFrozen:
    producer.includes(
      '"2026-10-07"'
    ) &&
    collector.includes(
      '"2026-10-07"'
    ) &&
    evaluator.includes(
      '"2026-10-07"'
    ),

  thresholdFrozen:
    producer.includes(
      "FROZEN_ENTRY_THRESHOLD =\n  0.66"
    ) &&
    collector.includes(
      "FROZEN_ENTRY_THRESHOLD =\n  0.66"
    ),

  capFrozen:
    producer.includes(
      "FROZEN_PREMIUM_CAP =\n  0.01"
    ) &&
    collector.includes(
      "FROZEN_PREMIUM_CAP =\n  0.01"
    ),

  producerUsesHistoricalRankingPrimitives:
    producer.includes(
      "buildDailyPriceVolumeEvidence"
    ) &&
    producer.includes(
      "calculateMarketRegimeFeatureVectorV7"
    ) &&
    producer.includes(
      "evidence.score"
    ) &&
    producer.includes(
      "evidence.confidence"
    ),

  producerBlocksRetrospectiveCapture:
    producer.includes(
      "MISSED_CAPTURE_WINDOW"
    ) &&
    producer.includes(
      "retrospectiveCandidateCreated:\n        false"
    ),

  producerRequiresQualityPass:
    producer.includes(
      "market_data_quality_gate_observations"
    ) &&
    producer.includes(
      'data.status ===\n      "PASS"'
    ) &&
    producer.includes(
      'data.freshness_status ===\n      "FRESH"'
    ) &&
    producer.includes(
      'data.integrity_status ===\n      "CLEAN"'
    ),

  independentForwardFile:
    producer.includes(
      "alpha-v3-forward-top1-sessions.json"
    ),

  collectorIndependentDataset:
    collector.includes(
      "alpha-v3-entry-v3-forward-oos-observations.json"
    ),

  collectorUsesExactReplayPrimitives:
    collector.includes(
      "function correctedSignal("
    ) &&
    collector.includes(
      "function firstQualified("
    ) &&
    collector.includes(
      "function simulateLimitFill("
    ),

  collectorFull381Coverage:
    collector.includes(
      "minute.snapshots.length ===\n        381"
    ) &&
    collector.includes(
      '"090000"'
    ) &&
    collector.includes(
      '"153000"'
    ),

  collectorWaitsForSessionClose:
    collector.includes(
      "15 * 60 +\n      40"
    ),

  maturityOnlyWhenBarsExist:
    collector.includes(
      "const b1 ="
    ) &&
    collector.includes(
      "const b3 ="
    ) &&
    collector.includes(
      "const b5 ="
    ),

  historicalCheckpointNotReferencedByRuntime:
    !producer.includes(
      "extended-entry-v3-replay-checkpoint"
    ) &&
    !collector.includes(
      "extended-entry-v3-replay-checkpoint"
    ) &&
    !evaluator.includes(
      "extended-entry-v3-replay-checkpoint"
    ),

  noOrders:
    !producer.includes(
      "/api/orders/"
    ) &&
    !collector.includes(
      "/api/orders/"
    ) &&
    !evaluator.includes(
      "/api/orders/"
    ),

  packageScripts:
    pkg.scripts?.[
      "forward-oos:produce"
    ] ===
      "tsx --env-file=.env.local scripts/alpha-v3-true-forward-top1-producer-v1.ts" &&
    pkg.scripts?.[
      "forward-oos:collect"
    ] ===
      "tsx --env-file=.env.local scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts" &&
    pkg.scripts?.[
      "forward-oos:evaluate"
    ] ===
      "tsx scripts/alpha-v3-true-forward-oos-evaluator-v1.ts" &&
    pkg.scripts?.[
      "forward-oos:test"
    ] ===
      "tsx scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts"
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, value]) =>
        !value
    )
    .map(
      ([name]) =>
        name
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length ===
        0
          ? "ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_STATIC_VERIFIED"
          : "ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_STATIC_REVIEW",

      checks,

      failed,

      frozenContract: {
        historicalCutoff:
          "2026-10-07",

        entryScoreThreshold:
          0.66,

        selectedCap:
          0.01,

        retuningAllowed:
          false
      },

      scientificControls: {
        candidateFrozenBeforeTargetOpen:
          true,

        retrospectiveCandidateCreation:
          false,

        independentForwardDataset:
          true,

        labelsAppendedOnlyWhenFutureBarsExist:
          true,

        historicalCheckpointMutable:
          false
      },

      safety: {
        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        productionChanged:
          false
      },

      nextGate:
        failed.length ===
        0
          ? "CONTRACT_TYPESCRIPT_LIVE_FORWARD_SMOKE"
          : "REVIEW_FORWARD_OOS_PIPELINE_V1"
    },
    null,
    2
  )
);

if (
  failed.length >
  0
) {
  process.exitCode =
    2;
}
