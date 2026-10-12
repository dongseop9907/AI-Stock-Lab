import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const RPC_NAME =
  "execute_paper_protective_sell_v2";

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out: string[] = [];

  for (
    const entry of
      fs.readdirSync(
        dir,
        {
          withFileTypes: true,
        },
      )
  ) {
    const abs =
      path.join(
        dir,
        entry.name,
      );

    if (entry.isDirectory()) {
      if (
        [
          "node_modules",
          ".next",
          ".git",
          "dist",
          "build",
          "backups",
        ].includes(
          entry.name,
        )
      ) {
        continue;
      }

      out.push(
        ...walk(abs),
      );
      continue;
    }

    if (
      entry.isFile() &&
      /\.(sql|ts|tsx|js|cjs|mjs)$/.test(
        entry.name,
      )
    ) {
      out.push(abs);
    }
  }

  return out;
}

function rel(abs: string) {
  return path
    .relative(
      ROOT,
      abs,
    )
    .replaceAll(
      "\\",
      "/",
    );
}

function contextWindows(
  text: string,
  needles: RegExp[],
  radius = 55,
) {
  const lines =
    text.split(/\r?\n/);

  const indexes =
    lines
      .map(
        (
          line,
          index,
        ) =>
          needles.some(
            regex =>
              regex.test(
                line,
              ),
          )
            ? index
            : -1,
      )
      .filter(
        index =>
          index >= 0,
      );

  const ranges:
    Array<{
      start: number;
      end: number;
    }> = [];

  for (const index of indexes) {
    const start =
      Math.max(
        0,
        index - radius,
      );

    const end =
      Math.min(
        lines.length - 1,
        index + radius,
      );

    const last =
      ranges.at(-1);

    if (
      last &&
      start <=
        last.end + 2
    ) {
      last.end =
        Math.max(
          last.end,
          end,
        );
    }
    else {
      ranges.push({
        start,
        end,
      });
    }
  }

  return ranges.map(
    range => ({
      startLine:
        range.start + 1,

      endLine:
        range.end + 1,

      lines:
        lines
          .slice(
            range.start,
            range.end + 1,
          )
          .map(
            (
              line,
              offset,
            ) => ({
              line:
                range.start +
                offset +
                1,

              text:
                line,
            }),
          ),
    }),
  );
}

const migrationFiles =
  walk(
    path.join(
      ROOT,
      "supabase",
      "migrations",
    ),
  )
    .filter(
      file =>
        file.endsWith(
          ".sql",
        ),
    );

const rpcMigrations =
  migrationFiles
    .map(
      abs => {
        const text =
          fs.readFileSync(
            abs,
            "utf8",
          );

        if (
          !text.includes(
            RPC_NAME,
          )
        ) {
          return null;
        }

        const signature =
          text.match(
            new RegExp(
              `create\\s+or\\s+replace\\s+function\\s+public\\.${RPC_NAME}\\s*\\(([\\s\\S]*?)\\)\\s*returns`,
              "i",
            ),
          )?.[1]?.trim() ??
          null;

        const argNames =
          signature
            ? [
                ...signature.matchAll(
                  /\b(p_[a-z0-9_]+)\b/gi,
                ),
              ]
                .map(
                  match =>
                    match[1],
                )
                .filter(
                  (
                    value,
                    index,
                    all,
                  ) =>
                    all.indexOf(
                      value,
                    ) ===
                    index,
                )
            : [];

        const hasProvenanceArg =
          argNames.some(
            name =>
              /provenance|snapshot|meta|risk|orderbook|impact|spread|quote/i.test(
                name,
              ),
          );

        const writeTargets =
          [
            ...text.matchAll(
              /(?:insert\s+into|update)\s+(?:public\.)?([a-z0-9_]+)/gi,
            ),
          ]
            .map(
              match =>
                match[1],
            )
            .filter(
              (
                value,
                index,
                all,
              ) =>
                all.indexOf(
                  value,
                ) ===
                index,
            );

        const provenanceColumns =
          [
            ...text.matchAll(
              /\b([a-z0-9_]*(?:source|snapshot|provenance|metadata|meta|risk|impact|spread|quote)[a-z0-9_]*)\b/gi,
            ),
          ]
            .map(
              match =>
                match[1],
            )
            .filter(
              value =>
                !/^p_/i.test(
                  value,
                ),
            )
            .filter(
              (
                value,
                index,
                all,
              ) =>
                all.indexOf(
                  value,
                ) ===
                index,
            );

        return {
          file:
            rel(abs),

          signature,

          argNames,

          hasProvenanceArg,

          writeTargets,

          provenanceColumns,

          contexts:
            contextWindows(
              text,
              [
                new RegExp(
                  RPC_NAME,
                  "i",
                ),
                /p_execution_source/i,
                /execution_source/i,
                /execution_price_source/i,
                /execution_risk_snapshot/i,
                /provenance/i,
                /jsonb_build_object/i,
                /paper_trades?/i,
                /paper_positions?/i,
              ],
              70,
            ),
        };
      },
    )
    .filter(
      (
        row,
      ): row is NonNullable<
        typeof row
      > =>
        row !==
        null,
    );

const callerFiles = [
  "lib/trading/check-stop-losses.ts",
  "lib/trading/update-trailing-stops.ts",
];

const callers =
  callerFiles.map(
    file => {
      const abs =
        path.join(
          ROOT,
          file,
        );

      const exists =
        fs.existsSync(
          abs,
        );

      const text =
        exists
          ? fs.readFileSync(
              abs,
              "utf8",
            )
          : "";

      const rpcMatch =
        text.match(
          new RegExp(
            `\\.rpc\\(\\s*"${RPC_NAME}"\\s*,\\s*\\{([\\s\\S]*?)\\}\\s*,?\\s*\\)`,
            "m",
          ),
        );

      const argsBody =
        rpcMatch?.[1]?.trim() ??
        null;

      const argNames =
        argsBody
          ? [
              ...argsBody.matchAll(
                /\b(p_[a-z0-9_]+)\s*:/gi,
              ),
            ]
              .map(
                match =>
                  match[1],
              )
          : [];

      return {
        file,
        exists,
        rpcCallFound:
          rpcMatch !==
          null,
        argNames,
        argsBody,
        sendsOnlyPriceSourceForProvenance:
          argNames.includes(
            "p_execution_source",
          ) &&
          !argNames.some(
            name =>
              /provenance|snapshot|meta|risk|orderbook|impact|spread|quote/i.test(
                name,
              ),
          ),
        contexts:
          contextWindows(
            text,
            [
              new RegExp(
                RPC_NAME,
              ),
              /p_execution_source/,
              /protectiveExecution\./,
            ],
            45,
          ),
      };
    },
  );

const resolverFile =
  path.join(
    ROOT,
    "lib",
    "trading",
    "resolve-protective-sell-execution-realism-v2.ts",
  );

const resolverText =
  fs.existsSync(
    resolverFile,
  )
    ? fs.readFileSync(
        resolverFile,
        "utf8",
      )
    : "";

const resolverReturn =
  resolverText.match(
    /return\s*\{([\s\S]*?)\};\s*\n\}/m,
  )?.[1]?.trim() ??
  null;

const resolverReturnsOrderbookProvenance =
  Boolean(
    resolverReturn &&
    /orderbook|serverQuoteAgeMs|serverAcceptedHour|session|freshnessBlocker/i.test(
      resolverReturn,
    ),
  );

let classification =
  "INCONCLUSIVE";

if (
  rpcMigrations.length >
    0 &&
  rpcMigrations.every(
    row =>
      !row.hasProvenanceArg,
  ) &&
  callers.every(
    row =>
      row.rpcCallFound &&
      row.sendsOnlyPriceSourceForProvenance,
  ) &&
  !resolverReturnsOrderbookProvenance
) {
  classification =
    "SELL_V2_PERSISTS_EXECUTION_SOURCE_ONLY_FULL_PROVENANCE_BINDING_MISSING";
}
else if (
  rpcMigrations.some(
    row =>
      row.hasProvenanceArg,
  )
) {
  classification =
    "SELL_RPC_ALREADY_HAS_PROVENANCE_ARG_REVIEW_BINDING";
}

const checks = {
  rpcMigrationFound:
    rpcMigrations.length >
    0,

  bothRuntimeCallersFound:
    callers.length ===
      2 &&
    callers.every(
      row =>
        row.exists &&
        row.rpcCallFound,
    ),

  sourceOnly:
    true,
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, ok]) =>
        ok !== true,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length ===
          0
          ? "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_PERSISTENCE_PROBE_PASS"
          : "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_PERSISTENCE_PROBE_FAIL",

      classification,

      rpcMigrations,

      callers,

      resolver: {
        returnBlock:
          resolverReturn,

        returnsOrderbookProvenance:
          resolverReturnsOrderbookProvenance,
      },

      interpretation: {
        target:
          "Determine whether execute_paper_protective_sell_v2 can atomically persist BUY-equivalent SELL execution provenance.",

        ifSourceOnly:
          "Prefer a thin V3 wrapper around protective SELL V2 plus resolver metadata exposure, preserving current exit semantics.",

        ifExistingProvenanceArg:
          "Reuse existing RPC surface instead of adding a new function.",
      },

      safety: {
        readOnly:
          true,
        sourceFilesWritten:
          0,
        databaseReads:
          0,
        databaseWrites:
          0,
        externalApiCalls:
          0,
        ordersCreated:
          0,
        ordersExecuted:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      checks,
      failed,

      nextGate:
        failed.length ===
          0
          ? "DESIGN_SELL_PROVENANCE_V3_OR_REUSE_EXISTING_RPC"
          : "REPAIR_SELL_PERSISTENCE_PROBE",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length ===
    0
    ? 0
    : 1;
