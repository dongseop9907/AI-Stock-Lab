const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const BINDING = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-observation-source-binding-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-observation-source-binding-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-observation-source-binding-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(ROOT, rel)
      )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    { missing }
  );
} else {
  const bindingSource = `import fs from "node:fs";
import path from "node:path";

export type CanonicalForwardHorizon =
  | "1D"
  | "3D"
  | "5D";

export interface CanonicalForwardOutcomeRow {
  sourceTradingDate: string;
  targetSessionDate: string;
  stockCode: string;
  horizon: CanonicalForwardHorizon;
  qualified: boolean;
  filled: boolean | null;
  directReturn: number;
  policyReturn: number | null;
  observedAt: string | null;
}

export interface ObservationSourceBindingInput {
  observations?: any[];
}

const ROOT =
  process.cwd();

export const TRUE_FORWARD_OBSERVATION_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-entry-v3-forward-oos-observations.json",
  );

const HORIZON_MAP = [
  {
    source:
      "r1",
    horizon:
      "1D",
  },
  {
    source:
      "r3",
    horizon:
      "3D",
  },
  {
    source:
      "r5",
    horizon:
      "5D",
  },
] as const;

const HORIZON_ORDER:
  Record<
    CanonicalForwardHorizon,
    number
  > = {
    "1D": 1,
    "3D": 3,
    "5D": 5,
  };

function finiteNumber(
  value: unknown,
): number | null {
  if (
    typeof value ===
      "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  return null;
}

function readActualObservations() {
  if (
    !fs.existsSync(
      TRUE_FORWARD_OBSERVATION_FILE,
    )
  ) {
    return {
      exists:
        false,
      observations:
        [] as any[],
    };
  }

  const parsed =
    JSON.parse(
      fs.readFileSync(
        TRUE_FORWARD_OBSERVATION_FILE,
        "utf8",
      ),
    );

  return {
    exists:
      true,

    observations:
      Array.isArray(
        parsed?.observations,
      )
        ? parsed.observations
        : [],
  };
}

export function bindActualForwardObservations(
  input:
    ObservationSourceBindingInput = {},
) {
  const source =
    input.observations
      ? {
          exists:
            true,
          observations:
            input.observations,
        }
      : readActualObservations();

  const rows:
    CanonicalForwardOutcomeRow[] =
    [];

  const invalidSourceRows:
    Array<{
      index: number;
      failed: string[];
    }> = [];

  source.observations.forEach(
    (
      observation:
        any,
      index:
        number,
    ) => {
      const sourceTradingDate =
        String(
          observation
            ?.sourceTradingDate ??
          "",
        );

      const targetSessionDate =
        String(
          observation
            ?.targetSessionDate ??
          "",
        );

      const stockCode =
        String(
          observation
            ?.stockCode ??
          "",
        );

      const qualified =
        observation
          ?.correctedEntry
          ?.qualified;

      const filled =
        typeof observation
          ?.selectedPolicy
          ?.filled ===
        "boolean"
          ? observation
              .selectedPolicy
              .filled
          : null;

      const observedAt =
        typeof observation
          ?.correctedEntry
          ?.observedAt ===
        "string"
          ? observation
              .correctedEntry
              .observedAt
          : (
              typeof observation
                ?.candidateCapturedAt ===
              "string"
                ? observation
                    .candidateCapturedAt
                : null
            );

      const failed:
        string[] = [];

      if (
        !/^\\d{4}-\\d{2}-\\d{2}$/.test(
          sourceTradingDate,
        )
      ) {
        failed.push(
          "SOURCE_TRADING_DATE_INVALID",
        );
      }

      if (
        !/^\\d{4}-\\d{2}-\\d{2}$/.test(
          targetSessionDate,
        )
      ) {
        failed.push(
          "TARGET_SESSION_DATE_INVALID",
        );
      }

      if (
        sourceTradingDate &&
        targetSessionDate &&
        targetSessionDate <=
          sourceTradingDate
      ) {
        failed.push(
          "TARGET_SESSION_NOT_AFTER_SOURCE",
        );
      }

      if (
        stockCode.length ===
        0
      ) {
        failed.push(
          "STOCK_CODE_MISSING",
        );
      }

      if (
        typeof qualified !==
        "boolean"
      ) {
        failed.push(
          "QUALIFIED_NOT_BOOLEAN",
        );
      }

      if (
        failed.length > 0
      ) {
        invalidSourceRows.push({
          index,
          failed,
        });

        return;
      }

      for (
        const item of HORIZON_MAP
      ) {
        const directReturn =
          finiteNumber(
            observation
              ?.correctedEntry
              ?.directReturns
              ?.[item.source],
          );

        if (
          directReturn ===
          null
        ) {
          continue;
        }

        const policyReturn =
          finiteNumber(
            observation
              ?.selectedPolicy
              ?.returns
              ?.[item.source],
          );

        rows.push({
          sourceTradingDate,
          targetSessionDate,
          stockCode,
          horizon:
            item.horizon,
          qualified,
          filled,
          directReturn,
          policyReturn,
          observedAt,
        });
      }
    },
  );

  const keyOf = (
    row:
      CanonicalForwardOutcomeRow,
  ) =>
    [
      row.sourceTradingDate,
      row.targetSessionDate,
      row.stockCode,
      row.horizon,
    ].join("|");

  const sessionKeyOf = (
    row:
      CanonicalForwardOutcomeRow,
  ) =>
    [
      row.sourceTradingDate,
      row.targetSessionDate,
      row.stockCode,
    ].join("|");

  const seen =
    new Set<string>();

  const duplicateKeys:
    string[] = [];

  for (
    const row of rows
  ) {
    const key =
      keyOf(row);

    if (
      seen.has(key)
    ) {
      duplicateKeys.push(
        key,
      );
    } else {
      seen.add(key);
    }
  }

  const grouped =
    new Map<
      string,
      CanonicalForwardOutcomeRow[]
    >();

  for (
    const row of rows
  ) {
    const key =
      sessionKeyOf(row);

    const list =
      grouped.get(key) ??
      [];

    list.push(row);

    grouped.set(
      key,
      list,
    );
  }

  const orderingViolations:
    Array<{
      sessionKey: string;
      horizons: CanonicalForwardHorizon[];
    }> = [];

  for (
    const [
      sessionKey,
      group,
    ] of grouped
  ) {
    const horizons =
      Array.from(
        new Set(
          group.map(
            row =>
              row.horizon,
          ),
        ),
      )
        .sort(
          (a, b) =>
            HORIZON_ORDER[a] -
            HORIZON_ORDER[b],
        );

    const expected =
      (
        [
          "1D",
          "3D",
          "5D",
        ] as
          CanonicalForwardHorizon[]
      )
        .slice(
          0,
          horizons.length,
        );

    if (
      horizons.join(",") !==
      expected.join(",")
    ) {
      orderingViolations.push({
        sessionKey,
        horizons,
      });
    }
  }

  const failed = [
    ...(invalidSourceRows.length >
      0
      ? [
          "INVALID_OBSERVATION_SOURCE_ROWS",
        ]
      : []),

    ...(duplicateKeys.length >
      0
      ? [
          "DUPLICATE_CANONICAL_OUTCOME_KEYS",
        ]
      : []),

    ...(orderingViolations.length >
      0
      ? [
          "CANONICAL_HORIZON_ORDERING_VIOLATION",
        ]
      : []),
  ];

  const bindingStatus =
    !source.exists
      ? "WAITING_FOR_OBSERVATION_FILE"
      : source.observations.length ===
          0
        ? "WAITING_FOR_OBSERVATIONS"
        : failed.length >
            0
          ? "OUTCOME_SOURCE_BINDING_FAILED"
          : rows.length ===
              0
            ? "WAITING_FOR_MATURE_OUTCOME_ROWS"
            : "ACTUAL_OUTCOME_SOURCE_BOUND";

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1",

    bindingStatus,

    source: {
      file:
        "logs/alpha-v3-entry-v3-forward-oos-observations.json",

      exists:
        source.exists,

      observations:
        source.observations.length,
    },

    counts: {
      canonicalOutcomeRows:
        rows.length,

      sessions:
        grouped.size,

      duplicateKeys:
        duplicateKeys.length,

      invalidSourceRows:
        invalidSourceRows.length,

      orderingViolations:
        orderingViolations.length,

      byHorizon: {
        "1D":
          rows.filter(
            row =>
              row.horizon ===
              "1D",
          ).length,

        "3D":
          rows.filter(
            row =>
              row.horizon ===
              "3D",
          ).length,

        "5D":
          rows.filter(
            row =>
              row.horizon ===
              "5D",
          ).length,
      },
    },

    rows,
    duplicateKeys,
    invalidSourceRows,
    orderingViolations,

    schema: {
      actualReturnSource:
        "correctedEntry.directReturns.r1/r3/r5",

      actualQualifiedSource:
        "correctedEntry.qualified",

      actualPolicyReturnSource:
        "selectedPolicy.returns.r1/r3/r5",

      canonicalHorizonMap: {
        r1:
          "1D",
        r3:
          "3D",
        r5:
          "5D",
      },

      unsupportedLegacyAssumptions: [
        "evaluatedAt",
        "returnRate",
      ],
    },

    safety: {
      readOnly:
        true,

      collectorExecuted:
        false,

      evaluatorExecuted:
        false,

      databaseReads:
        0,

      databaseWrites:
        0,

      fileWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      bindingStatus ===
        "ACTUAL_OUTCOME_SOURCE_BOUND"
        ? "BIND_CANONICAL_OUTCOMES_TO_EVALUATOR_AND_SUMMARY_EVIDENCE"
        : bindingStatus ===
            "OUTCOME_SOURCE_BINDING_FAILED"
          ? "REPAIR_ACTUAL_OBSERVATION_DATA_BEFORE_EVALUATION"
          : "WAIT_FOR_REAL_FORWARD_OBSERVATION_AND_MATURITY",
  };
}

async function main() {
  const report =
    bindActualForwardObservations();

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    report.bindingStatus ===
      "OUTCOME_SOURCE_BINDING_FAILED"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-observation-source-binding-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_ERROR",

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
`;

  const contractSource = `import assert from "node:assert/strict";

import {
  bindActualForwardObservations,
} from "./true-forward-oos-observation-source-binding-v1";

function validBase() {
  return {
    sourceTradingDate:
      "2026-10-08",

    targetSessionDate:
      "2026-10-12",

    stockCode:
      "005930",

    candidateCapturedAt:
      "2026-10-08T23:50:00.000Z",

    correctedEntry: {
      qualified:
        true,

      observedAt:
        "2026-10-12T00:02:00.000Z",

      directReturns: {
        r1:
          0.01,

        r3:
          null,

        r5:
          null,
      },
    },

    selectedPolicy: {
      filled:
        true,

      returns: {
        r1:
          0.008,

        r3:
          null,

        r5:
          null,
      },
    },
  };
}

function main() {
  const oneDay =
    bindActualForwardObservations({
      observations: [
        validBase(),
      ],
    });

  const allMatureObservation =
    validBase();

  allMatureObservation
    .correctedEntry
    .directReturns = {
      r1:
        0.01,

      r3:
        0.02,

      r5:
        0.03,
    };

  allMatureObservation
    .selectedPolicy
    .returns = {
      r1:
        0.008,

      r3:
        0.018,

      r5:
        0.025,
    };

  const allMature =
    bindActualForwardObservations({
      observations: [
        allMatureObservation,
      ],
    });

  const orderingObservation =
    validBase();

  orderingObservation
    .correctedEntry
    .directReturns = {
      r1:
        null,

      r3:
        0.02,

      r5:
        null,
    };

  const ordering =
    bindActualForwardObservations({
      observations: [
        orderingObservation,
      ],
    });

  const duplicate =
    bindActualForwardObservations({
      observations: [
        validBase(),
        validBase(),
      ],
    });

  const invalid =
    bindActualForwardObservations({
      observations: [
        {
          ...validBase(),

          stockCode:
            "",

          correctedEntry: {
            qualified:
              null,

            directReturns: {
              r1:
                0.01,
            },
          },
        },
      ],
    });

  const checks = {
    oneDayBound:
      oneDay.bindingStatus ===
        "ACTUAL_OUTCOME_SOURCE_BOUND" &&
      oneDay.counts
        .canonicalOutcomeRows ===
        1 &&
      oneDay.rows[0]
        ?.horizon ===
        "1D",

    actualR1MappedTo1D:
      oneDay.rows[0]
        ?.directReturn ===
        0.01,

    qualifiedMapped:
      oneDay.rows[0]
        ?.qualified ===
        true,

    policyReturnMapped:
      oneDay.rows[0]
        ?.policyReturn ===
        0.008,

    allMatureHasThreeRows:
      allMature.counts
        .canonicalOutcomeRows ===
        3 &&
      allMature.rows
        .map(
          row =>
            row.horizon,
        )
        .join(",") ===
        "1D,3D,5D",

    orderingViolationBlocked:
      ordering.bindingStatus ===
        "OUTCOME_SOURCE_BINDING_FAILED" &&
      ordering.failed.includes(
        "CANONICAL_HORIZON_ORDERING_VIOLATION",
      ),

    duplicateBlocked:
      duplicate.bindingStatus ===
        "OUTCOME_SOURCE_BINDING_FAILED" &&
      duplicate.failed.includes(
        "DUPLICATE_CANONICAL_OUTCOME_KEYS",
      ),

    invalidBlocked:
      invalid.bindingStatus ===
        "OUTCOME_SOURCE_BINDING_FAILED" &&
      invalid.failed.includes(
        "INVALID_OBSERVATION_SOURCE_ROWS",
      ),

    actualSchemaNoInventedFields:
      oneDay.schema
        .unsupportedLegacyAssumptions
        .includes(
          "evaluatedAt",
        ) &&
      oneDay.schema
        .unsupportedLegacyAssumptions
        .includes(
          "returnRate",
        ),

    readOnly:
      oneDay.safety
        .readOnly ===
        true,

    noTradingSideEffects:
      oneDay.safety
        .ordersCreated ===
        0 &&
      oneDay.safety
        .positionsChanged ===
        0 &&
      oneDay.safety
        .realTradingEnabled ===
        false,
  };

  for (
    const [
      key,
      value,
    ] of Object.entries(
      checks,
    )
  ) {
    assert.equal(
      value,
      true,
      key,
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          oneDay:
            oneDay.counts,

          allMature:
            allMature.counts,

          ordering:
            ordering.failed,

          duplicate:
            duplicate.failed,

          invalid:
            invalid.failed,
        },

        safety: {
          syntheticOnly:
            true,

          collectorExecuted:
            false,

          evaluatorExecuted:
            false,

          databaseWrites:
            0,

          fileWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          realTradingEnabled:
            false,
        },

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_RUN_CURRENT_ACTUAL_SOURCE_BINDING",
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_CONTRACT_FAILED",

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
}
`;

  const staticSource = `const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-observation-source-binding-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_STATIC_FAILED",

    failed:
      ["bindingExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    bindingExists:
      true,

    actualObservationFile:
      source.includes(
        "logs/alpha-v3-entry-v3-forward-oos-observations.json"
      ),

    directReturnsSource:
      source.includes(
        "directReturns"
      ),

    r1R3R5:
      source.includes(
        '"r1"'
      ) &&
      source.includes(
        '"r3"'
      ) &&
      source.includes(
        '"r5"'
      ),

    canonical1D3D5D:
      source.includes(
        '"1D"'
      ) &&
      source.includes(
        '"3D"'
      ) &&
      source.includes(
        '"5D"'
      ),

    qualifiedSource:
      source.includes(
        "correctedEntry"
      ) &&
      source.includes(
        "qualified"
      ),

    policyReturnSource:
      source.includes(
        "selectedPolicy"
      ) &&
      source.includes(
        "returns"
      ),

    stockCodeInKey:
      source.includes(
        "row.stockCode"
      ),

    duplicateFailClosed:
      source.includes(
        "DUPLICATE_CANONICAL_OUTCOME_KEYS"
      ),

    orderingFailClosed:
      source.includes(
        "CANONICAL_HORIZON_ORDERING_VIOLATION"
      ),

    actualSchemaDocumentsNoEvaluatedAt:
      source.includes(
        '"evaluatedAt"'
      ) &&
      source.includes(
        '"returnRate"'
      ) &&
      source.includes(
        "unsupportedLegacyAssumptions"
      ),

    readOnlyDisk:
      source.includes(
        "readFileSync"
      ) &&
      !source.includes(
        "writeFileSync"
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source
      ),

    noRealTradingEnable:
      !/(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\\s*[:=]\\s*["']true["']/i.test(
        source
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

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      collectorExecuted:
        false,

      evaluatorExecuted:
        false,

      databaseWrites:
        0,

      fileWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_OBSERVATION_SOURCE_BINDING_CONTRACT"
        : "REPAIR_OBSERVATION_SOURCE_BINDING_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

  fs.writeFileSync(
    BINDING,
    bindingSource,
    "utf8"
  );

  fs.writeFileSync(
    CONTRACT,
    contractSource,
    "utf8"
  );

  fs.writeFileSync(
    STATIC,
    staticSource,
    "utf8"
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8"
        )
      );
  } catch (error) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error
          ),
      }
    );
  }

  if (pkg) {
    pkg.scripts ||= {};

    pkg.scripts[
      "forward-oos:observation-source-binding"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-observation-source-binding-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-observation-source-binding"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-observation-source-binding-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-observation-source-binding-static"
    ] =
      "node ./scripts/true-forward-oos-observation-source-binding-v1-static-verify.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-observation-source-binding-v1.ts",
        "scripts/true-forward-oos-observation-source-binding-v1-contract-test.ts",
        "scripts/true-forward-oos-observation-source-binding-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      actualSource: {
        file:
          "logs/alpha-v3-entry-v3-forward-oos-observations.json",

        qualified:
          "correctedEntry.qualified",

        directReturns:
          "correctedEntry.directReturns.r1/r3/r5",

        policyReturns:
          "selectedPolicy.returns.r1/r3/r5",

        horizonMap: {
          r1:
            "1D",

          r3:
            "3D",

          r5:
            "5D"
        }
      },

      correctedAssumptions: [
        "NO_EVALUATED_AT_FIELD_IN_ACTUAL_SCHEMA",
        "NO_RETURN_RATE_FIELD_IN_ACTUAL_SCHEMA"
      ],

      safety: {
        readOnly:
          true,

        installerExecutedCollector:
          false,

        installerExecutedEvaluator:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        fileWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        realTradingEnabled:
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_ACTUAL_SOURCE_BINDING"
    }, null, 2));

    process.exitCode = 0;
  }
}
