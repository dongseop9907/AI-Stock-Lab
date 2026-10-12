const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const targets = [
  "lib/trading/paper-order-service.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "lib/trading/execute-paper-order.ts",
  "lib/trading/committed-risk-reservation.ts",
  "lib/trading/read-only-buy-risk-preflight.ts",
  "app/api/orders/paper/execute/route.ts",
  "app/api/orders/paper/execute-approved/route.ts",
  "supabase/migrations/002_paper_trading.sql",
  "supabase/migrations/003_execute_paper_orders.sql",
  "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql",
  "supabase/migrations/20261008000400_execute_paper_buy_order_committed_risk_lock.sql",
  "supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql",
  "supabase/migrations/20261008001600_kill_switch_db_create_fill_guards_v1.sql",
  "supabase/migrations/20261008001700_data_freshness_db_create_fill_guards_v1.sql",
];

const needles = [
  "entry_price",
  "stop_price",
  "reserved_risk_amount",
  "approved_quantity",
  "executed_quantity",
  "filled_quantity",
  "fill",
  "execution",
  "close_price",
  "market_snapshots",
  "RISK_APPROVED",
  "FILLED",
  "execute_paper",
  "rpc(",
  "create_paper_buy_order_with_committed_risk_v3",
  "execute_paper_buy_order",
  "current_stop_price",
  "average_price",
];

function walkContext(
  lines,
  index,
  radius = 8,
) {
  const start =
    Math.max(
      0,
      index -
      radius,
    );

  const end =
    Math.min(
      lines.length,
      index +
      radius +
      1,
    );

  return {
    startLine:
      start +
      1,

    endLine:
      end,

    text:
      lines
        .slice(
          start,
          end,
        )
        .map(
          (
            line,
            offset,
          ) =>
            `${start + offset + 1}: ${line}`,
        )
        .join(
          "\n",
        ),
  };
}

const files =
  [];

for (
  const rel of
    targets
) {
  const abs =
    path.resolve(
      root,
      rel,
    );

  if (
    !fs.existsSync(
      abs,
    )
  ) {
    files.push({
      file:
        rel,
      exists:
        false,
    });

    continue;
  }

  const text =
    fs.readFileSync(
      abs,
      "utf8",
    );

  const lines =
    text.split(
      /\r?\n/,
    );

  const hits =
    [];

  for (
    let i = 0;
    i <
    lines.length;
    i +=
    1
  ) {
    const lower =
      lines[i]
        .toLowerCase();

    for (
      const needle of
        needles
    ) {
      if (
        lower.includes(
          needle
            .toLowerCase(),
        )
      ) {
        hits.push({
          needle,
          line:
            i +
            1,
          context:
            walkContext(
              lines,
              i,
            ),
        });
      }
    }
  }

  files.push({
    file:
      rel,

    exists:
      true,

    lineCount:
      lines.length,

    hits:
      hits.slice(
        0,
        120,
      ),
  });
}

const report = {
  status:
    "ALPHA_V3_GAP_SLIPPAGE_RISK_V1_EXECUTION_SURFACE_PROBE_COMPLETE",

  version:
    "ALPHA_V3_GAP_SLIPPAGE_RISK_V1_EXECUTION_SURFACE_PROBE",

  files,

  requiredBindingFacts: {
    plannedEntryPriceSource:
      "paper_order_requests.entry_price",

    stopPriceSource:
      "paper_order_requests.stop_price",

    reservedRiskSource:
      "paper_order_requests.reserved_risk_amount",

    mustResolve:
      [
        "ACTUAL_EXECUTION_PRICE_SOURCE",
        "FILL_QUANTITY_SOURCE",
        "BUY_FILL_RPC_NAME_AND_ARGUMENTS",
        "WHERE_POSITION_AVERAGE_PRICE_IS_COMPUTED",
        "WHERE_RISK_RESERVATION_TRANSFERS_TO_POSITION_RISK",
      ],
  },

  intendedBinding:
    [
      "APPROVED_ORDER_EXECUTOR_BEFORE_BUY_FILL",
      "SINGLE_ORDER_EXECUTOR_BEFORE_BUY_FILL",
      "DB_FILL_RPC_DEFENSE_IN_DEPTH_AFTER_EXECUTION_PRICE_IS_KNOWN",
      "PROTECTIVE_EXIT_DIAGNOSTIC_ONLY_NEVER_BLOCK",
    ],

  safety: {
    databaseReads:
      0,
    databaseWrites:
      0,
    networkCalls:
      0,
    ordersCreated:
      0,
    ordersChanged:
      0,
    positionsChanged:
      0,
    productionChanged:
      false,
  },

  nextGate:
    "BIND_GAP_SLIPPAGE_GUARD_TO_CONFIRMED_EXECUTION_AND_DB_FILL_SURFACES",
};

fs.mkdirSync(
  path.resolve(
    root,
    "logs",
  ),
  {
    recursive:
      true,
  },
);

fs.writeFileSync(
  path.resolve(
    root,
    "logs/alpha-v3-gap-slippage-risk-v1-execution-surface-probe.json",
  ),
  JSON.stringify(
    report,
    null,
    2,
  ) +
  "\n",
  "utf8",
);

const existingFiles =
  report.files.filter(
    (row) =>
      row.exists ===
      true,
  );

const missingFiles =
  report.files.filter(
    (row) =>
      row.exists !==
      true,
  );

const hitSummary =
  existingFiles.map(
    (row) => ({
      file:
        row.file,

      hitCount:
        Array.isArray(
          row.hits,
        )
          ? row.hits.length
          : 0,

      matchedNeedles:
        [
          ...new Set(
            (
              row.hits ??
              []
            ).map(
              (hit) =>
                hit.needle,
            ),
          ),
        ],
    }),
  );

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      version:
        report.version,

      filesChecked:
        report.files.length,

      existingFiles:
        existingFiles.length,

      missingFiles:
        missingFiles.map(
          (row) =>
            row.file,
        ),

      hitSummary,

      requiredBindingFacts:
        report.requiredBindingFacts,

      intendedBinding:
        report.intendedBinding,

      safety:
        report.safety,

      fullLogFile:
        "logs/alpha-v3-gap-slippage-risk-v1-execution-surface-probe.json",

      nextGate:
        report.nextGate,
    },
    null,
    2,
  ),
);
