const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "paper-orderbook-execution-provenance-v1-focused-probe.ts"
);

if (!fs.existsSync(TARGET)) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_FOCUSED_PROBE_V2_REPAIR_FAIL",
        reason:
          "FOCUSED_PROBE_NOT_FOUND",
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

  const oldRegex = `  exec.text.match(
    /await\\s+supabase\\.rpc\\(\\s*"execute_paper_buy_order_with_execution_price_v2"\\s*,\\s*\\{([\\s\\S]*?)\\}\\s*\\)/m,
  );`;

  const newRegex = `  exec.text.match(
    /await\\s+supabase\\.rpc\\s*\\(\\s*"execute_paper_buy_order_with_execution_price_v2"\\s*,\\s*\\{([\\s\\S]*?)\\}\\s*,?\\s*\\)\\s*;/m,
  );`;

  if (!before.includes(oldRegex)) {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_FOCUSED_PROBE_V2_REPAIR_FAIL",
          reason:
            "EXPECTED_CALLER_REGEX_ANCHOR_NOT_FOUND",
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
        oldRegex,
        newRegex
      );

    const backupDir = path.join(
      ROOT,
      "scripts",
      "backups",
      "paper-orderbook-execution-provenance-v1-focused-v2"
    );

    fs.mkdirSync(
      backupDir,
      {
        recursive: true,
      }
    );

    const backup = path.join(
      backupDir,
      "paper-orderbook-execution-provenance-v1-focused-probe.ts"
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
            "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_FOCUSED_PROBE_V2_REPAIRED",

          target:
            "scripts/paper-orderbook-execution-provenance-v1-focused-probe.ts",

          repair: {
            previousFailure:
              "rpcCallerFound=false",

            rootCause:
              "The probe regex did not tolerate the multiline supabase.rpc(...) call shape used by execute-paper-order.ts.",

            corrected:
              "Caller regex now accepts multiline formatting and optional trailing comma before closing parenthesis.",

            productionSourceWrites:
              0,
          },

          safety: {
            probeOnly:
              true,
            databaseReads:
              0,
            databaseWrites:
              0,
            externalApiCalls:
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
            "RERUN_FOCUSED_PROVENANCE_PROBE",
        },
        null,
        2
      )
    );

    process.exitCode = 0;
  }
}
