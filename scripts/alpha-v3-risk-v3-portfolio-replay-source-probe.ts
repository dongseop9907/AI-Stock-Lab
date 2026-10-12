import fs from "node:fs";
import path from "node:path";

const VERSION =
  "ALPHA_V3_RISK_V3_PORTFOLIO_REPLAY_SOURCE_PROBE_V1";

const ROOT =
  process.cwd();

const JSON_FILES = [
  "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
  "logs/alpha-v3-exit-v3-baseline-replay.json",
  "logs/alpha-v3-exit-v3-policy-grid.json",
  "logs/alpha-v3-exit-v3-policy-analysis.json",
  "logs/alpha-v3-extended-pricevolume-top1-history.json",
];

const SOURCE_FILES = [
  "scripts/alpha-v3-exit-v3-baseline-replay.ts",
  "scripts/alpha-v3-exit-v3-policy-grid.ts",
  "scripts/alpha-v3-exit-v3-policy-analysis.ts",
];

function safeReadJson(
  rel: string,
): unknown | null {
  const file =
    path.resolve(
      ROOT,
      rel,
    );

  if (
    !fs.existsSync(
      file,
    )
  ) {
    return null;
  }

  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8",
    ),
  );
}

function primitivePreview(
  value: unknown,
): unknown {
  if (
    value === null ||
    typeof value ===
      "string" ||
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {
    return value;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return {
      type:
        "array",
      length:
        value.length,
    };
  }

  if (
    typeof value ===
      "object"
  ) {
    return {
      type:
        "object",
      keys:
        Object.keys(
          value as
            Record<
              string,
              unknown
            >,
        ).slice(
          0,
          30,
        ),
    };
  }

  return typeof value;
}

function summarizeObject(
  value: unknown,
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(
      value,
    )
  ) {
    return null;
  }

  const obj =
    value as
      Record<
        string,
        unknown
      >;

  return Object.fromEntries(
    Object.entries(
      obj,
    )
      .slice(
        0,
        40,
      )
      .map(
        (
          [
            key,
            val,
          ],
        ) => [
          key,
          primitivePreview(
            val,
          ),
        ],
      ),
  );
}

interface CandidateArray {
  path: string;
  length: number;
  sampleKeys: string[];
  firstSample:
    Record<
      string,
      unknown
    > |
    null;
  lastSample:
    Record<
      string,
      unknown
    > |
    null;
}

function compactTradeLike(
  value: unknown,
): Record<
  string,
  unknown
> | null {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(
      value,
    )
  ) {
    return null;
  }

  const obj =
    value as
      Record<
        string,
        unknown
      >;

  const preferred = [
    "sourceTradingDate",
    "targetSessionDate",
    "tradingDate",
    "entryDate",
    "entryPrice",
    "entryObservedAt",
    "stockCode",
    "stock_code",
    "complete",
    "qualified",
    "filled",
    "maxPremium",
    "initialStopPrice",
    "finalStopPrice",
    "realizedReturn",
    "holdingDays",
    "exit",
    "policy",
    "correctedEntry",
    "minuteCoverage",
    "limitPolicies",
  ];

  const result:
    Record<
      string,
      unknown
    > =
    {};

  for (
    const key
    of preferred
  ) {
    if (
      key in obj
    ) {
      const valueAtKey =
        obj[
          key
        ];

      if (
        key ===
          "limitPolicies" &&
        Array.isArray(
          valueAtKey,
        )
      ) {
        result[
          key
        ] =
          valueAtKey
            .filter(
              (
                row,
              ) => {
                if (
                  !row ||
                  typeof row !==
                    "object"
                ) {
                  return false;
                }

                const r =
                  row as
                    Record<
                      string,
                      unknown
                    >;

                return (
                  Number(
                    r.maxPremium,
                  ) ===
                  0.01
                );
              },
            )
            .slice(
              0,
              2,
            );

        continue;
      }

      result[
        key
      ] =
        valueAtKey;
    }
  }

  if (
    Object.keys(
      result,
    ).length ===
    0
  ) {
    return Object.fromEntries(
      Object.entries(
        obj,
      ).slice(
        0,
        15,
      ),
    );
  }

  return result;
}

function findCandidateArrays(
  value: unknown,
  currentPath =
    "$",
  depth =
    0,
  output:
    CandidateArray[] =
    [],
): CandidateArray[] {
  if (
    depth >
    7
  ) {
    return output;
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    if (
      value.length >
        0 &&
      value.some(
        (
          item,
        ) =>
          item &&
          typeof item ===
            "object" &&
          !Array.isArray(
            item,
          ),
      )
    ) {
      const first =
        value.find(
          (
            item,
          ) =>
            item &&
            typeof item ===
              "object" &&
            !Array.isArray(
              item,
            ),
        );

      const last =
        [...value]
          .reverse()
          .find(
            (
              item,
            ) =>
              item &&
              typeof item ===
                "object" &&
              !Array.isArray(
                item,
              ),
          );

      output.push({
        path:
          currentPath,

        length:
          value.length,

        sampleKeys:
          first &&
          typeof first ===
            "object"
            ? Object.keys(
                first as
                  Record<
                    string,
                    unknown
                  >,
              ).slice(
                0,
                40,
              )
            : [],

        firstSample:
          compactTradeLike(
            first,
          ),

        lastSample:
          compactTradeLike(
            last,
          ),
      });
    }

    for (
      let i = 0;
      i <
      Math.min(
        value.length,
        3,
      );
      i += 1
    ) {
      findCandidateArrays(
        value[
          i
        ],
        currentPath +
          "[" +
          String(
            i,
          ) +
          "]",
        depth +
          1,
        output,
      );
    }

    return output;
  }

  if (
    value &&
    typeof value ===
      "object"
  ) {
    for (
      const [
        key,
        child,
      ]
      of Object.entries(
        value as
          Record<
            string,
            unknown
          >,
      )
    ) {
      findCandidateArrays(
        child,
        currentPath +
          "." +
          key,
        depth +
          1,
        output,
      );
    }
  }

  return output;
}

function extractSourceSnippets(
  rel: string,
) {
  const file =
    path.resolve(
      ROOT,
      rel,
    );

  if (
    !fs.existsSync(
      file,
    )
  ) {
    return {
      file:
        rel,
      exists:
        false,
      snippets:
        [],
    };
  }

  const lines =
    fs.readFileSync(
      file,
      "utf8",
    )
      .replace(
        /\r\n/g,
        "\n",
      )
      .split(
        "\n",
      );

  const terms = [
    "const POLICIES",
    "TREND_FOLLOW",
    "FIXED_STOP_4PCT",
    "function simulate",
    "simulateExit",
    "entryPremiumCap",
    "maxHoldingDays",
    "market_daily_bars",
    "correctedEntry",
    "limitPolicies",
    "sampleResults",
    "policySummary",
    "results:",
  ];

  const snippets =
    [];

  for (
    const term
    of terms
  ) {
    const index =
      lines.findIndex(
        (
          line,
        ) =>
          line.includes(
            term,
          ),
      );

    if (
      index <
      0
    ) {
      continue;
    }

    const from =
      Math.max(
        0,
        index -
          5,
      );

    const to =
      Math.min(
        lines.length,
        index +
          18,
      );

    snippets.push({
      term,

      line:
        index +
        1,

      text:
        lines
          .slice(
            from,
            to,
          )
          .map(
            (
              line,
              offset,
            ) =>
              String(
                from +
                  offset +
                  1,
              ) +
              ": " +
              line,
          )
          .join(
            "\n",
          ),
    });
  }

  return {
    file:
      rel,

    exists:
      true,

    lineCount:
      lines.length,

    snippets,
  };
}

const json =
  JSON_FILES.map(
    (
      rel,
    ) => {
      const value =
        safeReadJson(
          rel,
        );

      if (
        value ===
        null
      ) {
        return {
          file:
            rel,
          exists:
            false,
        };
      }

      const objSummary =
        summarizeObject(
          value,
        );

      const candidateArrays =
        findCandidateArrays(
          value,
        )
          .filter(
            (
              row,
            ) =>
              row.length >=
                2 ||
              /results|trades|replay|policy|session/i.test(
                row.path,
              ),
          )
          .slice(
            0,
            30,
          );

      return {
        file:
          rel,

        exists:
          true,

        topLevel:
          objSummary,

        candidateArrays,
      };
    },
  );

const checkpoint =
  safeReadJson(
    "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
  ) as
    Record<
      string,
      unknown
    > |
    null;

let checkpointSpecific:
  unknown =
  null;

if (
  checkpoint &&
  Array.isArray(
    checkpoint.results,
  )
) {
  const rows =
    checkpoint
      .results as
      unknown[];

  checkpointSpecific = {
    count:
      rows.length,

    first:
      compactTradeLike(
        rows[
          0
        ],
      ),

    middle:
      compactTradeLike(
        rows[
          Math.floor(
            rows.length /
            2,
          )
        ],
      ),

    last:
      compactTradeLike(
        rows[
          rows.length -
            1
        ],
      ),
  };
}

const report = {
  status:
    "ALPHA_V3_RISK_V3_PORTFOLIO_REPLAY_SOURCE_PROBE_COMPLETE",

  version:
    VERSION,

  jsonFiles:
    json,

  checkpointSpecific,

  sourceFiles:
    SOURCE_FILES.map(
      extractSourceSnippets,
    ),

  decisionSupport: {
    preferredImplementation:
      "REUSE_EXISTING_ENTRY_CHECKPOINT_AND_EXIT_SIMULATOR_WITH_CHRONOLOGICAL_PORTFOLIO_STATE",

    requiredForDirectLogJoin: [
      "entryDate",
      "stockCode",
      "entryPrice",
      "exitDate",
      "exitPrice",
      "realizedReturn",
    ],

    ifFullExitTradeArrayMissing:
      "REGENERATE_EXIT_PATHS_FROM_EXISTING_DAILY_BAR_SIMULATOR",

    portfolioConstraintsToEnforce: [
      "maxRiskPerTradeRate=0.005",
      "maxPositionRate=0.10",
      "maxPortfolioExposureRate=0.60",
      "maxSectorExposureRate=0.25",
      "maxOpenPositions=8",
      "maxAggregateOpenRiskRate=0.02",
      "dailyLossRate=0.02",
    ],

    exitCandidates:
      [
        "TREND_FOLLOW",
        "FIXED_STOP_4PCT",
        "BASELINE",
      ],

    initialCapital:
      10_000_000,

    sizing:
      "RISK_AND_POSITION_LIMIT_AWARE_NOT_FIXED_TRADE_RETURN_AVERAGE",

    sameSampleWarning:
      true,
  },

  safety: {
    databaseReads:
      0,

    databaseWrites:
      0,

    kisRequests:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    productionChanged:
      false,
  },

  nextGate:
    "BUILD_ALPHA_V3_RISK_V3_PORTFOLIO_REPLAY_FROM_CONFIRMED_SOURCE_SCHEMA",
};

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);
