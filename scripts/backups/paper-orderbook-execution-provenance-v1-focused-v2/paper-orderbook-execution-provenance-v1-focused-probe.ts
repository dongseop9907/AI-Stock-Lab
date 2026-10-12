import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGETS = [
  "lib/trading/execute-paper-order.ts",
  "supabase/migrations/20261009000100_paper_execution_realism_v2_buy_partial_fill.sql",
  "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql",
] as const;

function read(rel: string) {
  const abs =
    path.join(
      ROOT,
      rel,
    );

  if (!fs.existsSync(abs)) {
    return {
      file:
        rel,
      exists:
        false,
      text:
        "",
      lines:
        [] as string[],
    };
  }

  const text =
    fs.readFileSync(
      abs,
      "utf8",
    );

  return {
    file:
      rel,
    exists:
      true,
    text,
    lines:
      text.split(/\r?\n/),
  };
}

function windows(
  lines: string[],
  patterns: RegExp[],
  radius = 38,
) {
  const indexes: number[] = [];

  lines.forEach(
    (
      line,
      index,
    ) => {
      if (
        patterns.some(
          pattern =>
            pattern.test(
              line,
            ),
        )
      ) {
        indexes.push(index);
      }
    },
  );

  const raw =
    indexes.map(
      index => ({
        start:
          Math.max(
            0,
            index - radius,
          ),

        end:
          Math.min(
            lines.length - 1,
            index + radius,
          ),
      }),
    );

  const merged:
    Array<{
      start: number;
      end: number;
    }> = [];

  for (
    const current of raw
  ) {
    const last =
      merged.at(-1);

    if (
      last &&
      current.start <=
        last.end + 2
    ) {
      last.end =
        Math.max(
          last.end,
          current.end,
        );
    }
    else {
      merged.push({
        ...current,
      });
    }
  }

  return merged.map(
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
              text,
              offset,
            ) => ({
              line:
                range.start +
                offset +
                1,

              text,
            }),
          ),
    }),
  );
}

const exec =
  read(
    TARGETS[0],
  );

const realismMigration =
  read(
    TARGETS[1],
  );

const gapMigration =
  read(
    TARGETS[2],
  );

const execWindows =
  windows(
    exec.lines,
    [
      /execute_paper_buy_order_with_execution_price_v2/,
      /execution_risk_snapshot/,
      /execution_price_source/,
      /realismDecision/,
      /orderbookQuote/,
      /p_execution_price/,
      /p_fill_quantity/,
      /p_broker_fee/,
      /return\s*\{/,
    ],
    46,
  );

const realismRpcWindows =
  windows(
    realismMigration.lines,
    [
      /create or replace function public\.execute_paper_buy_order_with_execution_price_v2/i,
      /update public\.paper_order_requests/i,
      /execution_price_source/i,
      /execution_risk_snapshot/i,
      /p_execution_price/i,
      /p_fill_quantity/i,
      /p_broker_fee/i,
      /jsonb_build_object/i,
    ],
    50,
  );

const gapRpcWindows =
  windows(
    gapMigration.lines,
    [
      /execution_price_source/i,
      /execution_risk_snapshot/i,
      /jsonb_build_object/i,
    ],
    42,
  );

const rpcSignatureMatch =
  realismMigration.text.match(
    /create\s+or\s+replace\s+function\s+public\.execute_paper_buy_order_with_execution_price_v2\s*\(([\s\S]*?)\)\s*returns/i,
  );

const rpcSignature =
  rpcSignatureMatch?.[1]
    ?.trim() ??
  null;

const execRpcCallMatch =
  exec.text.match(
    /await\s+supabase\.rpc\(\s*"execute_paper_buy_order_with_execution_price_v2"\s*,\s*\{([\s\S]*?)\}\s*\)/m,
  );

const rpcArgsBody =
  execRpcCallMatch?.[1]
    ?.trim() ??
  null;

const successRiskSnapshotWrites =
  realismMigration.lines
    .map(
      (
        text,
        index,
      ) => ({
        line:
          index + 1,
        text,
      }),
    )
    .filter(
      row =>
        /execution_risk_snapshot\s*=/i.test(
          row.text,
        ),
    );

const successPriceSourceWrites =
  realismMigration.lines
    .map(
      (
        text,
        index,
      ) => ({
        line:
          index + 1,
        text,
      }),
    )
    .filter(
      row =>
        /execution_price_source\s*=/i.test(
          row.text,
        ),
    );

const rpcArgNames =
  rpcSignature
    ? [
        ...rpcSignature.matchAll(
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

const callArgNames =
  rpcArgsBody
    ? [
        ...rpcArgsBody.matchAll(
          /\b(p_[a-z0-9_]+)\s*:/gi,
        ),
      ]
        .map(
          match =>
            match[1],
        )
    : [];

const rpcSupportsProvenance =
  rpcArgNames.some(
    name =>
      /source|snapshot|risk|quote|impact|spread|orderbook/i.test(
        name,
      ),
  );

const callerSendsProvenance =
  callArgNames.some(
    name =>
      /source|snapshot|risk|quote|impact|spread|orderbook/i.test(
        name,
      ),
  );

const hardcodedMarketSnapshotClose =
  successPriceSourceWrites.some(
    row =>
      /MARKET_SNAPSHOT_CLOSE/.test(
        row.text,
      ),
  );

const classification =
  hardcodedMarketSnapshotClose &&
  !rpcSupportsProvenance &&
  !callerSendsProvenance
    ? "SUCCESS_RPC_HARDCODES_LEGACY_PRICE_SOURCE_AND_ACCEPTS_NO_PROVENANCE"
    : hardcodedMarketSnapshotClose
      ? "SUCCESS_RPC_STILL_HARDCODES_LEGACY_PRICE_SOURCE_REVIEW_PROVENANCE_ARGS"
      : rpcSupportsProvenance &&
        callerSendsProvenance
        ? "SUCCESS_RPC_ALREADY_ACCEPTS_PROVENANCE_REVIEW_JSON_CONTENT"
        : "INCONCLUSIVE";

const checks = {
  executionFileExists:
    exec.exists,

  realismMigrationExists:
    realismMigration.exists,

  gapMigrationExists:
    gapMigration.exists,

  rpcSignatureFound:
    rpcSignature !==
    null,

  rpcCallerFound:
    rpcArgsBody !==
    null,

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
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_FOCUSED_PROBE_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_FOCUSED_PROBE_FAIL",

      classification,

      rpc: {
        signature:
          rpcSignature,

        signatureArgNames:
          rpcArgNames,

        callerArgsBody:
          rpcArgsBody,

        callerArgNames:
          callArgNames,

        supportsProvenance:
          rpcSupportsProvenance,

        callerSendsProvenance:
          callerSendsProvenance,

        hardcodedMarketSnapshotClose,
      },

      successPersistence: {
        executionPriceSourceWrites:
          successPriceSourceWrites,

        executionRiskSnapshotWrites:
          successRiskSnapshotWrites,
      },

      contexts: {
        executePaperOrder:
          execWindows,

        realismV2Migration:
          realismRpcWindows,

        gapSlippageMigration:
          gapRpcWindows,
      },

      interpretation: {
        target:
          "Successful PAPER BUY fills should persist actual execution provenance generated by Realism V2 and the orderbook adapter.",

        preferredIfLegacyHardcoded:
          "Introduce a narrow V3 RPC or explicit post-RPC persistence path that accepts execution source + provenance snapshot without changing fill decision semantics.",

        avoid:
          [
            "Do not overwrite historical rows.",
            "Do not synthesize trades.",
            "Do not enable real trading.",
            "Do not blindly edit migration history.",
          ],
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
          ? "IMPLEMENT_SUCCESSFUL_PAPER_EXECUTION_PROVENANCE_BINDING_V1"
          : "REPAIR_PROVENANCE_FOCUSED_PROBE",
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
