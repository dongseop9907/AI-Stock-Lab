const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const CONTRACT =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-automation-binding-v1-contract-test.ts"
  );

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_BINDING_EXISTING_CONTRACT_COMPAT_PROBE_V1_FAILED",
        reason,
        ...extra,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

if (!fs.existsSync(CONTRACT)) {
  fail("CONTRACT_TEST_NOT_FOUND");
} else {
  const text =
    fs.readFileSync(
      CONTRACT,
      "utf8"
    );

  const lines =
    text.split(/\r?\n/);

  const dateLines = [];
  const joinLines = [];
  const statusLines = [];
  const runCalls = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line = lines[i];

    if (
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(
        line
      )
    ) {
      dateLines.push({
        line: i + 1,
        text: line.trim(),
      });
    }

    if (
      /\.join\s*\(/.test(
        line
      )
    ) {
      joinLines.push({
        line: i + 1,
        text: line.trim(),
      });
    }

    if (
      /status\s*===|status\s*!==|\.status/.test(
        line
      )
    ) {
      statusLines.push({
        line: i + 1,
        text: line.trim(),
      });
    }

    if (
      /runTrueForwardOosAutomationBindingV1\s*\(/.test(
        line
      )
    ) {
      runCalls.push({
        line: i + 1,
        text: line.trim(),
      });
    }
  }

  const report = {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_BINDING_EXISTING_CONTRACT_COMPAT_PROBE_V1_COMPLETE",

    dateLines:
      dateLines.slice(0, 30),

    joinLines:
      joinLines.slice(0, 30),

    statusLines:
      statusLines.slice(0, 40),

    runCalls:
      runCalls.slice(0, 20),

    safety: {
      readOnly:
        true,
      filesModified:
        0,
      databaseReads:
        0,
      databaseWrites:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
      realTradingEnabled:
        false,
    },

    nextGate:
      "REPAIR_EXISTING_BINDING_CONTRACT_FOR_CANONICAL_KRX_GUARD",
  };

  fs.mkdirSync(
    path.join(
      ROOT,
      "logs"
    ),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "true-forward-oos-binding-existing-contract-compat-probe-v1.json"
    ),
    JSON.stringify(
      report,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        dateLines:
          report.dateLines,

        joinLines:
          report.joinLines,

        statusLines:
          report.statusLines.slice(
            0,
            20
          ),

        nextGate:
          report.nextGate,
      },
      null,
      2
    )
  );

  process.exitCode = 0;
}
