const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "scripts/model-shadow-outcome-pipeline-binding-v1-positive-path.ts";

const abs =
  path.resolve(
    root,
    rel,
  );

if (!fs.existsSync(abs)) {
  throw new Error(
    `TARGET_MISSING:${rel}`,
  );
}

const before =
  fs.readFileSync(
    abs,
    "utf8",
  );

const oldText =
  `recommended_quantity:
            0,`;

const newText =
  `recommended_quantity:
            1,`;

if (
  before.includes(
    newText,
  )
) {
  console.log(
    JSON.stringify(
      {
        status:
          "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_POSITIVE_PATH_QUANTITY_ALREADY_FIXED",
        file:
          rel,
        recommendedQuantity:
          1,
        signalStatus:
          "SKIPPED",
        riskCapable:
          false,
      },
      null,
      2,
    ),
  );

  process.exit(0);
}

if (
  !before.includes(
    oldText,
  )
) {
  throw new Error(
    "EXPECTED_RECOMMENDED_QUANTITY_ZERO_ANCHOR_NOT_FOUND",
  );
}

const after =
  before.replace(
    oldText,
    newText,
  );

fs.writeFileSync(
  abs,
  after,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_POSITIVE_PATH_QUANTITY_FIXED",
      file:
        rel,
      change:
        "recommended_quantity 0 -> 1",
      why:
        "SATISFY_AI_ENTRY_SIGNALS_RECOMMENDED_QUANTITY_CHECK",
      safety: {
        signalStatus:
          "SKIPPED",
        orderId:
          null,
        riskCapable:
          false,
        orderCreation:
          false,
        positionChange:
          false,
        promotionChange:
          false,
        controlsChange:
          false,
        realTradingEnable:
          false,
      },
      nextAction:
        "RERUN_POSITIVE_PATH",
    },
    null,
    2,
  ),
);
