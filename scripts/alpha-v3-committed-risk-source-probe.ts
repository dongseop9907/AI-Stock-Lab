import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "ALPHA_V3_COMMITTED_RISK_SOURCE_PROBE_V1";
const OUTPUT = path.resolve(
  ROOT,
  "logs/alpha-v3-committed-risk-source-probe.json",
);

const SEARCH_ROOTS = [
  "app",
  "lib",
  "src",
  "scripts",
  "supabase",
  "migrations",
  "db",
];

const TERMS = [
  "paper_order_requests",
  "paper_trade",
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
  "aggregateOpenRisk",
  "currentAggregateOpenRisk",
  "maxAggregateOpenRiskRate",
  "proposedTradeRiskAmount",
  "reservedRisk",
  "committedRisk",
  "riskReservation",
  "rpc(",
  ".rpc(",
];

function walk(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === ".git" ||
        entry.name === "dist" ||
        entry.name === "coverage"
      ) {
        continue;
      }

      walk(full, out);
      continue;
    }

    if (
      !/\.(?:ts|tsx|js|cjs|mjs|sql)$/.test(entry.name)
    ) {
      continue;
    }

    out.push(full);
  }
}

function rel(file: string) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function extractStatuses(text: string) {
  const values = [
    ...text.matchAll(
      /["'`](REQUESTED|RISK_APPROVED|SUBMITTED|PARTIAL_FILLED|FILLED|REJECTED|CANCELLED|CANCELED|EXPIRED|FAILED|PENDING|APPROVED|OPEN|CLOSED)["'`]/g,
    ),
  ].map((m) => m[1]);

  return [...new Set(values)].sort();
}

function extractRpcNames(text: string) {
  const values = [
    ...text.matchAll(
      /\.rpc\(\s*["'`]([^"'`]+)["'`]/g,
    ),
  ].map((m) => m[1]);

  return [...new Set(values)].sort();
}

function lineHits(lines: string[], terms: string[]) {
  const hits: Array<{
    line: number;
    term: string;
    text: string;
  }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    for (const term of terms) {
      if (
        lines[i]
          .toLowerCase()
          .includes(
            term.toLowerCase(),
          )
      ) {
        hits.push({
          line: i + 1,
          term,
          text: lines[i].trim(),
        });

        break;
      }
    }
  }

  return hits.slice(0, 200);
}

const files: string[] = [];

for (const root of SEARCH_ROOTS) {
  walk(
    path.resolve(ROOT, root),
    files,
  );
}

const matchedFiles = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

  if (
    !TERMS.some((term) =>
      text
        .toLowerCase()
        .includes(
          term.toLowerCase(),
        ),
    )
  ) {
    continue;
  }

  const lines = text.split("\n");

  matchedFiles.push({
    file: rel(file),
    lineCount: lines.length,
    statuses: extractStatuses(text),
    rpcNames: extractRpcNames(text),
    hits: lineHits(lines, TERMS),
  });
}

const orderFiles = matchedFiles.filter((row) =>
  /order|paper|trade/i.test(row.file) ||
  row.hits.some((hit) =>
    /paper_order_requests/i.test(hit.text),
  ),
);

const riskFiles = matchedFiles.filter((row) =>
  /risk/i.test(row.file) ||
  row.hits.some((hit) =>
    /aggregateOpenRisk|maxAggregateOpenRiskRate|proposedTradeRiskAmount/i.test(
      hit.text,
    ),
  ),
);

const schemaFiles = matchedFiles.filter((row) =>
  /\.sql$/i.test(row.file) ||
  /migration|schema|supabase/i.test(row.file),
);

const allStatuses = [
  ...new Set(
    matchedFiles.flatMap((row) => row.statuses),
  ),
].sort();

const allRpcNames = [
  ...new Set(
    matchedFiles.flatMap((row) => row.rpcNames),
  ),
].sort();

const hasPaperOrderTable = matchedFiles.some((row) =>
  row.hits.some((hit) =>
    /paper_order_requests/i.test(hit.text),
  ),
);

const hasReservationTerms = matchedFiles.some((row) =>
  row.hits.some((hit) =>
    /reservedRisk|committedRisk|riskReservation/i.test(hit.text),
  ),
);

const hasAggregateOpenRisk = matchedFiles.some((row) =>
  row.hits.some((hit) =>
    /aggregateOpenRisk|currentAggregateOpenRisk|maxAggregateOpenRiskRate/i.test(
      hit.text,
    ),
  ),
);

const report = {
  status:
    "ALPHA_V3_COMMITTED_RISK_SOURCE_PROBE_COMPLETE",

  version:
    VERSION,

  scannedFileCount:
    files.length,

  matchedFileCount:
    matchedFiles.length,

  signals: {
    hasPaperOrderTable,
    hasAggregateOpenRisk,
    hasReservationTerms,
    statuses: allStatuses,
    rpcNames: allRpcNames,
  },

  candidateFiles: {
    orderFiles: orderFiles.map((row) => row.file).slice(0, 30),
    riskFiles: riskFiles.map((row) => row.file).slice(0, 30),
    schemaFiles: schemaFiles.map((row) => row.file).slice(0, 30),
  },

  details: {
    orderFiles,
    riskFiles,
    schemaFiles,
  },

  requiredNextDesign: {
    formula:
      "OPEN_POSITION_STOP_RISK + ACTIVE_BUY_RESERVED_RISK <= equity * maxAggregateOpenRiskRate",

    mustReserveAt:
      "risk approval",

    mustReleaseAt: [
      "REJECTED",
      "CANCELLED/CANCELED",
      "EXPIRED",
      "FAILED",
    ],

    filledBehavior:
      "reserved risk transfers into open-position risk without double counting",

    concurrency:
      "reservation and approval must be atomic / serialized",

    idempotency:
      "same order request must not reserve risk twice",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    productionChanged: false,
  },

  nextGate:
    hasPaperOrderTable && hasAggregateOpenRisk
      ? "BUILD_COMMITTED_RISK_RESERVATION_FROM_CONFIRMED_SCHEMA"
      : "TRACE_MISSING_ORDER_OR_RISK_SOURCE",

  outputFile:
    "logs/alpha-v3-committed-risk-source-probe.json",
};

fs.mkdirSync(
  path.dirname(OUTPUT),
  { recursive: true },
);

fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    report,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: report.status,
      hasPaperOrderTable:
        report.signals.hasPaperOrderTable,
      hasAggregateOpenRisk:
        report.signals.hasAggregateOpenRisk,
      hasReservationTerms:
        report.signals.hasReservationTerms,
      statuses:
        report.signals.statuses,
      rpcNames:
        report.signals.rpcNames,
      orderFiles:
        report.candidateFiles.orderFiles,
      riskFiles:
        report.candidateFiles.riskFiles,
      schemaFiles:
        report.candidateFiles.schemaFiles,
      nextGate:
        report.nextGate,
      outputFile:
        report.outputFile,
    },
    null,
    2,
  ),
);
