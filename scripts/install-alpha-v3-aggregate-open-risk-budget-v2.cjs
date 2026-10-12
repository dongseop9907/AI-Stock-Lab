const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const VERSION =
  "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_IMPLEMENTATION_V2_ROBUST";

const files = {
  policy: path.resolve(ROOT, "lib/trading/policy.ts"),
  types: path.resolve(ROOT, "lib/trading/types.ts"),
  riskManager: path.resolve(ROOT, "lib/trading/risk-manager.ts"),
  paperOrder: path.resolve(ROOT, "lib/trading/paper-order-service.ts"),
  preflight: path.resolve(ROOT, "lib/trading/read-only-buy-risk-preflight.ts"),
  verify: path.resolve(ROOT, "scripts/alpha-v3-aggregate-open-risk-verify.ts"),
};

function mustExist(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `REQUIRED_FILE_NOT_FOUND:${path.relative(ROOT, file)}`
    );
  }
}

for (const file of [
  files.policy,
  files.types,
  files.riskManager,
  files.paperOrder,
]) {
  mustExist(file);
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

function read(file) {
  return normalize(
    fs.readFileSync(file, "utf8")
  );
}

function write(file, text) {
  fs.writeFileSync(file, text, "utf8");
}

function backup(file) {
  const backup =
    `${file}.bak-alpha-v3-aggregate-open-risk-v2`;

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
  }

  return path
    .relative(ROOT, backup)
    .replaceAll("\\", "/");
}

const backupTargets = [
  files.policy,
  files.types,
  files.riskManager,
  files.paperOrder,
];

if (fs.existsSync(files.preflight)) {
  backupTargets.push(files.preflight);
}

const backups =
  backupTargets.map(backup);

function ensureReplace(
  source,
  regex,
  replacement,
  label
) {
  if (!regex.test(source)) {
    throw new Error(
      `PATCH_ANCHOR_NOT_FOUND:${label}`
    );
  }

  regex.lastIndex = 0;

  return source.replace(
    regex,
    replacement
  );
}

function ensureInsertAfter(
  source,
  regex,
  insertion,
  label
) {
  if (!regex.test(source)) {
    throw new Error(
      `PATCH_ANCHOR_NOT_FOUND:${label}`
    );
  }

  regex.lastIndex = 0;

  return source.replace(
    regex,
    (match) =>
      `${match}${insertion}`
  );
}

/* -------------------------------------------------
 * policy.ts
 * ------------------------------------------------- */
{
  let source = read(files.policy);

  if (
    !source.includes(
      "maxAggregateOpenRiskRate"
    )
  ) {
    source = ensureInsertAfter(
      source,
      /^\s*maxStopDistanceRate\s*:\s*number\s*;\s*$/m,
      [
        "",
        "",
        "  /** 열린 모든 포지션의 stop 기준 총 잠재 손실 한도 */",
        "  maxAggregateOpenRiskRate?: number;",
      ].join("\n"),
      "policy-interface"
    );

    source = ensureInsertAfter(
      source,
      /^\s*maxStopDistanceRate\s*:\s*0\.05\s*,\s*$/m,
      [
        "",
        "  maxAggregateOpenRiskRate: 0.02,",
      ].join("\n"),
      "policy-default"
    );
  }

  write(files.policy, source);
}

/* -------------------------------------------------
 * types.ts
 * ------------------------------------------------- */
{
  let source = read(files.types);

  if (
    !source.includes(
      "currentAggregateOpenRiskAmount"
    )
  ) {
    source = ensureInsertAfter(
      source,
      /^\s*currentSectorExposureAmount\s*:\s*number\s*;\s*$/m,
      [
        "",
        "",
        "  /** 현재 열린 포지션들의 stop 기준 총 잠재 손실액 */",
        "  currentAggregateOpenRiskAmount?: number;",
        "",
        "  /** 유효한 stop을 확인할 수 없는 열린 포지션 수 */",
        "  openPositionsMissingValidStopCount?: number;",
      ].join("\n"),
      "types-buy-risk-input"
    );
  }

  if (
    !source.includes(
      '"AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"'
    )
  ) {
    source = ensureReplace(
      source,
      /^(\s*\|\s*"DAILY_LOSS_LIMIT_REACHED")/m,
      [
        '  | "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"',
        '  | "OPEN_POSITION_STOP_MISSING"',
        "$1",
      ].join("\n"),
      "types-risk-issue-code"
    );
  }

  write(files.types, source);
}

/* -------------------------------------------------
 * risk-manager.ts
 * ------------------------------------------------- */
{
  let source = read(files.riskManager);

  if (
    !source.includes(
      "const currentAggregateOpenRiskAmount ="
    )
  ) {
    source = ensureInsertAfter(
      source,
      /const issues:\s*RiskIssue\[\]\s*=\s*\[\]\s*;/,
      [
        "",
        "",
        "  const currentAggregateOpenRiskAmount =",
        "    Math.max(",
        "      0,",
        "      input.currentAggregateOpenRiskAmount ?? 0,",
        "    );",
        "",
        "  const openPositionsMissingValidStopCount =",
        "    Math.max(",
        "      0,",
        "      Math.floor(",
        "        input.openPositionsMissingValidStopCount ?? 0,",
        "      ),",
        "    );",
      ].join("\n"),
      "risk-manager-normalized-inputs"
    );
  }

  if (
    !source.includes(
      "maxAggregateOpenRiskAmount"
    )
  ) {
    source = ensureInsertAfter(
      source,
      /const maxSectorAmount\s*=\s*[\s\S]*?policy\.maxSectorExposureRate\s*;/,
      [
        "",
        "",
        "  const maxAggregateOpenRiskRate =",
        "    policy.maxAggregateOpenRiskRate ??",
        "    DEFAULT_RISK_POLICY.maxAggregateOpenRiskRate ??",
        "    0.02;",
        "",
        "  const maxAggregateOpenRiskAmount =",
        "    input.accountEquity *",
        "    maxAggregateOpenRiskRate;",
        "",
        "  const aggregateOpenRiskAfterOrder =",
        "    currentAggregateOpenRiskAmount +",
        "    totalRiskAmount;",
      ].join("\n"),
      "risk-manager-aggregate-amounts"
    );
  }

  if (
    !source.includes(
      'code: "OPEN_POSITION_STOP_MISSING"'
    )
  ) {
    const riskBlock =
      /if\s*\(\s*totalRiskAmount\s*>\s*maxRiskAmount\s*\)\s*\{[\s\S]*?code:\s*"RISK_LIMIT_EXCEEDED"[\s\S]*?\n\s*\}/;

    source = ensureInsertAfter(
      source,
      riskBlock,
      [
        "",
        "",
        "  if (openPositionsMissingValidStopCount > 0) {",
        "    issues.push({",
        '      code: "OPEN_POSITION_STOP_MISSING",',
        '      message: "유효한 손절가를 확인할 수 없는 보유 포지션이 있어 신규 위험 승인을 중단합니다.",',
        "    });",
        "  }",
        "",
        "  if (",
        "    aggregateOpenRiskAfterOrder >",
        "    maxAggregateOpenRiskAmount",
        "  ) {",
        "    issues.push({",
        '      code: "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",',
        '      message: "열린 포지션과 신규 거래의 합산 손절 위험이 Aggregate Open Risk 한도를 초과합니다.",',
        "    });",
        "  }",
      ].join("\n"),
      "risk-manager-aggregate-issues"
    );
  }

  if (
    !source.includes(
      "aggregateOpenRiskQuantityLimit"
    )
  ) {
    source = ensureInsertAfter(
      source,
      /const cashQuantityLimit\s*=\s*calculateQuantityLimit\([\s\S]*?\)\s*;/,
      [
        "",
        "",
        "  const remainingAggregateOpenRiskAmount =",
        "    Math.max(",
        "      0,",
        "      maxAggregateOpenRiskAmount -",
        "        currentAggregateOpenRiskAmount,",
        "    );",
        "",
        "  const aggregateOpenRiskQuantityLimit =",
        "    riskPerShare > 0",
        "      ? floorNonNegative(",
        "          remainingAggregateOpenRiskAmount /",
        "            riskPerShare,",
        "        )",
        "      : 0;",
      ].join("\n"),
      "risk-manager-aggregate-quantity-limit"
    );

    source = ensureReplace(
      source,
      /let maxAllowedQuantity\s*=\s*Math\.min\(\s*riskQuantityLimit,\s*positionQuantityLimit,\s*portfolioQuantityLimit,\s*sectorQuantityLimit,\s*cashQuantityLimit,\s*\);/,
      [
        "let maxAllowedQuantity = Math.min(",
        "    riskQuantityLimit,",
        "    positionQuantityLimit,",
        "    portfolioQuantityLimit,",
        "    sectorQuantityLimit,",
        "    cashQuantityLimit,",
        "    aggregateOpenRiskQuantityLimit,",
        "  );",
      ].join("\n"),
      "risk-manager-max-quantity"
    );
  }

  if (
    !source.includes(
      "openPositionsMissingValidStopCount > 0\n  ) {\n    maxAllowedQuantity = 0;"
    )
  ) {
    const dailyLossZero =
      /if\s*\(\s*input\.dailyRealizedPnl\s*<=\s*-maxDailyLossAmount\s*\)\s*\{\s*maxAllowedQuantity\s*=\s*0\s*;\s*\}/;

    source = ensureReplace(
      source,
      dailyLossZero,
      [
        "if (",
        "    openPositionsMissingValidStopCount > 0",
        "  ) {",
        "    maxAllowedQuantity = 0;",
        "  }",
        "",
        "  if (",
        "    input.dailyRealizedPnl <= -maxDailyLossAmount",
        "  ) {",
        "    maxAllowedQuantity = 0;",
        "  }",
      ].join("\n"),
      "risk-manager-missing-stop-max-zero"
    );
  }

  write(files.riskManager, source);
}

/* -------------------------------------------------
 * Caller patcher
 * paper-order-service and read-only preflight
 * ------------------------------------------------- */
function patchCaller(file, label) {
  let source = read(file);

  if (
    !source.includes(
      "current_stop_price: number | string"
    )
  ) {
    source = ensureInsertAfter(
      source,
      /^\s*average_price\s*:\s*number\s*\|\s*string\s*;\s*$/m,
      "\n  current_stop_price: number | string;",
      `${label}-position-interface`
    );
  }

  /*
   * Only modify the paper_positions select that already contains
   * stock_code, sector, quantity, average_price.
   */
  if (
    !/quantity,\s*\n\s*average_price,\s*\n\s*current_stop_price/m.test(
      source
    )
  ) {
    source = ensureReplace(
      source,
      /(quantity\s*,\s*\n\s*average_price)(\s*\n\s*`)/m,
      "$1,\n          current_stop_price$2",
      `${label}-position-select`
    );
  }

  if (
    !source.includes(
      "let currentAggregateOpenRiskAmount ="
    )
  ) {
    source = ensureInsertAfter(
      source,
      /let currentSectorExposureAmount\s*=\s*0\s*;/,
      [
        "",
        "  let currentAggregateOpenRiskAmount = 0;",
        "  let openPositionsMissingValidStopCount = 0;",
      ].join("\n"),
      `${label}-aggregate-vars`
    );
  }

  if (
    !source.includes(
      "averagePrice - currentStopPrice"
    )
  ) {
    source = ensureInsertAfter(
      source,
      /const positionValue\s*=\s*currentPrice\s*\*\s*position\.quantity\s*;/,
      [
        "",
        "",
        "    const averagePrice =",
        "      toNumber(position.average_price);",
        "",
        "    const currentStopPrice =",
        "      toNumber(position.current_stop_price);",
        "",
        "    if (",
        "      position.quantity > 0 &&",
        "      averagePrice > 0 &&",
        "      currentStopPrice > 0",
        "    ) {",
        "      currentAggregateOpenRiskAmount +=",
        "        Math.max(",
        "          0,",
        "          averagePrice - currentStopPrice,",
        "        ) * position.quantity;",
        "    } else if (position.quantity > 0) {",
        "      openPositionsMissingValidStopCount += 1;",
        "    }",
      ].join("\n"),
      `${label}-aggregate-calc`
    );
  }

  if (
    !/currentSectorExposureAmount,\s*\n\s*currentAggregateOpenRiskAmount,/m.test(
      source
    )
  ) {
    /*
     * Insert only in riskInput first.
     */
    source = ensureReplace(
      source,
      /(const riskInput(?:\s*:\s*BuyRiskInput)?\s*=\s*\{[\s\S]*?currentStockExposureAmount,\s*\n\s*currentSectorExposureAmount,)/m,
      [
        "$1",
        "    currentAggregateOpenRiskAmount,",
        "    openPositionsMissingValidStopCount,",
      ].join("\n"),
      `${label}-risk-input`
    );
  }

  /*
   * Add diagnostics to accountSnapshot if that block exists.
   */
  if (
    source.includes(
      "accountSnapshot:"
    ) &&
    !/accountSnapshot:\s*\{[\s\S]*?currentAggregateOpenRiskAmount/m.test(
      source
    )
  ) {
    source = source.replace(
      /(accountSnapshot:\s*\{[\s\S]*?currentSectorExposureAmount,)/m,
      [
        "$1",
        "            currentAggregateOpenRiskAmount,",
        "            openPositionsMissingValidStopCount,",
      ].join("\n")
    );
  }

  write(file, source);
}

patchCaller(
  files.paperOrder,
  "paper-order-service"
);

if (fs.existsSync(files.preflight)) {
  patchCaller(
    files.preflight,
    "read-only-preflight"
  );
}

/* -------------------------------------------------
 * Pure read-only unit verifier.
 * ------------------------------------------------- */
const verifier = `import {
  DEFAULT_RISK_POLICY,
} from "../lib/trading/policy";

import {
  validateBuyRisk,
} from "../lib/trading/risk-manager";

import type {
  BuyRiskInput,
} from "../lib/trading/types";

const VERSION =
  "ALPHA_V3_AGGREGATE_OPEN_RISK_VERIFY_V2";

function makeInput(
  overrides: Partial<BuyRiskInput> = {},
): BuyRiskInput {
  return {
    stockCode: "005930",
    entryPrice: 100000,
    proposedStopPrice: 95000,
    requestedQuantity: 10,

    accountEquity: 10000000,
    availableCash: 10000000,

    currentInvestedAmount: 0,
    currentStockExposureAmount: 0,
    currentSectorExposureAmount: 0,

    currentAggregateOpenRiskAmount: 0,
    openPositionsMissingValidStopCount: 0,

    dailyRealizedPnl: 0,
    openPositionCount: 0,
    isNewPosition: true,

    tradingMode: "PAPER",
    modelStatus: "CANDIDATE",

    ...overrides,
  };
}

const atLimit = validateBuyRisk(
  makeInput({
    currentAggregateOpenRiskAmount: 150000,
    requestedQuantity: 10,
  }),
);

const aboveLimit = validateBuyRisk(
  makeInput({
    currentAggregateOpenRiskAmount: 175000,
    requestedQuantity: 10,
  }),
);

const missingStop = validateBuyRisk(
  makeInput({
    requestedQuantity: 1,
    openPositionsMissingValidStopCount: 1,
  }),
);

const quantityLimited = validateBuyRisk(
  makeInput({
    currentAggregateOpenRiskAmount: 190000,
    requestedQuantity: 10,
  }),
);

function hasIssue(
  result: ReturnType<typeof validateBuyRisk>,
  code: string,
) {
  return result.issues.some(
    (issue) => issue.code === code,
  );
}

const report = {
  status:
    "ALPHA_V3_AGGREGATE_OPEN_RISK_VERIFY_COMPLETE",

  version: VERSION,

  policy: {
    maxAggregateOpenRiskRate:
      DEFAULT_RISK_POLICY.maxAggregateOpenRiskRate,
    expected: 0.02,
  },

  cases: {
    atLimit: {
      approved: atLimit.approved,
      maxAllowedQuantity: atLimit.maxAllowedQuantity,
      issues: atLimit.issues,
    },

    aboveLimit: {
      approved: aboveLimit.approved,
      maxAllowedQuantity: aboveLimit.maxAllowedQuantity,
      aggregateIssue: hasIssue(
        aboveLimit,
        "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",
      ),
      issues: aboveLimit.issues,
    },

    missingStop: {
      approved: missingStop.approved,
      maxAllowedQuantity: missingStop.maxAllowedQuantity,
      missingStopIssue: hasIssue(
        missingStop,
        "OPEN_POSITION_STOP_MISSING",
      ),
      issues: missingStop.issues,
    },

    quantityLimited: {
      approved: quantityLimited.approved,
      maxAllowedQuantity:
        quantityLimited.maxAllowedQuantity,
      expectedMaxAllowedQuantity: 2,
    },
  },

  checks: {
    policyIsTwoPercent:
      DEFAULT_RISK_POLICY.maxAggregateOpenRiskRate ===
      0.02,

    exactlyAtLimitAllowed:
      atLimit.approved === true,

    aboveLimitRejected:
      aboveLimit.approved === false &&
      hasIssue(
        aboveLimit,
        "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",
      ),

    missingStopRejected:
      missingStop.approved === false &&
      hasIssue(
        missingStop,
        "OPEN_POSITION_STOP_MISSING",
      ),

    quantityLimitApplied:
      quantityLimited.maxAllowedQuantity === 2,
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    kisRequests: 0,
    ordersCreated: 0,
    positionsChanged: 0,
  },

  nextGate:
    "RUN_TYPESCRIPT_CHECK_AND_AGGREGATE_OPEN_RISK_INTEGRATION_TEST",
};

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);
`;

fs.mkdirSync(
  path.dirname(files.verify),
  { recursive: true }
);

write(
  files.verify,
  verifier
);

/* -------------------------------------------------
 * Static checks
 * ------------------------------------------------- */
const p = read(files.policy);
const t = read(files.types);
const r = read(files.riskManager);
const o = read(files.paperOrder);
const pf =
  fs.existsSync(files.preflight)
    ? read(files.preflight)
    : null;

const checks = {
  policyField:
    p.includes(
      "maxAggregateOpenRiskRate?: number"
    ),

  policyValue:
    p.includes(
      "maxAggregateOpenRiskRate: 0.02"
    ),

  inputAggregate:
    t.includes(
      "currentAggregateOpenRiskAmount?: number"
    ),

  inputMissingStop:
    t.includes(
      "openPositionsMissingValidStopCount?: number"
    ),

  aggregateIssue:
    t.includes(
      '"AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"'
    ),

  missingStopIssue:
    t.includes(
      '"OPEN_POSITION_STOP_MISSING"'
    ),

  managerAggregate:
    r.includes(
      "aggregateOpenRiskQuantityLimit"
    ) &&
    r.includes(
      "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"
    ),

  paperOrderReadsStop:
    o.includes(
      "current_stop_price"
    ),

  paperOrderPassesAggregate:
    o.includes(
      "currentAggregateOpenRiskAmount"
    ) &&
    o.includes(
      "openPositionsMissingValidStopCount"
    ),

  preflightCompatible:
    pf === null ||
    (
      pf.includes("current_stop_price") &&
      pf.includes(
        "currentAggregateOpenRiskAmount"
      )
    ),
};

const allChecksPassed =
  Object.values(checks).every(Boolean);

console.log(
  JSON.stringify(
    {
      status:
        allChecksPassed
          ? "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_IMPLEMENTED"
          : "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_IMPLEMENTATION_INCOMPLETE",

      version: VERSION,

      changedFiles: [
        "lib/trading/policy.ts",
        "lib/trading/types.ts",
        "lib/trading/risk-manager.ts",
        "lib/trading/paper-order-service.ts",
        ...(fs.existsSync(files.preflight)
          ? [
              "lib/trading/read-only-buy-risk-preflight.ts",
            ]
          : []),
      ],

      generatedVerifier:
        "scripts/alpha-v3-aggregate-open-risk-verify.ts",

      backups,

      checks,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        kisRequests: 0,
        ordersCreated: 0,
        positionsChanged: 0,
      },

      nextAction:
        allChecksPassed
          ? "RUN_ALPHA_V3_AGGREGATE_OPEN_RISK_VERIFY"
          : "REVIEW_PATCH_FAILURE",
    },
    null,
    2
  )
);

if (!allChecksPassed) {
  process.exitCode = 2;
}
