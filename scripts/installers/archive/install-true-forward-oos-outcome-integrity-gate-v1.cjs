const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const AUDIT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-outcome-integrity-gate-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-outcome-integrity-gate-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-outcome-integrity-gate-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(PACKAGE)) {
  fail("PACKAGE_JSON_NOT_FOUND");
} else {
  const auditSource = `export type OutcomeHorizon =
  | "1D"
  | "3D"
  | "5D";

export interface OutcomeRowLike {
  sourceTradingDate?: string | null;
  targetSessionDate?: string | null;
  horizon?: OutcomeHorizon | string | null;
  capturedAt?: string | null;
  evaluatedAt?: string | null;
  qualified?: boolean | null;
  returnRate?: number | null;
}

export interface OutcomeIntegrityInput {
  outcomes?: OutcomeRowLike[];
}

const HORIZON_ORDER:
  Record<OutcomeHorizon, number> = {
    "1D": 1,
    "3D": 3,
    "5D": 5,
  };

function keyOf(
  row: OutcomeRowLike,
) {
  return [
    row.sourceTradingDate ?? "",
    row.targetSessionDate ?? "",
    row.horizon ?? "",
  ].join("|");
}

function sessionKeyOf(
  row: OutcomeRowLike,
) {
  return [
    row.sourceTradingDate ?? "",
    row.targetSessionDate ?? "",
  ].join("|");
}

export function auditOutcomeRows(
  input: OutcomeIntegrityInput = {},
) {
  const outcomes =
    Array.isArray(
      input.outcomes,
    )
      ? input.outcomes
      : [];

  const seen =
    new Set<string>();

  const duplicateKeys:
    string[] = [];

  const invalidRows:
    Array<{
      index: number;
      failed: string[];
    }> = [];

  const bySession =
    new Map<
      string,
      OutcomeRowLike[]
    >();

  outcomes.forEach(
    (row, index) => {
      const failed:
        string[] = [];

      const source =
        String(
          row.sourceTradingDate ??
          "",
        );

      const target =
        String(
          row.targetSessionDate ??
          "",
        );

      const horizon =
        String(
          row.horizon ??
          "",
        );

      if (
        !/^\\d{4}-\\d{2}-\\d{2}$/.test(
          source,
        )
      ) {
        failed.push(
          "SOURCE_DATE_INVALID",
        );
      }

      if (
        !/^\\d{4}-\\d{2}-\\d{2}$/.test(
          target,
        )
      ) {
        failed.push(
          "TARGET_DATE_INVALID",
        );
      }

      if (
        source &&
        target &&
        target <= source
      ) {
        failed.push(
          "TARGET_NOT_AFTER_SOURCE",
        );
      }

      if (
        !(
          horizon === "1D" ||
          horizon === "3D" ||
          horizon === "5D"
        )
      ) {
        failed.push(
          "HORIZON_INVALID",
        );
      }

      if (
        typeof row.qualified !==
        "boolean"
      ) {
        failed.push(
          "QUALIFIED_NOT_BOOLEAN",
        );
      }

      if (
        row.returnRate !== null &&
        row.returnRate !== undefined &&
        !Number.isFinite(
          Number(
            row.returnRate,
          ),
        )
      ) {
        failed.push(
          "RETURN_RATE_INVALID",
        );
      }

      if (
        !row.evaluatedAt
      ) {
        failed.push(
          "EVALUATED_AT_MISSING",
        );
      }

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

      const sessionKey =
        sessionKeyOf(row);

      const list =
        bySession.get(
          sessionKey,
        ) ?? [];

      list.push(row);

      bySession.set(
        sessionKey,
        list,
      );

      if (
        failed.length > 0
      ) {
        invalidRows.push({
          index,
          failed,
        });
      }
    },
  );

  const orderingViolations:
    Array<{
      sessionKey: string;
      horizons: string[];
    }> = [];

  for (
    const [
      sessionKey,
      rows,
    ] of bySession
  ) {
    const horizons =
      rows
        .map(
          row =>
            String(
              row.horizon ??
              "",
            ),
        )
        .filter(
          horizon =>
            horizon === "1D" ||
            horizon === "3D" ||
            horizon === "5D",
        ) as OutcomeHorizon[];

    const unique =
      Array.from(
        new Set(
          horizons,
        ),
      );

    const sorted =
      [...unique]
        .sort(
          (a, b) =>
            HORIZON_ORDER[a] -
            HORIZON_ORDER[b],
        );

    const expectedPrefix =
      ["1D", "3D", "5D"]
        .slice(
          0,
          sorted.length,
        );

    if (
      sorted.join(",") !==
      expectedPrefix.join(",")
    ) {
      orderingViolations.push({
        sessionKey,
        horizons:
          sorted,
      });
    }
  }

  const failed =
    [
      ...(duplicateKeys.length > 0
        ? ["DUPLICATE_OUTCOME_KEYS"]
        : []),

      ...(invalidRows.length > 0
        ? ["INVALID_OUTCOME_ROWS"]
        : []),

      ...(orderingViolations.length > 0
        ? ["HORIZON_ORDERING_VIOLATION"]
        : []),
    ];

  const status =
    outcomes.length === 0
      ? "WAITING_FOR_OUTCOME_ROWS"
      : failed.length === 0
        ? "OUTCOME_INTEGRITY_VERIFIED"
        : "OUTCOME_INTEGRITY_FAILED";

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1",

    integrityStatus:
      status,

    counts: {
      outcomes:
        outcomes.length,

      sessions:
        bySession.size,

      duplicates:
        duplicateKeys.length,

      invalidRows:
        invalidRows.length,

      orderingViolations:
        orderingViolations.length,
    },

    duplicateKeys,
    invalidRows,
    orderingViolations,

    safety: {
      readOnly:
        true,

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
      outcomes.length === 0
        ? "WAIT_FOR_MATURE_OUTCOME_ROWS"
        : failed.length === 0
          ? "BUILD_TRUE_FORWARD_OOS_SUMMARY_AND_PROMOTION_EVIDENCE"
          : "REPAIR_OUTCOME_DATA_BEFORE_SUMMARY",
  };
}

async function main() {
  const report =
    auditOutcomeRows({
      outcomes:
        [],
    });

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    report.integrityStatus ===
      "OUTCOME_INTEGRITY_FAILED"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-outcome-integrity-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_ERROR",

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
  auditOutcomeRows,
} from "./true-forward-oos-outcome-integrity-gate-v1";

function main() {
  const waiting =
    auditOutcomeRows({
      outcomes:
        [],
    });

  const valid =
    auditOutcomeRows({
      outcomes: [
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          horizon:
            "1D",

          evaluatedAt:
            "2026-10-13T06:40:00.000Z",

          qualified:
            true,

          returnRate:
            0.012,
        },
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          horizon:
            "3D",

          evaluatedAt:
            "2026-10-15T06:40:00.000Z",

          qualified:
            true,

          returnRate:
            0.021,
        },
      ],
    });

  const duplicate =
    auditOutcomeRows({
      outcomes: [
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          horizon:
            "1D",

          evaluatedAt:
            "2026-10-13T06:40:00.000Z",

          qualified:
            true,

          returnRate:
            0.01,
        },
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          horizon:
            "1D",

          evaluatedAt:
            "2026-10-13T06:41:00.000Z",

          qualified:
            true,

          returnRate:
            0.02,
        },
      ],
    });

  const ordering =
    auditOutcomeRows({
      outcomes: [
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          horizon:
            "3D",

          evaluatedAt:
            "2026-10-15T06:40:00.000Z",

          qualified:
            true,

          returnRate:
            0.02,
        },
      ],
    });

  const invalid =
    auditOutcomeRows({
      outcomes: [
        {
          sourceTradingDate:
            "bad",

          targetSessionDate:
            "2026-10-08",

          horizon:
            "9D",

          evaluatedAt:
            null,

          qualified:
            null,

          returnRate:
            Number.NaN,
        },
      ],
    });

  const checks = {
    waitingSafe:
      waiting.integrityStatus ===
      "WAITING_FOR_OUTCOME_ROWS",

    validPasses:
      valid.integrityStatus ===
      "OUTCOME_INTEGRITY_VERIFIED",

    duplicateBlocked:
      duplicate.integrityStatus ===
      "OUTCOME_INTEGRITY_FAILED" &&
      duplicate.failed.includes(
        "DUPLICATE_OUTCOME_KEYS",
      ),

    orderingBlocked:
      ordering.integrityStatus ===
      "OUTCOME_INTEGRITY_FAILED" &&
      ordering.failed.includes(
        "HORIZON_ORDERING_VIOLATION",
      ),

    invalidBlocked:
      invalid.integrityStatus ===
      "OUTCOME_INTEGRITY_FAILED" &&
      invalid.failed.includes(
        "INVALID_OUTCOME_ROWS",
      ),

    readOnly:
      valid.safety.readOnly ===
      true,

    noTradingSideEffects:
      valid.safety.ordersCreated ===
        0 &&
      valid.safety.positionsChanged ===
        0 &&
      valid.safety.realTradingEnabled ===
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.integrityStatus,

          valid:
            valid.counts,

          duplicate:
            duplicate.counts,

          ordering:
            ordering.counts,

          invalid:
            invalid.counts,
        },

        safety: {
          syntheticOnly:
            true,

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

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_BUILD_OUTCOME_SOURCE_BINDING",
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_CONTRACT_FAILED",

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
  "true-forward-oos-outcome-integrity-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_STATIC_FAILED",

    failed:
      ["gateExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    gateExists:
      true,

    horizonsPresent:
      source.includes(
        '"1D"'
      ) &&
      source.includes(
        '"3D"'
      ) &&
      source.includes(
        '"5D"'
      ),

    duplicateCheck:
      source.includes(
        "DUPLICATE_OUTCOME_KEYS"
      ),

    invalidRowCheck:
      source.includes(
        "INVALID_OUTCOME_ROWS"
      ),

    orderingCheck:
      source.includes(
        "HORIZON_ORDERING_VIOLATION"
      ),

    waitingGate:
      source.includes(
        "WAITING_FOR_OUTCOME_ROWS"
      ),

    summaryGate:
      source.includes(
        "BUILD_TRUE_FORWARD_OOS_SUMMARY_AND_PROMOTION_EVIDENCE"
      ),

    readOnlySurface:
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      collectorExecuted:
        false,

      databaseWrites:
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
        ? "RUN_OUTCOME_INTEGRITY_CONTRACT"
        : "REPAIR_OUTCOME_INTEGRITY_GATE_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

  fs.writeFileSync(
    AUDIT,
    auditSource,
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
      "forward-oos:outcome-integrity"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-outcome-integrity-gate-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-outcome-integrity"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-outcome-integrity-gate-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-outcome-integrity-static"
    ] =
      "node ./scripts/true-forward-oos-outcome-integrity-gate-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_INTEGRITY_GATE_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-outcome-integrity-gate-v1.ts",
        "scripts/true-forward-oos-outcome-integrity-gate-v1-contract-test.ts",
        "scripts/true-forward-oos-outcome-integrity-gate-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "BLOCK_DUPLICATE_INVALID_OR_OUT_OF_ORDER_1D_3D_5D_FORWARD_OUTCOMES",

      safety: {
        readOnly:
          true,

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

        realTradingEnabled:
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_WAITING_CHECK"
    }, null, 2));

    process.exitCode = 0;
  }
}
