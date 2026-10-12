export type OutcomeHorizon =
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
        !/^\d{4}-\d{2}-\d{2}$/.test(
          source,
        )
      ) {
        failed.push(
          "SOURCE_DATE_INVALID",
        );
      }

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
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
