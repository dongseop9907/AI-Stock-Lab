const fs = require("fs");
const path = require("path");

const root = process.cwd();

const serviceFile = path.resolve(
  root,
  "lib/trading/paper-order-service.ts",
);

const verifierFile = path.resolve(
  root,
  "scripts/alpha-v3-paper-order-service-repair-v1-verify.cjs",
);

if (!fs.existsSync(serviceFile)) {
  throw new Error(
    "PAPER_ORDER_SERVICE_NOT_FOUND",
  );
}

if (!fs.existsSync(verifierFile)) {
  throw new Error(
    "REPAIR_VERIFIER_NOT_FOUND",
  );
}

let service =
  fs.readFileSync(
    serviceFile,
    "utf8",
  );

let verifier =
  fs.readFileSync(
    verifierFile,
    "utf8",
  );

const serviceBackup =
  `${serviceFile}.before-repair-v1-1.bak`;

const verifierBackup =
  `${verifierFile}.before-repair-v1-1.bak`;

if (!fs.existsSync(serviceBackup)) {
  fs.copyFileSync(
    serviceFile,
    serviceBackup,
  );
}

if (!fs.existsSync(verifierBackup)) {
  fs.copyFileSync(
    verifierFile,
    verifierBackup,
  );
}

/*
 * Risk V3 contract:
 * BuyRiskInput requires openPositionsMissingValidStopCount:number.
 * Replace the boolean-only tracker with an integer count while keeping
 * the boolean snapshot field for diagnostics.
 */
if (
  !service.includes(
    "let openPositionsMissingValidStopCount",
  )
) {
  service =
    service.replace(
      /let hasMissingOpenPositionStop\s*=\s*false;/,
      [
        "let openPositionsMissingValidStopCount =",
        "    0;",
        "",
        "  let hasMissingOpenPositionStop =",
        "    false;",
      ].join("\n"),
    );
}

service =
  service.replace(
    /if\s*\(\s*averagePrice\s*<=\s*0\s*\|\|\s*stopPrice\s*<=\s*0\s*\)\s*\{\s*hasMissingOpenPositionStop\s*=\s*true;/m,
    [
      "if (",
      "      averagePrice <= 0 ||",
      "      stopPrice <= 0",
      "    ) {",
      "      openPositionsMissingValidStopCount +=",
      "        1;",
      "",
      "      hasMissingOpenPositionStop =",
      "        true;",
    ].join("\n"),
  );

if (
  !/openPositionsMissingValidStopCount\s*,/.test(
    service,
  )
) {
  const aggregateAnchor =
    /(\s+currentAggregateOpenRiskAmount,\s*\n)/;

  if (!aggregateAnchor.test(service)) {
    throw new Error(
      "RISK_INPUT_AGGREGATE_ANCHOR_NOT_FOUND",
    );
  }

  service =
    service.replace(
      aggregateAnchor,
      `$1\n    openPositionsMissingValidStopCount,\n`,
    );
}

if (
  !/openPositionsMissingValidStopCount\s*,[\s\S]{0,250}?hasMissingOpenPositionStop/.test(
    service,
  )
) {
  const snapshotAnchor =
    /(\s+currentAggregateOpenRiskAmount,\s*\n)(\s+hasMissingOpenPositionStop,)/;

  if (snapshotAnchor.test(service)) {
    service =
      service.replace(
        snapshotAnchor,
        `$1\n            openPositionsMissingValidStopCount,\n\n$2`,
      );
  }
}

/*
 * Make the verifier formatting-agnostic:
 * allow whitespace/newlines/trailing comma inside .from(...)
 */
verifier =
  verifier.replace(
    /riskDecisionInsertRestored:\s*[\s\S]*?atomicCommittedRiskHelperUsed:/m,
    `riskDecisionInsertRestored:
    /\\.from\\(\\s*["']risk_decisions["']\\s*,?\\s*\\)[\\s\\S]{0,1600}?\\.insert\\s*\\(/.test(
      text
    ),

  atomicCommittedRiskHelperUsed:`,
  );

if (
  !verifier.includes(
    "missingStopCountProvided",
  )
) {
  verifier =
    verifier.replace(
      /(\s+missingStopTracked:\s*[\s\S]*?\),\s*\n)/m,
      `$1
  missingStopCountProvided:
    /openPositionsMissingValidStopCount\\s*,/.test(
      text
    ),
`,
    );
}

fs.writeFileSync(
  serviceFile,
  service,
  "utf8",
);

fs.writeFileSync(
  verifierFile,
  verifier,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_PAPER_ORDER_SERVICE_REPAIR_V1_1_INSTALLED",

      patchedFiles: [
        "lib/trading/paper-order-service.ts",
        "scripts/alpha-v3-paper-order-service-repair-v1-verify.cjs",
      ],

      fixes: [
        "ADD_OPEN_POSITIONS_MISSING_VALID_STOP_COUNT",
        "KEEP_MISSING_STOP_BOOLEAN_DIAGNOSTIC",
        "MAKE_RISK_DECISION_VERIFIER_FORMATTING_AGNOSTIC",
      ],

      databaseWrites: 0,
      ordersCreated: 0,
      positionsChanged: 0,

      nextAction:
        "VERIFY_REPAIR_THEN_RUN_TARGETED_PRODUCTION_TYPESCRIPT_CHECK",
    },
    null,
    2,
  ),
);
