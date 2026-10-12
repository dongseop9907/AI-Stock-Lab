const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const VERSION =
  "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_IMPLEMENTATION_V3_REPAIR";

const files = {
  policy: path.resolve(ROOT, "lib/trading/policy.ts"),
  types: path.resolve(ROOT, "lib/trading/types.ts"),
  riskManager: path.resolve(ROOT, "lib/trading/risk-manager.ts"),
  paperOrder: path.resolve(ROOT, "lib/trading/paper-order-service.ts"),
  preflight: path.resolve(ROOT, "lib/trading/read-only-buy-risk-preflight.ts"),
  verify: path.resolve(ROOT, "scripts/alpha-v3-aggregate-open-risk-verify.ts"),
};

const backupSuffix =
  ".bak-alpha-v3-aggregate-open-risk-v2";

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

function read(file) {
  return normalize(
    fs.readFileSync(file, "utf8")
  );
}

function write(file, text) {
  fs.writeFileSync(
    file,
    text.endsWith("\n")
      ? text
      : `${text}\n`,
    "utf8"
  );
}

function required(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `REQUIRED_FILE_NOT_FOUND:${path.relative(ROOT, file)}`
    );
  }
}

function backupPath(file) {
  return `${file}${backupSuffix}`;
}

for (const file of [
  files.policy,
  files.types,
  files.riskManager,
  files.paperOrder,
]) {
  required(file);
  required(backupPath(file));
}

if (fs.existsSync(files.preflight)) {
  required(backupPath(files.preflight));
}

/*
 * Always restore the clean pre-V2 state first.
 * This removes the malformed V2 insertion before applying V3.
 */
const restoreTargets = [
  files.policy,
  files.types,
  files.riskManager,
  files.paperOrder,
];

if (fs.existsSync(files.preflight)) {
  restoreTargets.push(files.preflight);
}

for (const file of restoreTargets) {
  fs.copyFileSync(
    backupPath(file),
    file
  );
}

function linesOf(file) {
  return read(file).split("\n");
}

function saveLines(file, lines) {
  write(
    file,
    lines.join("\n")
  );
}

function findLine(
  lines,
  predicate,
  label,
  start = 0
) {
  const index =
    lines.findIndex(
      (line, i) =>
        i >= start &&
        predicate(line, i)
    );

  if (index < 0) {
    throw new Error(
      `PATCH_ANCHOR_NOT_FOUND:${label}`
    );
  }

  return index;
}

function findStatementEnd(
  lines,
  start,
  label
) {
  for (
    let i = start;
    i < lines.length;
    i += 1
  ) {
    if (
      lines[i].trim().endsWith(";")
    ) {
      return i;
    }
  }

  throw new Error(
    `STATEMENT_END_NOT_FOUND:${label}`
  );
}

function countChar(
  text,
  char
) {
  return [
    ...text,
  ].filter(
    (c) => c === char
  ).length;
}

function findBlockEnd(
  lines,
  start,
  label
) {
  let depth = 0;
  let opened = false;

  for (
    let i = start;
    i < lines.length;
    i += 1
  ) {
    depth +=
      countChar(
        lines[i],
        "{"
      );

    if (
      countChar(
        lines[i],
        "{"
      ) > 0
    ) {
      opened = true;
    }

    depth -=
      countChar(
        lines[i],
        "}"
      );

    if (
      opened &&
      depth === 0
    ) {
      return i;
    }
  }

  throw new Error(
    `BLOCK_END_NOT_FOUND:${label}`
  );
}

function insertAfter(
  lines,
  index,
  newLines
) {
  lines.splice(
    index + 1,
    0,
    ...newLines
  );
}

function insertBefore(
  lines,
  index,
  newLines
) {
  lines.splice(
    index,
    0,
    ...newLines
  );
}

/* =================================================
 * 1) policy.ts
 * ================================================= */
{
  const lines = linesOf(files.policy);

  if (
    !lines.some(
      (line) =>
        line.includes(
          "maxAggregateOpenRiskRate"
        )
    )
  ) {
    const interfaceAnchor =
      findLine(
        lines,
        (line) =>
          line.trim() ===
          "maxStopDistanceRate: number;",
        "policy-interface"
      );

    insertAfter(
      lines,
      interfaceAnchor,
      [
        "",
        "  /** 열린 모든 포지션의 stop 기준 총 잠재 손실 한도 */",
        "  maxAggregateOpenRiskRate?: number;",
      ]
    );

    const defaultAnchor =
      findLine(
        lines,
        (line) =>
          /^maxStopDistanceRate:\s*0\.05,$/.test(
            line.trim()
          ),
        "policy-default"
      );

    insertAfter(
      lines,
      defaultAnchor,
      [
        "  maxAggregateOpenRiskRate: 0.02,",
      ]
    );
  }

  saveLines(files.policy, lines);
}

/* =================================================
 * 2) types.ts
 * ================================================= */
{
  const lines = linesOf(files.types);

  if (
    !lines.some(
      (line) =>
        line.includes(
          "currentAggregateOpenRiskAmount"
        )
    )
  ) {
    const inputAnchor =
      findLine(
        lines,
        (line) =>
          line.trim() ===
          "currentSectorExposureAmount: number;",
        "types-buy-risk-input"
      );

    insertAfter(
      lines,
      inputAnchor,
      [
        "",
        "  /** 현재 열린 포지션들의 stop 기준 총 잠재 손실액 */",
        "  currentAggregateOpenRiskAmount?: number;",
        "",
        "  /** 유효한 stop을 확인할 수 없는 열린 포지션 수 */",
        "  openPositionsMissingValidStopCount?: number;",
      ]
    );
  }

  if (
    !lines.some(
      (line) =>
        line.includes(
          '"AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"'
        )
    )
  ) {
    const issueAnchor =
      findLine(
        lines,
        (line) =>
          line.includes(
            '"DAILY_LOSS_LIMIT_REACHED"'
          ),
        "types-risk-issue-code"
      );

    insertBefore(
      lines,
      issueAnchor,
      [
        '  | "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"',
        '  | "OPEN_POSITION_STOP_MISSING"',
      ]
    );
  }

  saveLines(files.types, lines);
}

/* =================================================
 * 3) risk-manager.ts
 * ================================================= */
{
  const lines = linesOf(files.riskManager);

  const issuesLine =
    findLine(
      lines,
      (line) =>
        line.includes(
          "const issues: RiskIssue[] = [];"
        ),
      "risk-manager-issues"
    );

  insertAfter(
    lines,
    issuesLine,
    [
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
    ]
  );

  const sectorStart =
    findLine(
      lines,
      (line) =>
        line.includes(
          "const maxSectorAmount ="
        ),
      "risk-manager-max-sector"
    );

  const sectorEnd =
    findStatementEnd(
      lines,
      sectorStart,
      "risk-manager-max-sector"
    );

  insertAfter(
    lines,
    sectorEnd,
    [
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
    ]
  );

  const riskIfStart =
    findLine(
      lines,
      (line) =>
        line.includes(
          "if (totalRiskAmount > maxRiskAmount)"
        ),
      "risk-manager-risk-limit-if"
    );

  const riskIfEnd =
    findBlockEnd(
      lines,
      riskIfStart,
      "risk-manager-risk-limit-if"
    );

  insertAfter(
    lines,
    riskIfEnd,
    [
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
    ]
  );

  const cashStart =
    findLine(
      lines,
      (line) =>
        line.includes(
          "const cashQuantityLimit ="
        ),
      "risk-manager-cash-limit"
    );

  const cashEnd =
    findStatementEnd(
      lines,
      cashStart,
      "risk-manager-cash-limit"
    );

  insertAfter(
    lines,
    cashEnd,
    [
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
    ]
  );

  const minStart =
    findLine(
      lines,
      (line) =>
        line.includes(
          "let maxAllowedQuantity = Math.min("
        ),
      "risk-manager-max-allowed"
    );

  const minEnd =
    findStatementEnd(
      lines,
      minStart,
      "risk-manager-max-allowed"
    );

  if (
    !lines
      .slice(
        minStart,
        minEnd + 1
      )
      .some(
        (line) =>
          line.includes(
            "aggregateOpenRiskQuantityLimit"
          )
      )
  ) {
    insertBefore(
      lines,
      minEnd,
      [
        "    aggregateOpenRiskQuantityLimit,",
      ]
    );
  }

  /*
   * Fail closed when an existing open position lacks a valid stop.
   * Insert before the existing max-position / daily-loss zeroing section.
   */
  const maxPositionGate =
    findLine(
      lines,
      (line) =>
        line.includes(
          "input.isNewPosition &&"
        ),
      "risk-manager-max-position-zero",
      minEnd
    );

  const maxPositionIfStart =
    maxPositionGate > 0 &&
    lines[maxPositionGate - 1].trim() ===
      "if ("
      ? maxPositionGate - 1
      : maxPositionGate;

  insertBefore(
    lines,
    maxPositionIfStart,
    [
      "  if (",
      "    openPositionsMissingValidStopCount > 0",
      "  ) {",
      "    maxAllowedQuantity = 0;",
      "  }",
      "",
    ]
  );

  saveLines(
    files.riskManager,
    lines
  );
}

/* =================================================
 * 4) caller patcher
 * ================================================= */
function patchCaller(
  file,
  label
) {
  const lines = linesOf(file);

  const positionInterface =
    findLine(
      lines,
      (line) =>
        line.trim() ===
        "interface PositionRecord {",
      `${label}-position-interface-start`
    );

  const positionInterfaceEnd =
    findBlockEnd(
      lines,
      positionInterface,
      `${label}-position-interface-end`
    );

  if (
    !lines
      .slice(
        positionInterface,
        positionInterfaceEnd + 1
      )
      .some(
        (line) =>
          line.includes(
            "current_stop_price"
          )
      )
  ) {
    const avgLine =
      findLine(
        lines,
        (line) =>
          line.includes(
            "average_price:"
          ),
        `${label}-average-interface`,
        positionInterface
      );

    insertAfter(
      lines,
      avgLine,
      [
        "  current_stop_price: number | string;",
      ]
    );
  }

  const paperPositionsLine =
    findLine(
      lines,
      (line) =>
        line.includes(
          '.from("paper_positions")'
        ),
      `${label}-paper-positions`
    );

  const selectAverageLine =
    findLine(
      lines,
      (line) =>
        line.trim() ===
          "average_price" ||
        line.trim() ===
          "average_price,",
      `${label}-paper-select-average`,
      paperPositionsLine
    );

  if (
    !lines
      .slice(
        selectAverageLine,
        Math.min(
          lines.length,
          selectAverageLine + 5
        )
      )
      .some(
        (line) =>
          line.includes(
            "current_stop_price"
          )
      )
  ) {
    const indent =
      lines[
        selectAverageLine
      ].match(/^\s*/)?.[0] ??
      "          ";

    lines[
      selectAverageLine
    ] =
      `${indent}average_price,`;

    insertAfter(
      lines,
      selectAverageLine,
      [
        `${indent}current_stop_price`,
      ]
    );
  }

  const sectorVar =
    findLine(
      lines,
      (line) =>
        line.includes(
          "let currentSectorExposureAmount = 0;"
        ),
      `${label}-sector-var`
    );

  insertAfter(
    lines,
    sectorVar,
    [
      "  let currentAggregateOpenRiskAmount = 0;",
      "  let openPositionsMissingValidStopCount = 0;",
    ]
  );

  const positionValueStart =
    findLine(
      lines,
      (line) =>
        line.includes(
          "const positionValue ="
        ),
      `${label}-position-value`
    );

  const positionValueEnd =
    findStatementEnd(
      lines,
      positionValueStart,
      `${label}-position-value`
    );

  insertAfter(
    lines,
    positionValueEnd,
    [
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
    ]
  );

  const riskInputStart =
    findLine(
      lines,
      (line) =>
        line.includes(
          "const riskInput"
        ),
      `${label}-risk-input-start`
    );

  const riskInputSector =
    findLine(
      lines,
      (line) =>
        line.trim() ===
        "currentSectorExposureAmount,",
      `${label}-risk-input-sector`,
      riskInputStart
    );

  insertAfter(
    lines,
    riskInputSector,
    [
      "    currentAggregateOpenRiskAmount,",
      "    openPositionsMissingValidStopCount,",
    ]
  );

  /*
   * Persist/return diagnostics if an accountSnapshot object exists.
   */
  const accountSnapshotIndex =
    lines.findIndex(
      (line) =>
        line.includes(
          "accountSnapshot:"
        )
    );

  if (
    accountSnapshotIndex >= 0
  ) {
    const snapshotSector =
      findLine(
        lines,
        (line) =>
          line.trim() ===
          "currentSectorExposureAmount,",
        `${label}-snapshot-sector`,
        accountSnapshotIndex
      );

    insertAfter(
      lines,
      snapshotSector,
      [
        "            currentAggregateOpenRiskAmount,",
        "            openPositionsMissingValidStopCount,",
      ]
    );
  }

  saveLines(
    file,
    lines
  );
}

patchCaller(
  files.paperOrder,
  "paper-order-service"
);

if (
  fs.existsSync(
    files.preflight
  )
) {
  patchCaller(
    files.preflight,
    "read-only-preflight"
  );
}

/* =================================================
 * 5) read-only verifier
 * ================================================= */
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
  "ALPHA_V3_AGGREGATE_OPEN_RISK_VERIFY_V3";

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

const exactlyAtLimit =
  validateBuyRisk(
    makeInput({
      currentAggregateOpenRiskAmount:
        150000,
      requestedQuantity:
        10,
    }),
  );

const aboveLimit =
  validateBuyRisk(
    makeInput({
      currentAggregateOpenRiskAmount:
        175000,
      requestedQuantity:
        10,
    }),
  );

const missingStop =
  validateBuyRisk(
    makeInput({
      requestedQuantity:
        1,
      openPositionsMissingValidStopCount:
        1,
    }),
  );

const quantityLimited =
  validateBuyRisk(
    makeInput({
      currentAggregateOpenRiskAmount:
        190000,
      requestedQuantity:
        10,
    }),
  );

function hasIssue(
  result:
    ReturnType<typeof validateBuyRisk>,
  code:
    string,
) {
  return result.issues.some(
    (issue) =>
      issue.code === code,
  );
}

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
        exactlyAtLimit.maxAllowedQuantity,
      issues:
        exactlyAtLimit.issues,
    },

    aboveLimit: {
      approved:
        aboveLimit.approved,
      maxAllowedQuantity:
        aboveLimit.maxAllowedQuantity,
      aggregateIssue:
        hasIssue(
          aboveLimit,
          "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",
        ),
      issues:
        aboveLimit.issues,
    },

    missingStop: {
      approved:
        missingStop.approved,
      maxAllowedQuantity:
        missingStop.maxAllowedQuantity,
      missingStopIssue:
        hasIssue(
          missingStop,
          "OPEN_POSITION_STOP_MISSING",
        ),
      issues:
        missingStop.issues,
    },

    quantityLimited: {
      approved:
        quantityLimited.approved,
      maxAllowedQuantity:
        quantityLimited.maxAllowedQuantity,
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

write(
  files.verify,
  verifier
);

/* =================================================
 * 6) static post-repair checks
 * ================================================= */
const policyText =
  read(files.policy);

const typesText =
  read(files.types);

const riskText =
  read(files.riskManager);

const orderText =
  read(files.paperOrder);

const preflightText =
  fs.existsSync(
    files.preflight
  )
    ? read(files.preflight)
    : null;

const checks = {
  restoredFromCleanV2Backups:
    true,

  policyField:
    policyText.includes(
      "maxAggregateOpenRiskRate?: number"
    ),

  policyValue:
    policyText.includes(
      "maxAggregateOpenRiskRate: 0.02"
    ),

  inputAggregate:
    typesText.includes(
      "currentAggregateOpenRiskAmount?: number"
    ),

  inputMissingStop:
    typesText.includes(
      "openPositionsMissingValidStopCount?: number"
    ),

  aggregateIssue:
    typesText.includes(
      '"AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"'
    ),

  missingStopIssue:
    typesText.includes(
      '"OPEN_POSITION_STOP_MISSING"'
    ),

  managerAggregateLimit:
    riskText.includes(
      "aggregateOpenRiskQuantityLimit"
    ),

  managerAggregateIssue:
    riskText.includes(
      'code: "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"'
    ),

  managerMissingStopIssue:
    riskText.includes(
      'code: "OPEN_POSITION_STOP_MISSING"'
    ),

  paperOrderReadsStop:
    orderText.includes(
      "current_stop_price"
    ),

  paperOrderPassesAggregate:
    orderText.includes(
      "currentAggregateOpenRiskAmount"
    ) &&
    orderText.includes(
      "openPositionsMissingValidStopCount"
    ),

  preflightCompatible:
    preflightText === null ||
    (
      preflightText.includes(
        "current_stop_price"
      ) &&
      preflightText.includes(
        "currentAggregateOpenRiskAmount"
      ) &&
      preflightText.includes(
        "openPositionsMissingValidStopCount"
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
          ? "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_REPAIRED_AND_IMPLEMENTED"
          : "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_REPAIR_INCOMPLETE",

      version:
        VERSION,

      restoreSource:
        "*.bak-alpha-v3-aggregate-open-risk-v2",

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

      nextAction:
        allChecksPassed
          ? "RUN_ALPHA_V3_AGGREGATE_OPEN_RISK_VERIFY_V3"
          : "STOP_AND_REVIEW_REPAIR",
    },
    null,
    2
  )
);

if (!allChecksPassed) {
  process.exitCode = 2;
}
