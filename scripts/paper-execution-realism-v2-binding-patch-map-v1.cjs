const fs = require("fs");
const path = require("path");

const root = process.cwd();

function read(rel) {
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`MISSING:${rel}`);
  }
  return fs.readFileSync(abs, "utf8");
}

function numberedExcerpt(source, startIndex, endIndex) {
  const before = source.slice(0, startIndex);
  const startLine = before.split(/\r?\n/).length;
  const chunk = source.slice(startIndex, endIndex);
  return chunk.split(/\r?\n/).map((text, i) => ({
    line: startLine + i,
    text: text.trimEnd(),
  }));
}

function findFunctionBlock(source, name) {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
    "i",
  );

  const match = re.exec(source);

  if (!match) return null;

  const start = match.index;

  const next = source
    .slice(start + match[0].length)
    .search(
      /\n\s*(?:create\s+or\s+replace\s+function|grant\s+execute|comment\s+on\s+function|commit;)/i,
    );

  const end =
    next >= 0
      ? start +
        match[0].length +
        next
      : Math.min(
          source.length,
          start + 16000,
        );

  return numberedExcerpt(
    source,
    start,
    end,
  );
}

function findAround(source, needle, beforeChars = 1800, afterChars = 3500) {
  const index = source.indexOf(needle);

  if (index < 0) return null;

  return numberedExcerpt(
    source,
    Math.max(0, index - beforeChars),
    Math.min(
      source.length,
      index + needle.length + afterChars,
    ),
  );
}

const executorRel =
  "lib/trading/execute-paper-order.ts";

const migrationRel =
  "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql";

const executor =
  read(executorRel);

const migration =
  read(migrationRel);

const executorRpc =
  findAround(
    executor,
    "execute_paper_buy_order_with_execution_price_v1",
    2800,
    4800,
  );

const executorSafeExecution =
  findAround(
    executor,
    "resolveSafePaperBuyExecution",
    2200,
    3800,
  );

const fillRpc =
  findFunctionBlock(
    migration,
    "execute_paper_buy_order_with_execution_price_v1",
  );

const legacyFillRpc =
  findFunctionBlock(
    migration,
    "execute_paper_buy_order",
  );

const importantPatterns = [
  "approved_quantity",
  "filled_quantity",
  "status",
  "FILLED",
  "RISK_APPROVED",
  "reserved_risk_amount",
  "paper_positions",
  "average_price",
  "cash_balance",
  "execution_price",
];

function summarize(lines) {
  if (!lines) return [];

  return lines.filter((row) =>
    importantPatterns.some((term) =>
      row.text.includes(term)
    )
  );
}

const output = {
  status:
    "PAPER_EXECUTION_REALISM_V2_BINDING_PATCH_MAP_V1_COMPLETE",

  surfaces: {
    executorRpcFound:
      Boolean(executorRpc),

    safeExecutionFound:
      Boolean(executorSafeExecution),

    fillRpcFound:
      Boolean(fillRpc),

    legacyFillRpcFound:
      Boolean(legacyFillRpc),
  },

  compact: {
    executorRpc:
      summarize(executorRpc).slice(0, 28),

    safeExecution:
      summarize(executorSafeExecution).slice(0, 22),

    fillRpc:
      summarize(fillRpc).slice(0, 40),

    legacyFillRpc:
      summarize(legacyFillRpc).slice(0, 30),
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    sourceFilesModified: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    realTradingChanged: false,
  },

  fullDetails:
    "logs/paper-execution-realism-v2-binding-patch-map-v1.json",

  nextGate:
    "IMPLEMENT_V2_EXECUTOR_AND_DB_PARTIAL_FILL_BINDING",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(root, output.fullDetails),
  JSON.stringify(
    {
      ...output,
      full: {
        executorRpc,
        executorSafeExecution,
        fillRpc,
        legacyFillRpc,
      },
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: output.status,
      surfaces: output.surfaces,
      compact: output.compact,
      nextGate: output.nextGate,
      details: output.fullDetails,
    },
    null,
    2,
  ),
);
