const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "paper-orderbook-krx-session-freshness-v1-static-verify.cjs"
);

if (!fs.existsSync(TARGET)) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_ORDERBOOK_KRX_SESSION_FRESHNESS_V1_STATIC_V2_REPAIR_FAILED",
        reason:
          "STATIC_VERIFIER_NOT_FOUND",
        target:
          path.relative(ROOT, TARGET),
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}
else {
  const before =
    fs.readFileSync(
      TARGET,
      "utf8"
    );

  const oldBlock = `  protectiveSellFreshnessGateBeforeFallback:
    sell.indexOf(
      "PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED"
    ) >= 0 &&
    sell.indexOf(
      "PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED"
    ) <
      sell.indexOf(
        "protectiveFallbackUsed"
      ),`;

  const newBlock = `  protectiveSellFreshnessGateBeforeFallback:
    sell.indexOf(
      "PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED"
    ) >= 0 &&
    sell.indexOf(
      "let protectiveFallbackUsed ="
    ) >= 0 &&
    sell.indexOf(
      "PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED"
    ) <
      sell.indexOf(
        "let protectiveFallbackUsed ="
      ),`;

  if (!before.includes(oldBlock)) {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_ORDERBOOK_KRX_SESSION_FRESHNESS_V1_STATIC_V2_REPAIR_FAILED",
          reason:
            "EXPECTED_STATIC_CHECK_ANCHOR_NOT_FOUND",
          productionSourceWrites:
            0,
        },
        null,
        2
      )
    );

    process.exitCode = 1;
  }
  else {
    const after =
      before.replace(
        oldBlock,
        newBlock
      );

    const backupDir = path.join(
      ROOT,
      "scripts",
      "backups",
      "paper-orderbook-krx-session-freshness-v1-static-v2"
    );

    fs.mkdirSync(
      backupDir,
      {
        recursive: true,
      }
    );

    const backup = path.join(
      backupDir,
      "paper-orderbook-krx-session-freshness-v1-static-verify.cjs"
    );

    if (!fs.existsSync(backup)) {
      fs.writeFileSync(
        backup,
        before,
        "utf8"
      );
    }

    fs.writeFileSync(
      TARGET,
      after,
      "utf8"
    );

    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_ORDERBOOK_KRX_SESSION_FRESHNESS_V1_STATIC_V2_REPAIRED",

          target:
            "scripts/paper-orderbook-krx-session-freshness-v1-static-verify.cjs",

          repair: {
            previousFalseNegative:
              "protectiveSellFreshnessGateBeforeFallback",

            rootCause:
              'indexOf("protectiveFallbackUsed") matched the interface field before the function body.',

            correctedAnchor:
              'let protectiveFallbackUsed =',

            productionSourceWrites:
              0,
          },

          safety: {
            staticVerifierOnly:
              true,
            databaseWrites:
              0,
            ordersCreated:
              0,
            ordersExecuted:
              0,
            positionsChanged:
              0,
            realTradingEnabled:
              false,
          },

          nextAction:
            "RERUN_STATIC_VERIFY_AND_APP_TSC",
        },
        null,
        2
      )
    );

    process.exitCode = 0;
  }
}
