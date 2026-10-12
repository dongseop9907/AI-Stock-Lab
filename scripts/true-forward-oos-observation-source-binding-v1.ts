import fs from "node:fs";
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
        !/^\d{4}-\d{2}-\d{2}$/.test(
          sourceTradingDate,
        )
      ) {
        failed.push(
          "SOURCE_TRADING_DATE_INVALID",
        );
      }

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
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
