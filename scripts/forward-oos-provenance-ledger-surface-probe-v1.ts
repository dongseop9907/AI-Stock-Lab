import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();

const FILES = [
  "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  "lib/research/get-forward-oos-observability-dashboard-v1.ts",
  "scripts/forward-oos-data-quality-integrity-monitor-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
] as const;

const NEEDLES = [
  "evidenceRunId",
  "newSessionsCarryEvidenceRunId",
  "writeFileSync",
  "true-forward-oos-controlled-producer-evidence-run-v1.json",
  "FORWARD_FILES",
  "firstExisting",
  "sessionRows",
  "normalizedSessions",
  "controlledEvidenceCountable",
  "provenance",
  "candidateFingerprint",
  "payloadHash",
] as const;

function sha256(text: string) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function lineWindow(
  lines: string[],
  lineIndex: number,
  radius = 12,
) {
  const start =
    Math.max(
      0,
      lineIndex - radius,
    );

  const end =
    Math.min(
      lines.length,
      lineIndex + radius + 1,
    );

  return lines
    .slice(start, end)
    .map(
      (line, offset) => ({
        line:
          start + offset + 1,
        text:
          line,
      }),
    );
}

function inspect(
  rel: string,
) {
  const abs =
    path.join(
      ROOT,
      rel,
    );

  if (!fs.existsSync(abs)) {
    return {
      file: rel,
      exists: false,
    };
  }

  const text =
    fs.readFileSync(
      abs,
      "utf8",
    );

  const stat =
    fs.statSync(abs);

  const lines =
    text.split(/\r?\n/);

  const matches =
    NEEDLES.flatMap(
      needle => {
        const indexes =
          lines
            .map(
              (line, index) => ({
                line,
                index,
              }),
            )
            .filter(
              row =>
                row.line.includes(
                  needle,
                ),
            )
            .map(
              row => row.index,
            )
            .slice(
              0,
              4,
            );

        return indexes.map(
          index => ({
            needle,
            atLine:
              index + 1,
            context:
              lineWindow(
                lines,
                index,
                10,
              ),
          }),
        );
      },
    );

  return {
    file: rel,
    exists: true,
    mtime:
      stat.mtime.toISOString(),
    size:
      stat.size,
    hash:
      sha256(text),
    matches,
  };
}

const report = {
  status:
    "AI_STOCK_LAB_FORWARD_OOS_PROVENANCE_LEDGER_SURFACE_PROBE_V1_COMPLETE",

  purpose:
    "Locate exact safe patch surfaces for append-only verified provenance ledger and fail-closed dashboard/integrity filtering.",

  files:
    FILES.map(
      inspect,
    ),

  intendedContract: {
    ledgerFile:
      "logs/true-forward-oos-controlled-producer-evidence-ledger-v1.jsonl",

    verifiedEntryRule:
      "append only after controlled evidence checks pass",

    joinRule:
      "session.provenance.runId must exist in verified ledger",

    requiredSessionFields: [
      "provenance.mode=CONTROLLED_NORMAL",
      "provenance.runId",
      "candidateFingerprint",
      "integrity.algorithm=sha256",
      "integrity.payloadHash",
    ],

    dashboardPolicy:
      "count only provenance-valid sessions with verified ledger runId",

    integrityPolicy:
      "BLOCK if canonical session exists but provenance/ledger verification fails",
  },

  safety: {
    readOnly: true,
    sourceFilesWritten: 0,
    logFilesWritten: 0,
    networkRequests: 0,
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingEnabled: false,
  },

  nextGate:
    "PATCH_VERIFIED_PROVENANCE_LEDGER_WITH_EXACT_SOURCE_CONTEXT",
};

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);

process.exitCode = 0;
