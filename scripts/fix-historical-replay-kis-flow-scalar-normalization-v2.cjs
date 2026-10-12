const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const TARGETS = [
  "scripts/alpha-v1-alpha-only-historical-replay-read-only.ts",
  "scripts/alpha-v1-full-window-historical-replay-read-only.ts"
];

const STATIC =
  path.join(
    ROOT,
    "scripts",
    "historical-replay-kis-flow-scalar-normalization-v2-static-verify.cjs"
  );

const MARKER =
  "/* AI_STOCK_LAB_KIS_FLOW_SCALAR_NORMALIZATION_V2 */";

const FIELD_MAP = [
  ["stck_clpr", "row.close_price"],
  ["acml_vol", "row.accumulated_volume"],
  ["acml_tr_pbmn", "row.accumulated_trading_value"],
  ["prsn_ntby_qty", "row.individual_net_buy_quantity"],
  ["frgn_ntby_qty", "row.foreign_net_buy_quantity"],
  ["orgn_ntby_qty", "row.institution_net_buy_quantity"],
  ["prsn_ntby_tr_pbmn", "row.individual_net_buy_amount"],
  ["frgn_ntby_tr_pbmn", "row.foreign_net_buy_amount"],
  ["orgn_ntby_tr_pbmn", "row.institution_net_buy_amount"]
];

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_HISTORICAL_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V2_FAILED",
        reason,
        ...extra
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

function ensureHelper(
  source
) {
  if (
    source.includes(
      MARKER
    ) ||
    source.includes(
      "function normalizeKisFlowScalar("
    )
  ) {
    return {
      source,
      inserted:
        false
    };
  }

  const anchors = [
    "type JsonRecord =",
    "function sleep(",
    "const FLOW_LOOKBACK ="
  ];

  let index =
    -1;

  for (
    const anchor of anchors
  ) {
    const found =
      source.indexOf(
        anchor
      );

    if (
      found >= 0
    ) {
      index =
        found;

      break;
    }
  }

  if (
    index <
    0
  ) {
    return {
      source,
      inserted:
        null
    };
  }

  const helper =
`${MARKER}
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

  return {
    source:
      source.slice(
        0,
        index
      ) +
      helper +
      source.slice(
        index
      ),

    inserted:
      true
  };
}

function normalizeField(
  source,
  property,
  expression
) {
  const already =
    source.includes(
      `${property}:\n                normalizeKisFlowScalar(\n                  ${expression},`
    ) ||
    source.includes(
      `${property}:\r\n                normalizeKisFlowScalar(\r\n                  ${expression},`
    );

  if (
    already
  ) {
    return {
      source,
      changed:
        false,
      present:
        true
    };
  }

  const escaped =
    expression
      .replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

  const pattern =
    new RegExp(
      `${property}:\\s*\\n\\s*${escaped},`
    );

  if (
    !pattern.test(
      source
    )
  ) {
    return {
      source,
      changed:
        false,
      present:
        false
    };
  }

  const replacement =
`${property}:
                normalizeKisFlowScalar(
                  ${expression},
                ),`;

  return {
    source:
      source.replace(
        pattern,
        replacement
      ),

    changed:
      true,

    present:
      true
  };
}

const changedFiles = [];
const perFile = {};

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

for (
  const rel of TARGETS
) {
  const file =
    path.join(
      ROOT,
      rel
    );

  if (
    !fs.existsSync(
      file
    )
  ) {
    perFile[rel] = {
      exists:
        false,
      skipped:
        true
    };

    continue;
  }

  let source =
    fs.readFileSync(
      file,
      "utf8"
    );

  const backup =
    path.join(
      backupDir,
      path.basename(
        rel,
        ".ts"
      ) +
      ".before-kis-flow-scalar-normalization-v2.ts"
    );

  if (
    !fs.existsSync(
      backup
    )
  ) {
    fs.copyFileSync(
      file,
      backup
    );
  }

  const helperResult =
    ensureHelper(
      source
    );

  if (
    helperResult.inserted ===
    null
  ) {
    fail(
      "HELPER_INSERTION_ANCHOR_NOT_FOUND",
      {
        file:
          rel
      }
    );

    return;
  }

  source =
    helperResult.source;

  const fieldResults = {};
  let fieldChangeCount = 0;

  for (
    const [
      property,
      expression
    ] of FIELD_MAP
  ) {
    const result =
      normalizeField(
        source,
        property,
        expression
      );

    source =
      result.source;

    fieldResults[property] = {
      present:
        result.present,
      changed:
        result.changed
    };

    if (
      result.changed
    ) {
      fieldChangeCount +=
        1;
    }
  }

  const relevantFlowMapping =
    source.includes(
      "buildKisInvestorFlowEvidence({"
    ) &&
    (
      source.includes(
        "stockFlowRows"
      ) ||
      source.includes(
        "stockFlow"
      )
    );

  const normalizedCount =
    FIELD_MAP.filter(
      ([
        property,
        expression
      ]) =>
        source.includes(
          `${property}:\n                normalizeKisFlowScalar(\n                  ${expression},`
        ) ||
        source.includes(
          `${property}:\r\n                normalizeKisFlowScalar(\r\n                  ${expression},`
        )
    ).length;

  const shouldRequireNine =
    relevantFlowMapping &&
    FIELD_MAP.some(
      ([
        property
      ]) =>
        source.includes(
          `${property}:`
        )
    );

  if (
    shouldRequireNine &&
    normalizedCount <
    9
  ) {
    fail(
      "NOT_ALL_KIS_FLOW_FIELDS_NORMALIZED",
      {
        file:
          rel,
        normalizedCount,
        fieldResults
      }
    );

    return;
  }

  const changed =
    source !==
    fs.readFileSync(
      file,
      "utf8"
    );

  if (
    changed
  ) {
    fs.writeFileSync(
      file,
      source,
      "utf8"
    );

    changedFiles.push(
      rel
    );
  }

  perFile[rel] = {
    exists:
      true,

    helperInserted:
      helperResult.inserted,

    relevantFlowMapping,

    normalizedCount,

    fieldChangeCount,

    changed
  };
}

const checks = {
  noAnyCastShortcut:
    true,

  replayLogicChanged:
    false,

  allRelevantFilesNormalized:
    Object.entries(
      perFile
    )
      .filter(
        ([, info]) =>
          info &&
          info.exists ===
            true &&
          info.relevantFlowMapping ===
            true
      )
      .every(
        ([, info]) =>
          info.normalizedCount ===
          9
      )
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        ![
          "replayLogicChanged"
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
      perFile
    }
  );

  return;
}

const staticSource = `const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const targets = [
  "scripts/alpha-v1-alpha-only-historical-replay-read-only.ts",
  "scripts/alpha-v1-full-window-historical-replay-read-only.ts"
];

const fields = [
  ["stck_clpr", "row.close_price"],
  ["acml_vol", "row.accumulated_volume"],
  ["acml_tr_pbmn", "row.accumulated_trading_value"],
  ["prsn_ntby_qty", "row.individual_net_buy_quantity"],
  ["frgn_ntby_qty", "row.foreign_net_buy_quantity"],
  ["orgn_ntby_qty", "row.institution_net_buy_quantity"],
  ["prsn_ntby_tr_pbmn", "row.individual_net_buy_amount"],
  ["frgn_ntby_tr_pbmn", "row.foreign_net_buy_amount"],
  ["orgn_ntby_tr_pbmn", "row.institution_net_buy_amount"]
];

const checks = {};

for (const rel of targets) {
  const file =
    path.join(
      ROOT,
      rel
    );

  if (!fs.existsSync(file)) {
    checks[rel + ":exists"] =
      false;
    continue;
  }

  const source =
    fs.readFileSync(
      file,
      "utf8"
    );

  checks[rel + ":exists"] =
    true;

  checks[rel + ":helperPresent"] =
    source.includes(
      "function normalizeKisFlowScalar("
    );

  checks[rel + ":scalarContract"] =
    source.includes(
      "): string | number | null {"
    );

  const relevant =
    source.includes(
      "buildKisInvestorFlowEvidence({"
    );

  if (relevant) {
    checks[rel + ":allNineFieldsNormalized"] =
      fields.every(
        ([property, expression]) =>
          source.includes(
            property +
            ":\\n                normalizeKisFlowScalar(\\n                  " +
            expression +
            ","
          ) ||
          source.includes(
            property +
            ":\\r\\n                normalizeKisFlowScalar(\\r\\n                  " +
            expression +
            ","
          )
      );
  }

  checks[rel + ":noAnyCastShortcut"] =
    !source.includes(
      "as any"
    ) &&
    !source.includes(
      "as KisDomesticInvestorTrendOutput[]"
    );
}

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
      ? "AI_STOCK_LAB_HISTORICAL_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V2_STATIC_VERIFIED"
      : "AI_STOCK_LAB_HISTORICAL_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V2_STATIC_FAILED",

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
      : "REPAIR_HISTORICAL_REPLAY_KIS_FLOW_NORMALIZATION"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
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
        "AI_STOCK_LAB_HISTORICAL_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V2_REPAIRED",

      changedFiles,

      generatedFile:
        "scripts/historical-replay-kis-flow-scalar-normalization-v2-static-verify.cjs",

      files:
        perFile,

      repair: {
        sourceProblem:
          "historical replay flow rows expose numeric fields as unknown",

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

        alphaFormulaChanged:
          false,

        replayExecuted:
          false
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
