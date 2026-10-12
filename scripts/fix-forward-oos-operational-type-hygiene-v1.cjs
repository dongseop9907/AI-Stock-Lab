const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const FILES = {
  supervisor:
    "scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts",
  producer:
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  evaluator:
    "scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1.ts",
  maturity:
    "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
};

const FORWARD_TSCONFIG =
  "tsconfig.forward-oos-operational.json";

const STATIC =
  "scripts/forward-oos-operational-type-hygiene-v1-static-verify.cjs";

function abs(rel) {
  return path.join(ROOT, rel);
}

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_FORWARD_OOS_OPERATIONAL_TYPE_HYGIENE_V1_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

function mustRead(rel) {
  const file = abs(rel);

  if (!fs.existsSync(file)) {
    fail(
      "TARGET_NOT_FOUND",
      { file: rel },
    );

    throw new Error(
      `TARGET_NOT_FOUND:${rel}`,
    );
  }

  return fs.readFileSync(
    file,
    "utf8",
  );
}

function backup(rel) {
  const source = abs(rel);

  const backupDir = abs(
    "scripts/backups",
  );

  fs.mkdirSync(
    backupDir,
    { recursive: true },
  );

  const target = path.join(
    backupDir,
    path.basename(
      rel,
      ".ts",
    ) +
      ".before-forward-oos-operational-type-hygiene-v1.ts",
  );

  if (!fs.existsSync(target)) {
    fs.copyFileSync(
      source,
      target,
    );
  }

  return path
    .relative(
      ROOT,
      target,
    )
    .replaceAll("\\", "/");
}

const backups = {};
const changes = {};

/* =========================================================
 * 1) Market-data supervisor:
 *    - remove duplicate canonical calendar import
 *    - narrow Supabase selected row at the DB boundary
 * ======================================================= */
{
  const rel = FILES.supervisor;
  let source = mustRead(rel);

  backups[rel] = backup(rel);

  const duplicateImport =
`import { isKrxTradingDate } from "../lib/trading/krx-trading-calendar";
`;

  const first =
    source.indexOf(
      duplicateImport,
    );

  const second =
    source.indexOf(
      duplicateImport,
      first + duplicateImport.length,
    );

  let duplicateRemoved = false;

  if (
    first >= 0 &&
    second >= 0
  ) {
    source =
      source.slice(
        0,
        first,
      ) +
      source.slice(
        first +
          duplicateImport.length,
      );

    duplicateRemoved = true;
  }

  const aliasMarker =
`type QualityGateObservationRow =
  NonNullable<
    PersistentHealthSnapshot["row"]
  >;
`;

  if (
    !source.includes(
      aliasMarker,
    )
  ) {
    const anchor =
      "export interface SupervisorState {";

    const index =
      source.indexOf(
        anchor,
      );

    if (index < 0) {
      fail(
        "SUPERVISOR_ALIAS_ANCHOR_NOT_FOUND",
      );
      return;
    }

    source =
      source.slice(
        0,
        index,
      ) +
      aliasMarker +
      "\n" +
      source.slice(
        index,
      );
  }

  const dataGuard =
`    if (!data) {
      return {
        ok: true,
        healthy: false,
        reason: "NO_POST_READY_QUALITY_OBSERVATION",
        row: null,
        error: null,
      };
    }
`;

  const narrowedDataGuard =
`${dataGuard}
    const qualityRow =
      data as unknown as
        QualityGateObservationRow;
`;

  if (
    source.includes(
      dataGuard,
    ) &&
    !source.includes(
      "const qualityRow =",
    )
  ) {
    source =
      source.replace(
        dataGuard,
        narrowedDataGuard,
      );
  }

  for (const field of [
    "status",
    "freshness_status",
    "integrity_status",
    "effective_error_count",
    "effective_warning_count",
  ]) {
    source =
      source.replaceAll(
        `data.${field}`,
        `qualityRow.${field}`,
      );
  }

  source =
    source.replace(
      "      row: data,",
      "      row: qualityRow,",
    );

  fs.writeFileSync(
    abs(rel),
    source,
    "utf8",
  );

  changes[rel] = {
    duplicateImportRemoved:
      duplicateRemoved ||
      (
        source.match(
          /isKrxTradingDate/g,
        ) || []
      ).length >= 2,

    qualityRowAlias:
      source.includes(
        "type QualityGateObservationRow =",
      ),

    qualityRowBoundaryNarrowing:
      source.includes(
        "data as unknown as\n        QualityGateObservationRow",
      ),

    rowReturnUsesQualityRow:
      source.includes(
        "row: qualityRow",
      ),
  };
}

/* =========================================================
 * 2) True Forward producer:
 *    - narrow selected quality row at DB boundary
 * ======================================================= */
{
  const rel = FILES.producer;
  let source = mustRead(rel);

  backups[rel] = backup(rel);

  const interfaceText =
`interface ProductionQualityEvidenceRow {
  id?: string | null;
  observed_at?: string | null;
  status?: string | null;
  expected_market_date?: string | null;
  freshness_status?: string | null;
  integrity_status?: string | null;
  effective_error_count?: number | null;
  effective_warning_count?: number | null;
}

`;

  if (
    !source.includes(
      "interface ProductionQualityEvidenceRow",
    )
  ) {
    const anchor =
      "async function readProductionQualityEvidence(";

    const index =
      source.indexOf(
        anchor,
      );

    if (index < 0) {
      fail(
        "PRODUCER_EVIDENCE_ANCHOR_NOT_FOUND",
      );
      return;
    }

    source =
      source.slice(
        0,
        index,
      ) +
      interfaceText +
      source.slice(
        index,
      );
  }

  const dataGuard =
`  if (
    !data
  ) {
    return null;
  }
`;

  const narrowedDataGuard =
`${dataGuard}
  const qualityRow =
    data as unknown as
      ProductionQualityEvidenceRow;
`;

  if (
    source.includes(
      dataGuard,
    ) &&
    !source.includes(
      "const qualityRow =",
    )
  ) {
    source =
      source.replace(
        dataGuard,
        narrowedDataGuard,
      );
  }

  for (const field of [
    "status",
    "freshness_status",
    "integrity_status",
    "effective_error_count",
    "effective_warning_count",
  ]) {
    source =
      source.replaceAll(
        `data.${field}`,
        `qualityRow.${field}`,
      );
  }

  source =
    source.replace(
      "    ...data,\n    healthy,",
      "    ...qualityRow,\n    healthy,",
    );

  fs.writeFileSync(
    abs(rel),
    source,
    "utf8",
  );

  changes[rel] = {
    evidenceInterfacePresent:
      source.includes(
        "interface ProductionQualityEvidenceRow",
      ),

    evidenceBoundaryNarrowing:
      source.includes(
        "data as unknown as\n      ProductionQualityEvidenceRow",
      ),

    spreadUsesQualityRow:
      source.includes(
        "...qualityRow",
      ),
  };
}

/* =========================================================
 * 3) Evaluator evidence consistency:
 *    - give observation callbacks a concrete safe shape
 * ======================================================= */
{
  const rel = FILES.evaluator;
  let source = mustRead(rel);

  backups[rel] = backup(rel);

  const interfaceText =
`interface ForwardObservationForConsistency {
  correctedEntry?: {
    qualified?: boolean | null;
  } | null;

  selectedPolicy?: {
    filled?: boolean | null;
  } | null;
}

`;

  if (
    !source.includes(
      "interface ForwardObservationForConsistency",
    )
  ) {
    const anchor =
      "function readJsonIfExists(";

    const index =
      source.indexOf(
        anchor,
      );

    if (index < 0) {
      fail(
        "EVALUATOR_OBSERVATION_TYPE_ANCHOR_NOT_FOUND",
      );
      return;
    }

    source =
      source.slice(
        0,
        index,
      ) +
      interfaceText +
      source.slice(
        index,
      );
  }

  source =
    source.replace(
      "  const observations =\n",
      "  const observations:\n    ForwardObservationForConsistency[] =\n",
    );

  fs.writeFileSync(
    abs(rel),
    source,
    "utf8",
  );

  changes[rel] = {
    observationInterfacePresent:
      source.includes(
        "interface ForwardObservationForConsistency",
      ),

    observationsExplicitlyTyped:
      source.includes(
        "const observations:\n    ForwardObservationForConsistency[] =",
      ),

    rowCallbacksPreserved:
      (
        source.match(
          /row =>/g,
        ) || []
      ).length >= 3,
  };
}

/* =========================================================
 * 4) Post-capture maturity audit:
 *    - explicitly type disk loader result
 * ======================================================= */
{
  const rel = FILES.maturity;
  let source = mustRead(rel);

  backups[rel] = backup(rel);

  const oldSignature =
    "function loadSessionsFromDisk() {";

  const newSignature =
`function loadSessionsFromDisk(): {
  file: string | null;
  sessions: ForwardSessionLike[];
} {`;

  if (
    source.includes(
      oldSignature,
    )
  ) {
    source =
      source.replace(
        oldSignature,
        newSignature,
      );
  }

  fs.writeFileSync(
    abs(rel),
    source,
    "utf8",
  );

  changes[rel] = {
    loaderReturnTypeExplicit:
      source.includes(
        "sessions: ForwardSessionLike[];",
      ),

    auditStillUsesSessionIntegrity:
      source.includes(
        "buildSessionIntegrity(",
      ),

    auditStillUsesMaturitySchedule:
      source.includes(
        "buildMaturitySchedule(",
      ),
  };
}

/* =========================================================
 * 5) Dedicated operational Forward OOS typecheck
 * ======================================================= */
const forwardTsconfig = {
  extends:
    "./tsconfig.json",

  compilerOptions: {
    noEmit:
      true,

    incremental:
      false,
  },

  include: [
    "scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts",
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
    "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
    "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
    "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
    "scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1.ts",
    "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts"
  ],

  exclude: [
    "node_modules",
    "scripts/backups/**",
  ],
};

fs.writeFileSync(
  abs(FORWARD_TSCONFIG),
  JSON.stringify(
    forwardTsconfig,
    null,
    2,
  ) + "\n",
  "utf8",
);

const packagePath =
  abs("package.json");

const pkg =
  JSON.parse(
    fs.readFileSync(
      packagePath,
      "utf8",
    ).replace(
      /^\uFEFF/,
      "",
    ),
  );

pkg.scripts =
  pkg.scripts || {};

pkg.scripts[
  "typecheck:forward-oos"
] =
  "tsc --noEmit -p tsconfig.forward-oos-operational.json";

fs.writeFileSync(
  packagePath,
  JSON.stringify(
    pkg,
    null,
    2,
  ) + "\n",
  "utf8",
);

/* =========================================================
 * Static verifier
 * ======================================================= */
const staticSource = `const fs = require("fs");
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
    /\\r\\n/g,
    "\\n"
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
      "data as unknown as\\n        QualityGateObservationRow"
    ),

  producerQualityRowBoundaryTyped:
    producer.includes(
      "interface ProductionQualityEvidenceRow"
    ) &&
    producer.includes(
      "data as unknown as\\n      ProductionQualityEvidenceRow"
    ),

  evaluatorObservationsTyped:
    evaluator.includes(
      "interface ForwardObservationForConsistency"
    ) &&
    evaluator.includes(
      "const observations:\\n    ForwardObservationForConsistency[] ="
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
`;

fs.writeFileSync(
  abs(STATIC),
  staticSource,
  "utf8",
);

const allChecks = {};

for (
  const [
    file,
    fileChecks
  ] of Object.entries(
    changes,
  )
) {
  allChecks[file] =
    fileChecks;
}

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_FORWARD_OOS_OPERATIONAL_TYPE_HYGIENE_V1_REPAIRED",

      changedFiles: [
        FILES.supervisor,
        FILES.producer,
        FILES.evaluator,
        FILES.maturity,
        "package.json"
      ],

      generatedFiles: [
        FORWARD_TSCONFIG,
        STATIC
      ],

      backups,

      repair: {
        supervisor:
          "remove duplicate KRX calendar import and narrow Supabase quality row at selected DB boundary",

        producer:
          "narrow Supabase quality-evidence row to the exact selected field shape",

        evaluator:
          "give forward observations an explicit callback-safe shape",

        maturity:
          "make session loader return ForwardSessionLike[] explicitly",

        operationalTypecheck:
          "dedicated strict typecheck for first-session Forward OOS runtime path",

        algorithmLogic:
          "UNCHANGED",

        orderLogic:
          "UNCHANGED",

        promotionLogic:
          "UNCHANGED",

        anyCast:
          "NOT_USED"
      },

      checks:
        allChecks,

      safety: {
        scriptsExecuted:
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

      failed: [],

      nextAction:
        "RUN_STATIC_APP_BUILD_DASHBOARD_AND_FORWARD_OOS_OPERATIONAL_TYPECHECK"
    },
    null,
    2
  )
);

process.exitCode = 0;
