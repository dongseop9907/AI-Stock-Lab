import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION =
  "ALPHA_V3_AGGREGATE_OPEN_RISK_IMPLEMENTATION_SURFACE_PROBE_V1";

const FILES = [
  "lib/trading/policy.ts",
  "lib/trading/types.ts",
  "lib/trading/risk-manager.ts",
  "lib/trading/paper-order-service.ts",
  "lib/trading/update-trailing-stops.ts",
  "lib/trading/check-stop-losses.ts",
  "lib/trading/execute-paper-order.ts",
];

const TERMS = [
  "interface RiskPolicy",
  "DEFAULT_RISK_POLICY",
  "BuyRiskInput",
  "BuyRiskResult",
  "validateBuyRisk",
  "paper_positions",
  "stop_price",
  "average_price",
  "quantity",
  "riskResult",
  "riskInput",
  "result_payload",
  "highest_price",
  "trailing",
];

function context(
  lines: string[],
  index: number,
  radius = 5,
) {
  const start =
    Math.max(0, index - radius);

  const end =
    Math.min(
      lines.length,
      index + radius + 1,
    );

  return {
    startLine:
      start + 1,

    endLine:
      end,

    text:
      lines
        .slice(start, end)
        .join("\n"),
  };
}

function scan(
  relativePath: string,
) {
  const absolute =
    path.resolve(
      ROOT,
      relativePath,
    );

  if (
    !fs.existsSync(
      absolute,
    )
  ) {
    return {
      file:
        relativePath,

      exists:
        false,

      lineCount:
        0,

      matches: [],
    };
  }

  const text =
    fs.readFileSync(
      absolute,
      "utf8",
    );

  const lines =
    text.split(
      /\r?\n/,
    );

  const matches: Array<{
    term: string;
    line: number;
    context: ReturnType<typeof context>;
  }> = [];

  for (
    let i = 0;
    i < lines.length;
    i += 1
  ) {
    for (
      const term of TERMS
    ) {
      if (
        lines[i].includes(
          term,
        )
      ) {
        matches.push({
          term,

          line:
            i + 1,

          context:
            context(
              lines,
              i,
            ),
        });

        break;
      }
    }

    if (
      matches.length >=
      40
    ) {
      break;
    }
  }

  return {
    file:
      relativePath,

    exists:
      true,

    lineCount:
      lines.length,

    matches,
  };
}

function searchRepositoryForStopPrice() {
  const targets = [
    "lib",
    "app",
    "supabase",
    "sql",
    "scripts",
  ];

  const results: Array<{
    file: string;
    line: number;
    text: string;
  }> = [];

  function walk(
    dir: string,
  ) {
    if (
      !fs.existsSync(
        dir,
      )
    ) {
      return;
    }

    const entries =
      fs.readdirSync(
        dir,
        {
          withFileTypes:
            true,
        },
      );

    for (
      const entry of entries
    ) {
      if (
        entry.name ===
          "node_modules" ||
        entry.name ===
          ".next" ||
        entry.name ===
          ".git"
      ) {
        continue;
      }

      const absolute =
        path.join(
          dir,
          entry.name,
        );

      if (
        entry.isDirectory()
      ) {
        walk(
          absolute,
        );

        continue;
      }

      if (
        !/\.(ts|tsx|js|cjs|mjs|sql)$/i.test(
          entry.name,
        )
      ) {
        continue;
      }

      let text = "";

      try {
        text =
          fs.readFileSync(
            absolute,
            "utf8",
          );
      } catch {
        continue;
      }

      const lines =
        text.split(
          /\r?\n/,
        );

      for (
        let i = 0;
        i < lines.length;
        i += 1
      ) {
        if (
          lines[i].includes(
            "stop_price",
          ) ||
          lines[i].includes(
            "paper_positions",
          )
        ) {
          results.push({
            file:
              path
                .relative(
                  ROOT,
                  absolute,
                )
                .replaceAll(
                  "\\",
                  "/",
                ),

            line:
              i + 1,

            text:
              lines[i].trim(),
          });
        }

        if (
          results.length >=
          120
        ) {
          return;
        }
      }
    }
  }

  for (
    const target of targets
  ) {
    walk(
      path.resolve(
        ROOT,
        target,
      ),
    );

    if (
      results.length >=
      120
    ) {
      break;
    }
  }

  return results;
}

const output = {
  status:
    "ALPHA_V3_AGGREGATE_OPEN_RISK_IMPLEMENTATION_SURFACE_PROBE_COMPLETE",

  version:
    VERSION,

  proposedPolicy: {
    maxAggregateOpenRiskRate:
      0.02,

    formula:
      "sum(max(0, averagePrice - stopPrice) * quantity) + proposedTradeRisk <= accountEquity * 0.02",

    missingStopHandling:
      "REJECT_NEW_RISK_APPROVAL",
  },

  files:
    FILES.map(
      scan,
    ),

  repositoryStopPriceReferences:
    searchRepositoryForStopPrice(),

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
    "IMPLEMENT_ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET",
};

console.log(
  JSON.stringify(
    output,
    null,
    2,
  ),
);
