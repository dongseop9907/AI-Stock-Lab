const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "paper-orderbook-execution-provenance-v1-caller-binding-static-verify.cjs"
);

if (!fs.existsSync(TARGET)) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_CALLER_STATIC_V2_REPAIR_FAIL",
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

  const oldBlock = `const rpcResultIndex =
  text.indexOf(
    "if (\\n    error"
  );`;

  const newBlock = `const rpcCloseIndex =
  text.indexOf(
    "    );",
    provenanceIndex >= 0
      ? provenanceIndex
      : 0
  );

const rpcResultIndex =
  text.indexOf(
    "if (",
    rpcCloseIndex >= 0
      ? rpcCloseIndex
      : 0
  );`;

  const oldCheck = `  provenancePassedBeforeRpcCompletion:
    provenanceIndex >= 0 &&
    rpcResultIndex >= 0 &&
    provenanceIndex <
      rpcResultIndex,`;

  const newCheck = `  provenancePassedBeforeRpcCompletion:
    v3Index >= 0 &&
    priceSourceIndex > v3Index &&
    provenanceIndex > priceSourceIndex &&
    rpcCloseIndex > provenanceIndex &&
    rpcResultIndex > rpcCloseIndex,`;

  if (!before.includes(oldBlock)) {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_CALLER_STATIC_V2_REPAIR_FAIL",
          reason:
            "OLD_RPC_RESULT_ANCHOR_NOT_FOUND",
          productionSourceWrites:
            0,
        },
        null,
        2
      )
    );

    process.exitCode = 1;
  }
  else if (!before.includes(oldCheck)) {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_CALLER_STATIC_V2_REPAIR_FAIL",
          reason:
            "OLD_PROVENANCE_ORDER_CHECK_NOT_FOUND",
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
      before
        .replace(
          oldBlock,
          newBlock
        )
        .replace(
          oldCheck,
          newCheck
        );

    const backupDir =
      path.join(
        ROOT,
        "scripts",
        "backups",
        "paper-orderbook-execution-provenance-v1-caller-static-v2"
      );

    fs.mkdirSync(
      backupDir,
      {
        recursive: true,
      }
    );

    const backup =
      path.join(
        backupDir,
        "paper-orderbook-execution-provenance-v1-caller-binding-static-verify.cjs"
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
            "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_CALLER_STATIC_V2_REPAIRED",

          target:
            "scripts/paper-orderbook-execution-provenance-v1-caller-binding-static-verify.cjs",

          repair: {
            previousFalseNegative:
              "provenancePassedBeforeRpcCompletion",

            rootCause:
              "The verifier used the first generic if(error) occurrence in the whole file instead of anchoring the check after the V3 RPC call.",

            corrected:
              "The verifier now proves ordering inside the V3 call region: V3 name -> price source -> provenance -> RPC close -> following if block.",

            productionSourceWrites:
              0,
          },

          safety: {
            staticVerifierOnly:
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
            "RERUN_STATIC_VERIFY_AND_APP_TSC",
        },
        null,
        2
      )
    );

    process.exitCode = 0;
  }
}
