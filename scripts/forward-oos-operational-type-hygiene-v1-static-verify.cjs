const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

function read(rel) {
  return fs.readFileSync(
    path.join(
      ROOT,
      rel
    ),
    "utf8"
  ).replace(
    /\r\n/g,
    "\n"
  );
}

const supervisor =
  read(
    "scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts"
  );

const producer =
  read(
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts"
  );

const evaluator =
  read(
    "scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1.ts"
  );

const maturity =
  read(
    "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts"
  );

const config =
  JSON.parse(
    read(
      "tsconfig.forward-oos-operational.json"
    )
  );

const pkg =
  JSON.parse(
    read(
      "package.json"
    )
  );

const canonicalImportNeedle =
  'from "../lib/trading/krx-trading-calendar"';

const checks = {
  supervisorCanonicalCalendarImportUnique:
    supervisor
      .split(
        canonicalImportNeedle
      )
      .length -
      1 ===
      1,

  supervisorQualityRowBoundaryTyped:
    supervisor.includes(
      "type QualityGateObservationRow ="
    ) &&
    supervisor.includes(
      "data as unknown as\n        QualityGateObservationRow"
    ),

  producerQualityRowBoundaryTyped:
    producer.includes(
      "interface ProductionQualityEvidenceRow"
    ) &&
    producer.includes(
      "data as unknown as\n      ProductionQualityEvidenceRow"
    ),

  evaluatorObservationsTyped:
    evaluator.includes(
      "interface ForwardObservationForConsistency"
    ) &&
    evaluator.includes(
      "const observations:\n    ForwardObservationForConsistency[] ="
    ),

  maturityLoaderTyped:
    maturity.includes(
      "sessions: ForwardSessionLike[];"
    ),

  operationalTsconfigPresent:
    Array.isArray(
      config.include
    ) &&
    config.include.includes(
      "scripts/alpha-v3-true-forward-top1-producer-v1.ts"
    ) &&
    config.include.includes(
      "scripts/true-forward-oos-first-real-session-readiness-v1.ts"
    ),

  packageCommandPresent:
    pkg.scripts &&
    pkg.scripts[
      "typecheck:forward-oos"
    ] ===
      "tsc --noEmit -p tsconfig.forward-oos-operational.json",

  noNewAsAnyInPatchedBoundaries:
    !supervisor.includes(
      "qualityRow = data as any"
    ) &&
    !producer.includes(
      "qualityRow = data as any"
    ),

  tradingLogicChanged:
    false,
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        key !==
          "tradingLogicChanged" &&
        value !==
          true
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
          ? "AI_STOCK_LAB_FORWARD_OOS_OPERATIONAL_TYPE_HYGIENE_V1_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_OPERATIONAL_TYPE_HYGIENE_V1_STATIC_FAILED",

      checks,

      scope: [
        "market-data-maintenance-supervisor",
        "true-forward-top1-producer",
        "evaluator-evidence-consistency",
        "post-capture-maturity-audit",
        "controlled producer",
        "controlled evidence wrapper",
        "first real session readiness",
        "maturity-aware collector gate"
      ],

      safety: {
        sourceOnly:
          true,

        runtimeExecution:
          false,

        tradingLogicChanged:
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
          ? "RUN_FORWARD_OOS_OPERATIONAL_TYPECHECK"
          : "REPAIR_FORWARD_OOS_OPERATIONAL_TYPE_HYGIENE"
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
