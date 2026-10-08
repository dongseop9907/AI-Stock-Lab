import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "ALPHA_V3_COMMITTED_RISK_TARGETED_PROBE_V1";

const TARGETS = [
  "lib/trading/paper-order-service.ts",
  "lib/trading/risk-manager.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "supabase/migrations/002_paper_trading.sql",
  "supabase/migrations/003_execute_paper_orders.sql",
];

const OUTPUT = path.resolve(
  ROOT,
  "logs/alpha-v3-committed-risk-targeted-probe.json",
);

const NEEDLES = [
  "paper_order_requests",
  "execute_paper_buy_order",
  "status",
  "RISK_APPROVED",
  "REQUESTED",
  "SUBMITTED",
  "PARTIAL_FILLED",
  "FILLED",
  "REJECTED",
  "CANCELLED",
  "CANCELED",
  "EXPIRED",
  "FAILED",
  "aggregate",
  "risk",
  "stop",
  "quantity",
  "requested_quantity",
  "approved_quantity",
  "entry_price",
  "proposed_stop",
  "stop_price",
  "model_id",
  "created_at",
  "updated_at",
  "rpc(",
];

function read(rel: string) {
  const file = path.resolve(ROOT, rel);

  if (!fs.existsSync(file)) {
    return {
      file: rel,
      exists: false,
      lineCount: 0,
      snippets: [],
    };
  }

  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const hitIndexes = new Set<number>();

  for (let i = 0; i < lines.length; i += 1) {
    if (
      NEEDLES.some((needle) =>
        lines[i].toLowerCase().includes(needle.toLowerCase()),
      )
    ) {
      hitIndexes.add(i);
    }
  }

  const windows: Array<{
    startLine: number;
    endLine: number;
    text: string;
  }> = [];

  const sorted = [...hitIndexes].sort((a, b) => a - b);

  let currentStart: number | null = null;
  let currentEnd: number | null = null;

  for (const index of sorted) {
    const start = Math.max(0, index - 5);
    const end = Math.min(lines.length, index + 12);

    if (
      currentStart === null ||
      currentEnd === null ||
      start > currentEnd
    ) {
      if (currentStart !== null && currentEnd !== null) {
        windows.push({
          startLine: currentStart + 1,
          endLine: currentEnd,
          text: lines
            .slice(currentStart, currentEnd)
            .map((line, offset) => `${currentStart! + offset + 1}: ${line}`)
            .join("\n"),
        });
      }

      currentStart = start;
      currentEnd = end;
    } else {
      currentEnd = Math.max(currentEnd, end);
    }
  }

  if (currentStart !== null && currentEnd !== null) {
    windows.push({
      startLine: currentStart + 1,
      endLine: currentEnd,
      text: lines
        .slice(currentStart, currentEnd)
        .map((line, offset) => `${currentStart! + offset + 1}: ${line}`)
        .join("\n"),
    });
  }

  return {
    file: rel,
    exists: true,
    lineCount: lines.length,
    snippets: windows.slice(0, 30),
  };
}

function extractTableBlock(text: string, table: string) {
  const lower = text.toLowerCase();
  const index = lower.indexOf(`create table ${table.toLowerCase()}`);

  if (index < 0) {
    const alt = lower.indexOf(`create table if not exists ${table.toLowerCase()}`);
    if (alt < 0) return null;
  }

  const start =
    index >= 0
      ? index
      : lower.indexOf(`create table if not exists ${table.toLowerCase()}`);

  const semi = text.indexOf(";", start);

  return text
    .slice(start, semi >= 0 ? semi + 1 : start + 5000)
    .trim();
}

function extractFunctionBlock(text: string, name: string) {
  const patterns = [
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${name}\\b`,
      "i",
    ),
    new RegExp(
      `create\\s+function\\s+${name}\\b`,
      "i",
    ),
  ];

  let matchIndex = -1;

  for (const pattern of patterns) {
    const match = pattern.exec(text);

    if (match) {
      matchIndex = match.index;
      break;
    }
  }

  if (matchIndex < 0) return null;

  const dollarEnd = text.indexOf("$$;", matchIndex);

  if (dollarEnd >= 0) {
    return text.slice(matchIndex, dollarEnd + 3).trim();
  }

  const nextCreate = text
    .toLowerCase()
    .indexOf("\ncreate ", matchIndex + 20);

  return text
    .slice(
      matchIndex,
      nextCreate >= 0 ? nextCreate : matchIndex + 12000,
    )
    .trim();
}

const files = TARGETS.map(read);

const migration2Path = path.resolve(
  ROOT,
  "supabase/migrations/002_paper_trading.sql",
);

const migration3Path = path.resolve(
  ROOT,
  "supabase/migrations/003_execute_paper_orders.sql",
);

const migration2Text =
  fs.existsSync(migration2Path)
    ? fs.readFileSync(migration2Path, "utf8")
    : "";

const migration3Text =
  fs.existsSync(migration3Path)
    ? fs.readFileSync(migration3Path, "utf8")
    : "";

const tableBlock =
  extractTableBlock(
    migration2Text,
    "paper_order_requests",
  );

const executeRpc =
  extractFunctionBlock(
    migration3Text,
    "execute_paper_buy_order",
  );

const serviceText =
  fs.existsSync(path.resolve(ROOT, TARGETS[0]))
    ? fs.readFileSync(path.resolve(ROOT, TARGETS[0]), "utf8")
    : "";

const executorText =
  fs.existsSync(path.resolve(ROOT, TARGETS[2]))
    ? fs.readFileSync(path.resolve(ROOT, TARGETS[2]), "utf8")
    : "";

const riskText =
  fs.existsSync(path.resolve(ROOT, TARGETS[1]))
    ? fs.readFileSync(path.resolve(ROOT, TARGETS[1]), "utf8")
    : "";

const statuses = [
  ...new Set(
    [serviceText, executorText, migration2Text, migration3Text]
      .flatMap((text) =>
        [...text.matchAll(
          /["'`](REQUESTED|RISK_APPROVED|SUBMITTED|PARTIAL_FILLED|FILLED|REJECTED|CANCELLED|CANCELED|EXPIRED|FAILED|PENDING|APPROVED|OPEN|CLOSED)["'`]/g,
        )].map((m) => m[1]),
      ),
  ),
].sort();

const rpcCalls = [
  ...new Set(
    [serviceText, executorText]
      .flatMap((text) =>
        [...text.matchAll(
          /\.rpc\(\s*["'`]([^"'`]+)["'`]/g,
        )].map((m) => m[1]),
      ),
  ),
].sort();

const report = {
  status:
    "ALPHA_V3_COMMITTED_RISK_TARGETED_PROBE_COMPLETE",

  version:
    VERSION,

  files,

  schema: {
    paperOrderRequestsTableBlock:
      tableBlock,

    executePaperBuyOrderRpc:
      executeRpc,
  },

  signals: {
    statuses,
    rpcCalls,

    serviceMentionsRiskApproved:
      /RISK_APPROVED/.test(serviceText),

    executorMentionsRiskApproved:
      /RISK_APPROVED/.test(executorText),

    executeRpcFound:
      Boolean(executeRpc),

    paperOrderTableFound:
      Boolean(tableBlock),

    riskManagerHasAggregateRisk:
      /aggregateOpenRisk|currentAggregateOpenRisk|maxAggregateOpenRiskRate/.test(
        riskText,
      ),

    explicitReservationColumns:
      tableBlock
        ? /reserved|reservation|committed/i.test(tableBlock)
        : false,
  },

  implementationDecision: {
    readyForCommittedRiskMigration:
      Boolean(tableBlock) &&
      Boolean(executeRpc),

    preferredAtomicBoundary:
      Boolean(executeRpc)
        ? "SUPABASE_SQL_RPC"
        : "UNKNOWN",

    nextGate:
      Boolean(tableBlock) &&
      Boolean(executeRpc)
        ? "BUILD_ATOMIC_COMMITTED_RISK_RESERVATION"
        : "TRACE_MISSING_ORDER_SCHEMA_OR_RPC",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    productionChanged: false,
  },

  outputFile:
    "logs/alpha-v3-committed-risk-targeted-probe.json",
};

fs.mkdirSync(
  path.dirname(OUTPUT),
  { recursive: true },
);

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(report, null, 2) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: report.status,
      paperOrderTableFound:
        report.signals.paperOrderTableFound,
      executeRpcFound:
        report.signals.executeRpcFound,
      statuses:
        report.signals.statuses,
      rpcCalls:
        report.signals.rpcCalls,
      serviceMentionsRiskApproved:
        report.signals.serviceMentionsRiskApproved,
      executorMentionsRiskApproved:
        report.signals.executorMentionsRiskApproved,
      riskManagerHasAggregateRisk:
        report.signals.riskManagerHasAggregateRisk,
      explicitReservationColumns:
        report.signals.explicitReservationColumns,
      preferredAtomicBoundary:
        report.implementationDecision.preferredAtomicBoundary,
      nextGate:
        report.implementationDecision.nextGate,
      outputFile:
        report.outputFile,
    },
    null,
    2,
  ),
);
