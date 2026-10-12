const fs = require("fs");
const path = require("path");

const root = process.cwd();

const probePath = path.resolve(
  root,
  "scripts/alpha-v3-gap-slippage-risk-v1-execution-surface-probe.cjs",
);

if (!fs.existsSync(probePath)) {
  throw new Error(
    "GAP_SLIPPAGE_EXECUTION_SURFACE_PROBE_NOT_FOUND",
  );
}

const before = fs.readFileSync(
  probePath,
  "utf8",
);

const oldPrint = `console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);`;

const newPrint = `const existingFiles =
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
);`;

let after = before;

if (before.includes(oldPrint)) {
  after = before.replace(
    oldPrint,
    newPrint,
  );
} else if (
  before.includes("fullLogFile:") &&
  before.includes("hitSummary")
) {
  // idempotent
} else {
  throw new Error(
    "EXPECTED_PROBE_PRINT_BLOCK_NOT_FOUND",
  );
}

fs.writeFileSync(
  probePath,
  after,
  "utf8",
);

const finalText = fs.readFileSync(
  probePath,
  "utf8",
);

const checks = {
  fullReportStillWritten:
    finalText.includes(
      "alpha-v3-gap-slippage-risk-v1-execution-surface-probe.json",
    ),

  compactHitSummary:
    finalText.includes(
      "hitSummary",
    ),

  missingFilesSummary:
    finalText.includes(
      "missingFiles",
    ),

  requiredBindingFactsPreserved:
    finalText.includes(
      "requiredBindingFacts",
    ),

  fullConsoleDumpRemoved:
    !finalText.includes(
      `console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);`,
    ),
};

const failed = Object.entries(checks)
  .filter(([, value]) => !value)
  .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_GAP_SLIPPAGE_PROBE_COMPACT_OUTPUT_V1_FIXED"
          : "ALPHA_V3_GAP_SLIPPAGE_PROBE_COMPACT_OUTPUT_V1_REVIEW",

      patchedFile:
        "scripts/alpha-v3-gap-slippage-risk-v1-execution-surface-probe.cjs",

      behavior: {
        console:
          "COMPACT_SUMMARY_ONLY",
        fullDetails:
          "logs/alpha-v3-gap-slippage-risk-v1-execution-surface-probe.json",
      },

      checks,
      failed,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0,
      },
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
