import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "ALPHA_V3_COMMITTED_RISK_SQL_DEFINITION_PROBE_V1";
const OUTPUT = path.resolve(
  ROOT,
  "logs/alpha-v3-committed-risk-sql-definition-probe.json",
);

const SEARCH_ROOTS = [
  "supabase/migrations",
  "lib/trading",
  "app/api/orders/paper",
];

function walk(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }

    if (!/\.(?:sql|ts|tsx)$/i.test(entry.name)) {
      continue;
    }

    out.push(full);
  }
}

function rel(file: string) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function numbered(lines: string[], start: number, end: number) {
  return lines
    .slice(start, end)
    .map((line, offset) => `${start + offset + 1}: ${line}`)
    .join("\n");
}

function contextFor(
  text: string,
  pattern: RegExp,
  before = 8,
  after = 35,
) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const matches: Array<{
    line: number;
    text: string;
  }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) {
      matches.push({
        line: i + 1,
        text: numbered(
          lines,
          Math.max(0, i - before),
          Math.min(lines.length, i + after),
        ),
      });
    }

    pattern.lastIndex = 0;
  }

  return matches.slice(0, 20);
}

function extractCreateTable(text: string) {
  const regex =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:"?public"?|[a-zA-Z_][\w$]*)\s*\.\s*)?"?paper_order_requests"?\s*\(/ig;

  const match = regex.exec(text);

  if (!match) {
    return null;
  }

  let i = regex.lastIndex;
  let depth = 1;

  for (; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;

    if (depth === 0) {
      const semi = text.indexOf(";", i);
      return text
        .slice(
          match.index,
          semi >= 0 ? semi + 1 : i + 1,
        )
        .trim();
    }
  }

  return null;
}

function extractAlterTableBlocks(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (
      /alter\s+table\s+(?:if\s+exists\s+)?(?:(?:"?public"?|[a-zA-Z_][\w$]*)\s*\.\s*)?"?paper_order_requests"?/i.test(
        lines[i],
      )
    ) {
      let end = i + 1;

      while (end < lines.length) {
        if (lines[end - 1].includes(";")) break;
        end += 1;
      }

      blocks.push(
        numbered(
          lines,
          i,
          Math.min(lines.length, end),
        ),
      );
    }
  }

  return blocks.slice(0, 30);
}

function extractFunction(text: string) {
  const regex =
    /create\s+(?:or\s+replace\s+)?function\s+(?:(?:"?public"?|[a-zA-Z_][\w$]*)\s*\.\s*)?"?execute_paper_buy_order"?\s*\(/ig;

  const match = regex.exec(text);

  if (!match) {
    return null;
  }

  const rest = text.slice(match.index);

  const dollarTagMatch =
    rest.match(/\$[a-zA-Z_0-9]*\$/);

  if (dollarTagMatch && dollarTagMatch.index !== undefined) {
    const tag = dollarTagMatch[0];
    const bodyStart = dollarTagMatch.index;
    const second = rest.indexOf(
      tag,
      bodyStart + tag.length,
    );

    if (second >= 0) {
      const semi = rest.indexOf(";", second + tag.length);

      return rest
        .slice(
          0,
          semi >= 0 ? semi + 1 : second + tag.length,
        )
        .trim();
    }
  }

  const nextCreate = rest
    .slice(20)
    .search(/\ncreate\s+/i);

  return rest
    .slice(
      0,
      nextCreate >= 0
        ? nextCreate + 20
        : 15000,
    )
    .trim();
}

const files: string[] = [];

for (const root of SEARCH_ROOTS) {
  walk(
    path.resolve(ROOT, root),
    files,
  );
}

const findings = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");

  const hasOrderTable =
    /paper_order_requests/i.test(text);

  const hasExecuteRpc =
    /execute_paper_buy_order/i.test(text);

  const hasRiskApproved =
    /RISK_APPROVED/i.test(text);

  if (
    !hasOrderTable &&
    !hasExecuteRpc &&
    !hasRiskApproved
  ) {
    continue;
  }

  findings.push({
    file: rel(file),
    type: path.extname(file).slice(1),
    createTable:
      extractCreateTable(text),
    alterTableBlocks:
      extractAlterTableBlocks(text),
    executePaperBuyOrder:
      extractFunction(text),
    paperOrderOccurrences:
      contextFor(
        text,
        /paper_order_requests/i,
      ),
    executeRpcOccurrences:
      contextFor(
        text,
        /execute_paper_buy_order/i,
      ),
    riskApprovedOccurrences:
      contextFor(
        text,
        /RISK_APPROVED/i,
      ),
  });
}

const tableDefinitions =
  findings.filter(
    (row) => Boolean(row.createTable),
  );

const tableAlters =
  findings.filter(
    (row) => row.alterTableBlocks.length > 0,
  );

const rpcDefinitions =
  findings.filter(
    (row) => Boolean(row.executePaperBuyOrder),
  );

const serviceCandidates =
  findings.filter(
    (row) =>
      /\.(?:ts|tsx)$/i.test(row.file) &&
      (
        row.paperOrderOccurrences.length > 0 ||
        row.executeRpcOccurrences.length > 0 ||
        row.riskApprovedOccurrences.length > 0
      ),
  );

const report = {
  status:
    "ALPHA_V3_COMMITTED_RISK_SQL_DEFINITION_PROBE_COMPLETE",

  version:
    VERSION,

  scannedFileCount:
    files.length,

  signals: {
    tableDefinitionFound:
      tableDefinitions.length > 0,

    alterTableFound:
      tableAlters.length > 0,

    executeRpcDefinitionFound:
      rpcDefinitions.length > 0,

    tableDefinitionFiles:
      tableDefinitions.map((row) => row.file),

    tableAlterFiles:
      tableAlters.map((row) => row.file),

    executeRpcDefinitionFiles:
      rpcDefinitions.map((row) => row.file),

    serviceFiles:
      serviceCandidates.map((row) => row.file),
  },

  findings,

  implementationDecision: {
    readyForAtomicCommittedRisk:
      tableDefinitions.length > 0 &&
      rpcDefinitions.length > 0,

    preferredImplementation:
      tableDefinitions.length > 0 &&
      rpcDefinitions.length > 0
        ? "NEW_MIGRATION_WITH_RESERVATION_COLUMNS_AND_ATOMIC_RPC"
        : "REVIEW_EXACT_SQL_DEFINITION_LOCATIONS",

    nextGate:
      tableDefinitions.length > 0 &&
      rpcDefinitions.length > 0
        ? "BUILD_ATOMIC_COMMITTED_RISK_RESERVATION"
        : "REVIEW_SQL_DEFINITION_PROBE",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    productionChanged: false,
  },

  outputFile:
    "logs/alpha-v3-committed-risk-sql-definition-probe.json",
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
      status:
        report.status,

      tableDefinitionFound:
        report.signals.tableDefinitionFound,

      tableDefinitionFiles:
        report.signals.tableDefinitionFiles,

      alterTableFound:
        report.signals.alterTableFound,

      tableAlterFiles:
        report.signals.tableAlterFiles,

      executeRpcDefinitionFound:
        report.signals.executeRpcDefinitionFound,

      executeRpcDefinitionFiles:
        report.signals.executeRpcDefinitionFiles,

      serviceFiles:
        report.signals.serviceFiles,

      preferredImplementation:
        report.implementationDecision.preferredImplementation,

      nextGate:
        report.implementationDecision.nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2,
  ),
);
