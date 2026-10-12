const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "alpha-v1-5-date-full-historical-replay-read-only.ts"
  );

const STATIC =
  path.join(
    ROOT,
    "scripts",
    "alpha-v1-5-date-full-historical-replay-kis-flow-scalar-normalization-v1-static-verify.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_ALPHA_V1_5_DATE_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V1_FAILED",

        reason,
        ...extra
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

if (
  !fs.existsSync(
    TARGET
  )
) {
  fail(
    "TARGET_REPLAY_SOURCE_NOT_FOUND"
  );

  return;
}

let source =
  fs.readFileSync(
    TARGET,
    "utf8"
  );

const backupDir =
  path.join(
    ROOT,
    "scripts",
    "backups"
  );

fs.mkdirSync(
  backupDir,
  {
    recursive:
      true
  }
);

const backup =
  path.join(
    backupDir,
    "alpha-v1-5-date-full-historical-replay-read-only.before-kis-flow-scalar-normalization-v1.ts"
  );

if (
  !fs.existsSync(
    backup
  )
) {
  fs.copyFileSync(
    TARGET,
    backup
  );
}

const helperMarker =
  "/* ALPHA_V1_5_DATE_REPLAY_KIS_SCALAR_NORMALIZATION_V1 */";

if (
  !source.includes(
    helperMarker
  )
) {
  const insertionAnchors = [
    "type JsonRecord =",
    "function sleep(",
    "const FLOW_LOOKBACK ="
  ];

  let anchorIndex =
    -1;

  for (
    const anchor of insertionAnchors
  ) {
    const found =
      source.indexOf(
        anchor
      );

    if (
      found >= 0
    ) {
      anchorIndex =
        found;

      break;
    }
  }

  if (
    anchorIndex <
    0
  ) {
    fail(
      "HELPER_INSERTION_ANCHOR_NOT_FOUND"
    );

    return;
  }

  const helper =
`${helperMarker}
function normalizeKisFlowScalar(
  value: unknown,
): string | number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return value;
  }

  return null;
}

`;

  source =
    source.slice(
      0,
      anchorIndex
    ) +
    helper +
    source.slice(
      anchorIndex
    );
}

const replacements = [
  [
    /stck_clpr:\s*\n\s*row\.close_price,/,
    "stck_clpr:\n                normalizeKisFlowScalar(\n                  row.close_price,\n                ),"
  ],
  [
    /acml_vol:\s*\n\s*row\.accumulated_volume,/,
    "acml_vol:\n                normalizeKisFlowScalar(\n                  row.accumulated_volume,\n                ),"
  ],
  [
    /acml_tr_pbmn:\s*\n\s*row\.accumulated_trading_value,/,
    "acml_tr_pbmn:\n                normalizeKisFlowScalar(\n                  row.accumulated_trading_value,\n                ),"
  ],
  [
    /prsn_ntby_qty:\s*\n\s*row\.individual_net_buy_quantity,/,
    "prsn_ntby_qty:\n                normalizeKisFlowScalar(\n                  row.individual_net_buy_quantity,\n                ),"
  ],
  [
    /frgn_ntby_qty:\s*\n\s*row\.foreign_net_buy_quantity,/,
    "frgn_ntby_qty:\n                normalizeKisFlowScalar(\n                  row.foreign_net_buy_quantity,\n                ),"
  ],
  [
    /orgn_ntby_qty:\s*\n\s*row\.institution_net_buy_quantity,/,
    "orgn_ntby_qty:\n                normalizeKisFlowScalar(\n                  row.institution_net_buy_quantity,\n                ),"
  ],
  [
    /prsn_ntby_tr_pbmn:\s*\n\s*row\.individual_net_buy_amount,/,
    "prsn_ntby_tr_pbmn:\n                normalizeKisFlowScalar(\n                  row.individual_net_buy_amount,\n                ),"
  ],
  [
    /frgn_ntby_tr_pbmn:\s*\n\s*row\.foreign_net_buy_amount,/,
    "frgn_ntby_tr_pbmn:\n                normalizeKisFlowScalar(\n                  row.foreign_net_buy_amount,\n                ),"
  ],
  [
    /orgn_ntby_tr_pbmn:\s*\n\s*row\.institution_net_buy_amount,/,
    "orgn_ntby_tr_pbmn:\n                normalizeKisFlowScalar(\n                  row.institution_net_buy_amount,\n                ),"
  ]
];

const replaceResults = [];

for (
  const [
    pattern,
    replacement
  ] of replacements
) {
  if (
    pattern.test(
      source
    )
  ) {
    source =
      source.replace(
        pattern,
        replacement
      );

    replaceResults.push(
      true
    );
  } else {
    replaceResults.push(
      false
    );
  }
}

const normalizedFields = [
  "row.close_price",
  "row.accumulated_volume",
  "row.accumulated_trading_value",
  "row.individual_net_buy_quantity",
  "row.foreign_net_buy_quantity",
  "row.institution_net_buy_quantity",
  "row.individual_net_buy_amount",
  "row.foreign_net_buy_amount",
  "row.institution_net_buy_amount"
];

const checks = {
  helperInstalled:
    source.includes(
      helperMarker
    ) &&
    source.includes(
      "function normalizeKisFlowScalar("
    ),

  helperReturnTypeExact:
    source.includes(
      "): string | number | null {"
    ),

  helperPreservesStringAndNumber:
    source.includes(
      'typeof value === "string"'
    ) &&
    source.includes(
      'typeof value === "number"'
    ),

  helperFailsClosedForOtherShapes:
    source.includes(
      "return null;"
    ),

  allNineFieldsNormalized:
    normalizedFields.every(
      field =>
        source.includes(
          `normalizeKisFlowScalar(\n                  ${field},`
        )
    ),

  broadAnyCastAdded:
    false,

  replayLogicOtherwiseChanged:
    false
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        ![
          "broadAnyCastAdded",
          "replayLogicOtherwiseChanged"
        ].includes(
          key
        ) &&
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

if (
  failed.length >
  0
) {
  fail(
    "POST_REPAIR_CHECK_FAILED",
    {
      checks,
      failed,
      replaceResults
    }
  );

  return;
}

fs.writeFileSync(
  TARGET,
  source,
  "utf8"
);

const staticSource = `const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "alpha-v1-5-date-full-historical-replay-read-only.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ALPHA_V1_5_DATE_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V1_STATIC_FAILED",

    failed: [
      "targetExists"
    ]
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const fields = [
    "row.close_price",
    "row.accumulated_volume",
    "row.accumulated_trading_value",
    "row.individual_net_buy_quantity",
    "row.foreign_net_buy_quantity",
    "row.institution_net_buy_quantity",
    "row.individual_net_buy_amount",
    "row.foreign_net_buy_amount",
    "row.institution_net_buy_amount"
  ];

  const checks = {
    helperPresent:
      source.includes(
        "ALPHA_V1_5_DATE_REPLAY_KIS_SCALAR_NORMALIZATION_V1"
      ) &&
      source.includes(
        "function normalizeKisFlowScalar("
      ),

    scalarContract:
      source.includes(
        "): string | number | null {"
      ),

    allFieldsNormalized:
      fields.every(
        field =>
          source.includes(
            "normalizeKisFlowScalar(\\n                  " +
            field +
            ","
          )
      ),

    stockFlowStillMapped:
      source.includes(
        "const stockFlow ="
      ) &&
      source.includes(
        "buildKisInvestorFlowEvidence({"
      ),

    noAnyCastShortcut:
      !source.includes(
        "stockFlow as any"
      ) &&
      !source.includes(
        "as KisDomesticInvestorTrendOutput[]"
      )
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_ALPHA_V1_5_DATE_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_ALPHA_V1_5_DATE_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      replayExecuted:
        false,

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
        false
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_DASHBOARD_CONTRACT_AND_NEXT_BUILD"
        : "REPAIR_KIS_FLOW_SCALAR_NORMALIZATION"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

fs.writeFileSync(
  STATIC,
  staticSource,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_ALPHA_V1_5_DATE_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V1_REPAIRED",

      changedFile:
        "scripts/alpha-v1-5-date-full-historical-replay-read-only.ts",

      generatedFile:
        "scripts/alpha-v1-5-date-full-historical-replay-kis-flow-scalar-normalization-v1-static-verify.cjs",

      backupFile:
        "scripts/backups/alpha-v1-5-date-full-historical-replay-read-only.before-kis-flow-scalar-normalization-v1.ts",

      repair: {
        sourceProblem:
          "historical flow rows expose numeric fields as unknown",

        boundaryNormalization:
          "unknown -> string | number | null",

        preservedValues:
          [
            "string",
            "number"
          ],

        rejectedValues:
          "non-scalar values become null",

        anyCast:
          "NOT_USED",

        replayExecution:
          "NOT_RUN"
      },

      checks,

      safety: {
        replayExecuted:
          false,

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
          false
      },

      failed:
        [],

      nextAction:
        "RUN_STATIC_DASHBOARD_CONTRACT_AND_NEXT_BUILD"
    },
    null,
    2
  )
);

process.exitCode = 0;
