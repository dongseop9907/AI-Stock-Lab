const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const VERSION =
  "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_IMPLEMENTATION_V1";

const targets = {
  policy: path.resolve(
    ROOT,
    "lib/trading/policy.ts"
  ),
  types: path.resolve(
    ROOT,
    "lib/trading/types.ts"
  ),
  riskManager: path.resolve(
    ROOT,
    "lib/trading/risk-manager.ts"
  ),
  paperOrder: path.resolve(
    ROOT,
    "lib/trading/paper-order-service.ts"
  ),
  preflight: path.resolve(
    ROOT,
    "lib/trading/read-only-buy-risk-preflight.ts"
  ),
  verify: path.resolve(
    ROOT,
    "scripts/alpha-v3-aggregate-open-risk-verify.ts"
  ),
};

function requireFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `REQUIRED_FILE_NOT_FOUND:${path.relative(ROOT, file)}`
    );
  }
}

for (const file of [
  targets.policy,
  targets.types,
  targets.riskManager,
  targets.paperOrder,
]) {
  requireFile(file);
}

function backup(file) {
  const backupFile =
    `${file}.bak-alpha-v3-aggregate-open-risk-v1`;

  if (!fs.existsSync(backupFile)) {
    fs.copyFileSync(
      file,
      backupFile
    );
  }

  return path.relative(
    ROOT,
    backupFile
  ).replaceAll("\\", "/");
}

const backups = [
  targets.policy,
  targets.types,
  targets.riskManager,
  targets.paperOrder,
];

if (fs.existsSync(targets.preflight)) {
  backups.push(
    targets.preflight
  );
}

const backupFiles =
  backups.map(backup);

function replaceOnce(
  source,
  search,
  replacement,
  label
) {
  if (!source.includes(search)) {
    throw new Error(
      `PATCH_ANCHOR_NOT_FOUND:${label}`
    );
  }

  return source.replace(
    search,
    replacement
  );
}

function write(file, source) {
  fs.writeFileSync(
    file,
    source,
    "utf8"
  );
}

/*
 * 1. RiskPolicy
 */
{
  let source =
    fs.readFileSync(
      targets.policy,
      "utf8"
    );

  if (
    !source.includes(
      "maxAggregateOpenRiskRate"
    )
  ) {
    source = replaceOnce(
      source,
      "  /** 하루 최대 허용 손실 */\n  maxDailyLossRate: number;",
      [
        "  /** 열린 모든 포지션의 손절까지 합산한 최대 계좌 위험 비율 */",
        "  maxAggregateOpenRiskRate: number;",
        "",
        "  /** 하루 최대 허용 손실 */",
        "  maxDailyLossRate: number;",
      ].join("\n"),
      "policy-interface"
    );

    source = replaceOnce(
      source,
      "  maxStopDistanceRate: 0.05,\n  maxDailyLossRate: 0.02,",
      [
        "  maxStopDistanceRate: 0.05,",
        "  maxAggregateOpenRiskRate: 0.02,",
        "  maxDailyLossRate: 0.02,",
      ].join("\n"),
      "policy-default"
    );
  }

  write(
    targets.policy,
    source
  );
}

/*
 * 2. BuyRiskInput / RiskIssueCode
 */
{
  let source =
    fs.readFileSync(
      targets.types,
      "utf8"
    );

  if (
    !source.includes(
      "currentAggregateOpenRiskAmount"
    )
  ) {
    source = replaceOnce(
      source,
      "  currentSectorExposureAmount: number;\n\n  dailyRealizedPnl: number;",
      [
        "  currentSectorExposureAmount: number;",
        "",
        "  /** 현재 열린 포지션들의 stop 기준 총 잠재 손실액 */",
        "  currentAggregateOpenRiskAmount: number;",
        "",
        "  /** 유효한 stop을 확인할 수 없는 열린 포지션 수 */",
        "  openPositionsMissingValidStopCount: number;",
        "",
        "  dailyRealizedPnl: number;",
      ].join("\n"),
      "types-buy-risk-input"
    );
  }

  if (
    !source.includes(
      "\"AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED\""
    )
  ) {
    source = replaceOnce(
      source,
      '  | "DAILY_LOSS_LIMIT_REACHED"',
      [
        '  | "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"',
        '  | "OPEN_POSITION_STOP_MISSING"',
        '  | "DAILY_LOSS_LIMIT_REACHED"',
      ].join("\n"),
      "types-risk-issue-code"
    );
  }

  write(
    targets.types,
    source
  );
}

/*
 * 3. risk-manager.ts
 */
{
  let source =
    fs.readFileSync(
      targets.riskManager,
      "utf8"
    );

  if (
    !source.includes(
      "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"
    )
  ) {
    source = replaceOnce(
      source,
      [
        "    input.currentStockExposureAmount >= 0 &&",
        "    input.currentSectorExposureAmount >= 0 &&",
        "    Number.isInteger(input.openPositionCount) &&",
      ].join("\n"),
      [
        "    input.currentStockExposureAmount >= 0 &&",
        "    input.currentSectorExposureAmount >= 0 &&",
        "    input.currentAggregateOpenRiskAmount >= 0 &&",
        "    Number.isInteger(",
        "      input.openPositionsMissingValidStopCount,",
        "    ) &&",
        "    input.openPositionsMissingValidStopCount >= 0 &&",
        "    Number.isInteger(input.openPositionCount) &&",
      ].join("\n"),
      "risk-manager-basic-input"
    );

    source = replaceOnce(
      source,
      [
        "  const maxSectorAmount =",
        "    input.accountEquity *",
        "    policy.maxSectorExposureRate;",
      ].join("\n"),
      [
        "  const maxSectorAmount =",
        "    input.accountEquity *",
        "    policy.maxSectorExposureRate;",
        "",
        "  const maxAggregateOpenRiskAmount =",
        "    input.accountEquity *",
        "    policy.maxAggregateOpenRiskRate;",
        "",
        "  const aggregateOpenRiskAfterOrder =",
        "    input.currentAggregateOpenRiskAmount +",
        "    totalRiskAmount;",
      ].join("\n"),
      "risk-manager-aggregate-amounts"
    );

    source = replaceOnce(
      source,
      [
        "  if (totalRiskAmount > maxRiskAmount) {",
        "    issues.push({",
        '      code: "RISK_LIMIT_EXCEEDED",',
        '      message: "이번 거래의 예상 손실액이 거래별 위험 한도를 초과합니다.",',
        "    });",
        "  }",
      ].join("\n"),
      [
        "  if (totalRiskAmount > maxRiskAmount) {",
        "    issues.push({",
        '      code: "RISK_LIMIT_EXCEEDED",',
        '      message: "이번 거래의 예상 손실액이 거래별 위험 한도를 초과합니다.",',
        "    });",
        "  }",
        "",
        "  if (input.openPositionsMissingValidStopCount > 0) {",
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
        '      message: "열린 포지션과 이번 거래의 합산 손절 위험이 계좌의 Aggregate Open Risk 한도를 초과합니다.",',
        "    });",
        "  }",
      ].join("\n"),
      "risk-manager-aggregate-issues"
    );

    source = replaceOnce(
      source,
      [
        "  const cashQuantityLimit =",
        "    calculateQuantityLimit(",
        "      input.availableCash,",
        "      input.entryPrice,",
        "    );",
        "",
        "  let maxAllowedQuantity = Math.min(",
        "    riskQuantityLimit,",
        "    positionQuantityLimit,",
        "    portfolioQuantityLimit,",
        "    sectorQuantityLimit,",
        "    cashQuantityLimit,",
        "  );",
      ].join("\n"),
      [
        "  const cashQuantityLimit =",
        "    calculateQuantityLimit(",
        "      input.availableCash,",
        "      input.entryPrice,",
        "    );",
        "",
        "  const remainingAggregateOpenRiskAmount =",
        "    Math.max(",
        "      0,",
        "      maxAggregateOpenRiskAmount -",
        "        input.currentAggregateOpenRiskAmount,",
        "    );",
        "",
        "  const aggregateOpenRiskQuantityLimit =",
        "    riskPerShare > 0",
        "      ? floorNonNegative(",
        "          remainingAggregateOpenRiskAmount /",
        "            riskPerShare,",
        "        )",
        "      : 0;",
        "",
        "  let maxAllowedQuantity = Math.min(",
        "    riskQuantityLimit,",
        "    positionQuantityLimit,",
        "    portfolioQuantityLimit,",
        "    sectorQuantityLimit,",
        "    cashQuantityLimit,",
        "    aggregateOpenRiskQuantityLimit,",
        "  );",
      ].join("\n"),
      "risk-manager-quantity-limit"
    );

    source = replaceOnce(
      source,
      [
        "  if (",
        "    input.dailyRealizedPnl <= -maxDailyLossAmount",
        "  ) {",
        "    maxAllowedQuantity = 0;",
        "  }",
      ].join("\n"),
      [
        "  if (",
        "    input.openPositionsMissingValidStopCount > 0",
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
      "risk-manager-missing-stop-zero-limit"
    );
  }

  write(
    targets.riskManager,
    source
  );
}

/*
 * Shared patch for callers that construct BuyRiskInput from paper_positions.
 */
function patchRiskCaller(
  file,
  label
) {
  let source =
    fs.readFileSync(
      file,
      "utf8"
    );

  if (
    source.includes(
      "currentAggregateOpenRiskAmount"
    )
  ) {
    return;
  }

  source = replaceOnce(
    source,
    [
      "  quantity: number;",
      "  average_price: number | string;",
    ].join("\n"),
    [
      "  quantity: number;",
      "  average_price: number | string;",
      "  current_stop_price: number | string;",
    ].join("\n"),
    `${label}-position-interface`
  );

  source = replaceOnce(
    source,
    [
      "          quantity,",
      "          average_price",
    ].join("\n"),
    [
      "          quantity,",
      "          average_price,",
      "          current_stop_price",
    ].join("\n"),
    `${label}-position-select`
  );

  source = replaceOnce(
    source,
    [
      "  let currentInvestedAmount = 0;",
      "  let currentStockExposureAmount = 0;",
      "  let currentSectorExposureAmount = 0;",
    ].join("\n"),
    [
      "  let currentInvestedAmount = 0;",
      "  let currentStockExposureAmount = 0;",
      "  let currentSectorExposureAmount = 0;",
      "  let currentAggregateOpenRiskAmount = 0;",
      "  let openPositionsMissingValidStopCount = 0;",
    ].join("\n"),
    `${label}-aggregate-vars`
  );

  source = replaceOnce(
    source,
    [
      "    const positionValue =",
      "      currentPrice * position.quantity;",
      "",
      "    currentInvestedAmount += positionValue;",
    ].join("\n"),
    [
      "    const positionValue =",
      "      currentPrice * position.quantity;",
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
      "",
      "    currentInvestedAmount += positionValue;",
    ].join("\n"),
    `${label}-aggregate-calc`
  );

  source = replaceOnce(
    source,
    [
      "    currentInvestedAmount,",
      "    currentStockExposureAmount,",
      "    currentSectorExposureAmount,",
      "",
      "    dailyRealizedPnl:",
    ].join("\n"),
    [
      "    currentInvestedAmount,",
      "    currentStockExposureAmount,",
      "    currentSectorExposureAmount,",
      "    currentAggregateOpenRiskAmount,",
      "    openPositionsMissingValidStopCount,",
      "",
      "    dailyRealizedPnl:",
    ].join("\n"),
    `${label}-risk-input`
  );

  /*
   * Some callers persist/return accountSnapshot. Add diagnostics there when present.
   */
  if (
    source.includes(
      "            currentSectorExposureAmount,\n            openPositionCount:"
    )
  ) {
    source = source.replace(
      "            currentSectorExposureAmount,\n            openPositionCount:",
      [
        "            currentSectorExposureAmount,",
        "            currentAggregateOpenRiskAmount,",
        "            openPositionsMissingValidStopCount,",
        "            openPositionCount:",
      ].join("\n")
    );
  }

  if (
    source.includes(
      "      currentSectorExposureAmount,\n\n      dailyRealizedPnl:"
    )
  ) {
    source = source.replace(
      "      currentSectorExposureAmount,\n\n      dailyRealizedPnl:",
      [
        "      currentSectorExposureAmount,",
        "      currentAggregateOpenRiskAmount,",
        "      openPositionsMissingValidStopCount,",
        "",
        "      dailyRealizedPnl:",
      ].join("\n")
    );
  }

  write(
    file,
    source
  );
}

patchRiskCaller(
  targets.paperOrder,
  "paper-order-service"
);

if (
  fs.existsSync(
    targets.preflight
  )
) {
  patchRiskCaller(
    targets.preflight,
    "read-only-preflight"
  );
}

/*
 * 5. Read-only verifier.
 * No Supabase access. No writes except its own log.
 */
const verifySource = String.raw`import {
  DEFAULT_RISK_POLICY,
} from "../lib/trading/policy";

import {
  validateBuyRisk,
} from "../lib/trading/risk-manager";

import type {
  BuyRiskInput,
} from "../lib/trading/types";

const VERSION =
  "ALPHA_V3_AGGREGATE_OPEN_RISK_VERIFY_V1";

function makeInput(
  overrides:
    Partial<BuyRiskInput> = {},
): BuyRiskInput {
  return {
    stockCode:
      "005930",

    entryPrice:
      100000,

    proposedStopPrice:
      95000,

    requestedQuantity:
      10,

    accountEquity:
      10000000,

    availableCash:
      10000000,

    currentInvestedAmount:
      0,

    currentStockExposureAmount:
      0,

    currentSectorExposureAmount:
      0,

    currentAggregateOpenRiskAmount:
      0,

    openPositionsMissingValidStopCount:
      0,

    dailyRealizedPnl:
      0,

    openPositionCount:
      0,

    isNewPosition:
      true,

    tradingMode:
      "PAPER",

    modelStatus:
      "CANDIDATE",

    ...overrides,
  };
}

const underLimit =
  validateBuyRisk(
    makeInput({
      requestedQuantity:
        10,

      currentAggregateOpenRiskAmount:
        150000,
    }),
  );

const exactlyAtLimit =
  validateBuyRisk(
    makeInput({
      requestedQuantity:
        10,

      currentAggregateOpenRiskAmount:
        150000,
    }),
  );

const aboveLimit =
  validateBuyRisk(
    makeInput({
      requestedQuantity:
        10,

      currentAggregateOpenRiskAmount:
        175000,
    }),
  );

const missingStop =
  validateBuyRisk(
    makeInput({
      requestedQuantity:
        1,

      currentAggregateOpenRiskAmount:
        0,

      openPositionsMissingValidStopCount:
        1,
    }),
  );

const quantityLimited =
  validateBuyRisk(
    makeInput({
      requestedQuantity:
        10,

      currentAggregateOpenRiskAmount:
        190000,
    }),
  );

const hasIssue = (
  result:
    ReturnType<typeof validateBuyRisk>,
  code:
    string,
) =>
  result.issues.some(
    (issue) =>
      issue.code ===
      code,
  );

const report = {
  status:
    "ALPHA_V3_AGGREGATE_OPEN_RISK_VERIFY_COMPLETE",

  version:
    VERSION,

  policy: {
    maxAggregateOpenRiskRate:
      DEFAULT_RISK_POLICY
        .maxAggregateOpenRiskRate,

    expected:
      0.02,
  },

  cases: {
    exactlyAtLimit: {
      approved:
        exactlyAtLimit.approved,

      maxAllowedQuantity:
        exactlyAtLimit
          .maxAllowedQuantity,

      issues:
        exactlyAtLimit
          .issues,
    },

    aboveLimit: {
      approved:
        aboveLimit.approved,

      maxAllowedQuantity:
        aboveLimit
          .maxAllowedQuantity,

      aggregateIssue:
        hasIssue(
          aboveLimit,
          "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",
        ),

      issues:
        aboveLimit
          .issues,
    },

    missingStop: {
      approved:
        missingStop.approved,

      maxAllowedQuantity:
        missingStop
          .maxAllowedQuantity,

      missingStopIssue:
        hasIssue(
          missingStop,
          "OPEN_POSITION_STOP_MISSING",
        ),

      issues:
        missingStop
          .issues,
    },

    quantityLimited: {
      approved:
        quantityLimited
          .approved,

      maxAllowedQuantity:
        quantityLimited
          .maxAllowedQuantity,

      expectedMaxAllowedQuantity:
        2,
    },
  },

  checks: {
    policyIsTwoPercent:
      DEFAULT_RISK_POLICY
        .maxAggregateOpenRiskRate ===
      0.02,

    exactlyAtLimitAllowed:
      exactlyAtLimit.approved ===
      true,

    aboveLimitRejected:
      aboveLimit.approved ===
        false &&
      hasIssue(
        aboveLimit,
        "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",
      ),

    missingStopRejected:
      missingStop.approved ===
        false &&
      hasIssue(
        missingStop,
        "OPEN_POSITION_STOP_MISSING",
      ),

    quantityLimitApplied:
      quantityLimited
        .maxAllowedQuantity ===
      2,
  },

  safety: {
    databaseReads:
      0,

    databaseWrites:
      0,

    kisRequests:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,
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
  path.dirname(
    targets.verify
  ),
  {
    recursive: true,
  }
);

write(
  targets.verify,
  verifySource
);

/*
 * Static post-patch checks.
 */
const post = {
  policy:
    fs.readFileSync(
      targets.policy,
      "utf8"
    ),
  types:
    fs.readFileSync(
      targets.types,
      "utf8"
    ),
  risk:
    fs.readFileSync(
      targets.riskManager,
      "utf8"
    ),
  order:
    fs.readFileSync(
      targets.paperOrder,
      "utf8"
    ),
  preflight:
    fs.existsSync(
      targets.preflight
    )
      ? fs.readFileSync(
          targets.preflight,
          "utf8"
        )
      : null,
};

const checks = {
  policyField:
    post.policy.includes(
      "maxAggregateOpenRiskRate: number"
    ),

  policyValue:
    post.policy.includes(
      "maxAggregateOpenRiskRate: 0.02"
    ),

  riskInputAggregate:
    post.types.includes(
      "currentAggregateOpenRiskAmount: number"
    ),

  riskInputMissingStop:
    post.types.includes(
      "openPositionsMissingValidStopCount: number"
    ),

  aggregateIssue:
    post.types.includes(
      '"AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"'
    ),

  missingStopIssue:
    post.types.includes(
      '"OPEN_POSITION_STOP_MISSING"'
    ),

  riskManagerLimit:
    post.risk.includes(
      "aggregateOpenRiskQuantityLimit"
    ),

  riskManagerIssue:
    post.risk.includes(
      "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"
    ),

  paperOrderReadsStop:
    post.order.includes(
      "current_stop_price"
    ),

  paperOrderPassesAggregate:
    post.order.includes(
      "currentAggregateOpenRiskAmount"
    ),

  preflightPatched:
    post.preflight === null ||
    (
      post.preflight.includes(
        "current_stop_price"
      ) &&
      post.preflight.includes(
        "currentAggregateOpenRiskAmount"
      )
    ),
};

const allChecksPassed =
  Object.values(
    checks
  ).every(Boolean);

console.log(
  JSON.stringify(
    {
      status:
        allChecksPassed
          ? "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_IMPLEMENTED"
          : "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_IMPLEMENTATION_INCOMPLETE",

      version:
        VERSION,

      changedFiles: [
        "lib/trading/policy.ts",
        "lib/trading/types.ts",
        "lib/trading/risk-manager.ts",
        "lib/trading/paper-order-service.ts",
        ...(fs.existsSync(targets.preflight)
          ? [
              "lib/trading/read-only-buy-risk-preflight.ts",
            ]
          : []),
      ],

      generatedVerifier:
        "scripts/alpha-v3-aggregate-open-risk-verify.ts",

      backups:
        backupFiles,

      policy: {
        maxAggregateOpenRiskRate:
          0.02,
      },

      checks,

      safety: {
        databaseReads:
          0,

        databaseWrites:
          0,

        kisRequests:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,
      },

      productionLogicChanged:
        true,

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
