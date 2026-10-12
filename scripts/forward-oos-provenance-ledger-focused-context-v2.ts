import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const RANGES = [
  {
    file:
      "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
    ranges: [
      [120, 190],
      [220, 320],
      [385, 430],
    ],
  },
  {
    file:
      "lib/research/get-forward-oos-observability-dashboard-v1.ts",
    ranges: [
      [1, 165],
      [300, 525],
      [527, 720],
    ],
  },
  {
    file:
      "scripts/forward-oos-data-quality-integrity-monitor-v1.ts",
    ranges: [
      [1, 145],
      [378, 470],
      [730, 990],
    ],
  },
] as const;

function readRange(
  rel: string,
  start: number,
  end: number,
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
      start,
      end,
      lines: [],
    };
  }

  const all =
    fs.readFileSync(
      abs,
      "utf8",
    )
    .split(/\r?\n/);

  const from =
    Math.max(
      1,
      start,
    );

  const to =
    Math.min(
      all.length,
      end,
    );

  return {
    file: rel,
    exists: true,
    totalLines:
      all.length,
    start:
      from,
    end:
      to,
    lines:
      all
        .slice(
          from - 1,
          to,
        )
        .map(
          (text, index) => ({
            line:
              from + index,
            text,
          }),
        ),
  };
}

const sections =
  RANGES.flatMap(
    spec =>
      spec.ranges.map(
        ([start, end]) =>
          readRange(
            spec.file,
            start,
            end,
          ),
      ),
  );

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_FORWARD_OOS_PROVENANCE_LEDGER_FOCUSED_CONTEXT_V2_COMPLETE",

      purpose:
        "Capture exact source ranges required for safe verified-ledger append and fail-closed session filtering.",

      sections,

      targetPatch: {
        sharedHelper:
          "lib/research/forward-oos-verified-provenance-ledger-v1.ts",

        ledger:
          "logs/true-forward-oos-controlled-producer-evidence-ledger-v1.jsonl",

        evidenceWrapper:
          "append verified run only after all controlled evidence checks pass",

        dashboard:
          "filter canonical session rows to ledger-verified CONTROLLED_NORMAL provenance",

        integrityMonitor:
          "BLOCK canonical unverified provenance; WAIT remains normal with zero sessions",
      },

      safety: {
        readOnly:
          true,
        filesWritten:
          0,
        networkRequests:
          0,
        databaseReads:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        promotionExecuted:
          false,
        realTradingEnabled:
          false,
      },

      nextGate:
        "PATCH_VERIFIED_PROVENANCE_LEDGER_V1",
    },
    null,
    2,
  ),
);

process.exitCode = 0;
