const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-producer-probe-control-flow-detail-v1.cjs"
);

const BACKUP = path.join(
  ROOT,
  "scripts",
  "backups",
  "true-forward-oos-producer-probe-control-flow-detail-v1.before-syntax-repair-v2.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_CONTROL_FLOW_DETAIL_SYNTAX_REPAIR_V2_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail("TARGET_DIAGNOSTIC_SCRIPT_NOT_FOUND");
} else {
  fs.mkdirSync(
    path.dirname(BACKUP),
    { recursive: true }
  );

  if (!fs.existsSync(BACKUP)) {
    fs.copyFileSync(
      TARGET,
      BACKUP
    );
  }

  let source =
    fs.readFileSync(
      TARGET,
      "utf8"
    );

  const start =
    source.indexOf(
      "function window("
    );

  const end =
    source.indexOf(
      "\nfunction findAll(",
      start
    );

  if (
    start < 0 ||
    end < 0
  ) {
    fail(
      "WINDOW_FUNCTION_BOUNDARY_NOT_FOUND",
      { start, end }
    );
  } else {
    const replacement = `function window(
  lines,
  center,
  before = 12,
  after = 18,
) {
  const start =
    Math.max(
      1,
      center - before,
    );

  const end =
    Math.min(
      lines.length,
      center + after,
    );

  const selected = [];

  for (
    let lineNumber = start;
    lineNumber <= end;
    lineNumber++
  ) {
    selected.push({
      line:
        lineNumber,

      text:
        lines[
          lineNumber - 1
        ],
    });
  }

  return {
    startLine:
      start,

    endLine:
      end,

    lines:
      selected,
  };
}
`;

    source =
      source.slice(
        0,
        start
      ) +
      replacement +
      source.slice(
        end
      );

    fs.writeFileSync(
      TARGET,
      source,
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_CONTROL_FLOW_DETAIL_SYNTAX_REPAIR_V2_INSTALLED",

      changed:
        true,

      target:
        "scripts/true-forward-oos-producer-probe-control-flow-detail-v1.cjs",

      backup:
        "scripts/backups/true-forward-oos-producer-probe-control-flow-detail-v1.before-syntax-repair-v2.cjs",

      repair:
        "REPLACE_BROKEN_WINDOW_MAP_WITH_SIMPLE_FOR_LOOP",

      productSourceChanges:
        0,

      safety: {
        producerSourceChanged:
          false,
        producerExecuted:
          false,
        databaseReads:
          0,
        databaseWrites:
          0,
        producerFileWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false
      },

      nextAction:
        "NODE_CHECK_THEN_RERUN_READ_ONLY_CONTROL_FLOW_PROBE"
    }, null, 2));

    process.exitCode = 0;
  }
}
