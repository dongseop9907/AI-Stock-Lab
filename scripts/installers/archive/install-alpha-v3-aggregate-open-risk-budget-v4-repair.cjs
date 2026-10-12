const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const VERSION =
  "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_IMPLEMENTATION_V4_REPAIR";

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
  start = 0,
  end = lines.length
) {
  for (
    let i = start;
    i < Math.min(end, lines.length);
    i += 1
  ) {
    if (predicate(lines[i], i)) {
      return i;
    }
  }

  throw new Error(
    `PATCH_ANCHOR_NOT_FOUND:${label}`
  );
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

function countChar(text, ch) {
  let count = 0;

  for (const c of text) {
    if (c === ch) {
      count += 1;
    }
  }

  return count;
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
    const opens =
      countChar(lines[i], "{");

    const closes =
      countChar(lines[i], "}");

    if (opens > 0) {
      opened = true;
    }

    depth += opens;
    depth -= closes;

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
 * 0) Restore clean pre-V2 source
 * ================================================= */
const restoreTargets = [
  files.policy,
  files.types,
  files.riskManager,
  files.paperOrder,
];

if (fs.existsSync(files.preflight)) {
  restoreTargets.push(
    files.preflight
  );
}

for (const file of restoreTargets) {
  required(file);
  required(backupPath(file));

  fs.copyFileSync(
    backupPath(file),
    file
  );
}

/* =================================================
 * 1) policy.ts
 * ================================================= */
{
  const lines =
    linesOf(files.policy);

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

  saveLines(
    files.policy,
    lines
  );
}

/* =================================================
 * 2) types.ts
 * ================================================= */
{
  const lines =
    linesOf(files.types);

  const inputAnchor =
    findLine(
      lines,
      (line) =>
        line.trim() ===
        "currentSectorExposureAmount: number;",
      "types-input"
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

  const issueAnchor =
    findLine(
      lines,
      (line) =>
        line.includes(
          '"DAILY_LOSS_LIMIT_REACHED"'
        ),
      "types-issue"
    );

  insertBefore(
    lines,
    issueAnchor,
    [
      '  | "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"',
      '  | "OPEN_POSITION_STOP_MISSING"',
    ]
  );

  saveLines(
    files.types,
    lines
  );
}

/* =================================================
 * 3) risk-manager.ts
 * ================================================= */
{
  const lines =
    linesOf(files.riskManager);

  const issuesLine =
    findLine(
      lines,
      (line) =>
        line.includes(
          "const issues: RiskIssue[] = [];"
        ),
      "risk-issues"
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
      "risk-max-sector"
    );

  const sectorEnd =
    findStatementEnd(
      lines,
      sectorStart,
      "risk-max-sector"
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
      "risk-single-trade-if"
    );

  const riskIfEnd =
    findBlockEnd(
      lines,
      riskIfStart,
      "risk-single-trade-if"
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
      "risk-cash-limit"
    );

  const cashEnd =
    findStatementEnd(
      lines,
      cashStart,
      "risk-cash-limit"
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
      "risk-min-start"
    );

  const minEnd =
    findStatementEnd(
      lines,
      minStart,
      "risk-min-end"
    );

  insertBefore(
    lines,
    minEnd,
    [
      "    aggregateOpenRiskQuantityLimit,",
    ]
  );

  const firstZeroingGate =
    findLine(
      lines,
      (line) =>
        line.includes(
          "input.isNewPosition &&"
        ),
      "risk-zeroing-gate",
      minEnd
    );

  const insertIndex =
    firstZeroingGate > 0 &&
    lines[
      firstZeroingGate - 1
    ].trim() ===
      "if ("
      ? firstZeroingGate - 1
      : firstZeroingGate;

  insertBefore(
    lines,
    insertIndex,
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
 * 4) Caller helpers
 * ================================================= */

function findPaperPositionsTableLine(
  lines,
  label
) {
  return findLine(
    lines,
    (line) =>
      line.includes(
        "paper_positions"
      ),
    `${label}-paper-positions-token`
  );
}

function patchPositionInterface(
  lines,
  label
) {
  const start =
    findLine(
      lines,
      (line) =>
        line.trim() ===
        "interface PositionRecord {",
      `${label}-position-interface`
    );

  const end =
    findBlockEnd(
      lines,
      start,
      `${label}-position-interface`
    );

  const avg =
    findLine(
      lines,
      (line) =>
        line.includes(
          "average_price:"
        ),
      `${label}-position-average`,
      start,
      end + 1
    );

  insertAfter(
    lines,
    avg,
    [
      "  current_stop_price: number | string;",
    ]
  );
}

function patchPaperPositionSelect(
  lines,
  label
) {
  const tableLine =
    findPaperPositionsTableLine(
      lines,
      label
    );

  /*
   * Search forward for the average_price selected for this table.
   * The two current files use either:
   *   .from("paper_positions")
   * or
   *   .from(
   *     "paper_positions",
   *   )
   */
  const avg =
    findLine(
      lines,
      (line) =>
        line.trim() ===
          "average_price" ||
        line.trim() ===
          "average_price,",
      `${label}-select-average`,
      tableLine,
      Math.min(
        lines.length,
        tableLine + 40
      )
    );

  const indent =
    lines[avg]
      .match(/^\s*/)?.[0] ??
    "";

  lines[avg] =
    `${indent}average_price,`;

  insertAfter(
    lines,
    avg,
    [
      `${indent}current_stop_price`,
    ]
  );
}

function patchAggregateVariables(
  lines,
  label
) {
  const sectorVar =
    findLine(
      lines,
      (line) =>
        line.includes(
          "let currentSectorExposureAmount"
        ),
      `${label}-sector-var`
    );

  const sectorVarEnd =
    findStatementEnd(
      lines,
      sectorVar,
      `${label}-sector-var`
    );

  insertAfter(
    lines,
    sectorVarEnd,
    [
      "",
      "  let currentAggregateOpenRiskAmount =",
      "    0;",
      "",
      "  let openPositionsMissingValidStopCount =",
      "    0;",
    ]
  );
}

function patchAggregateCalculation(
  lines,
  label
) {
  const positionValue =
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
      positionValue,
      `${label}-position-value`
    );

  insertAfter(
    lines,
    positionValueEnd,
    [
      "",
      "    const averagePrice =",
      "      toNumber(",
      "        position.average_price,",
      "      );",
      "",
      "    const currentStopPrice =",
      "      toNumber(",
      "        position.current_stop_price,",
      "      );",
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
      "        ) *",
      "        position.quantity;",
      "    } else if (",
      "      position.quantity > 0",
      "    ) {",
      "      openPositionsMissingValidStopCount +=",
      "        1;",
      "    }",
    ]
  );
}

function patchRiskInput(
  lines,
  label
) {
  const riskInput =
    findLine(
      lines,
      (line) =>
        line.includes(
          "const riskInput"
        ),
      `${label}-risk-input`
    );

  const sectorInput =
    findLine(
      lines,
      (line) =>
        line.trim() ===
        "currentSectorExposureAmount,",
      `${label}-risk-sector`,
      riskInput,
      Math.min(
        lines.length,
        riskInput + 80
      )
    );

  const indent =
    lines[sectorInput]
      .match(/^\s*/)?.[0] ??
    "    ";

  insertAfter(
    lines,
    sectorInput,
    [
      `${indent}currentAggregateOpenRiskAmount,`,
      `${indent}openPositionsMissingValidStopCount,`,
    ]
  );
}

function patchAccountSnapshotIfPresent(
  lines
) {
  const accountSnapshot =
    lines.findIndex(
      (line) =>
        line.includes(
          "accountSnapshot:"
        )
    );

  if (
    accountSnapshot < 0
  ) {
    return;
  }

  const sector =
    findLine(
      lines,
      (line) =>
        line.trim() ===
        "currentSectorExposureAmount,",
      "account-snapshot-sector",
      accountSnapshot,
      Math.min(
        lines.length,
        accountSnapshot + 50
      )
    );

  const indent =
    lines[sector]
      .match(/^\s*/)?.[0] ??
    "      ";

  insertAfter(
    lines,
    sector,
    [
      `${indent}currentAggregateOpenRiskAmount,`,
      `${indent}openPositionsMissingValidStopCount,`,
    ]
  );
}

function patchCaller(
  file,
  label
) {
  const lines =
    linesOf(file);

  patchPositionInterface(
    lines,
    label
  );

  patchPaperPositionSelect(
    lines,
    label
  );

  patchAggregateVariables(
    lines,
    label
  );

  patchAggregateCalculation(
    lines,
    label
  );

  patchRiskInput(
    lines,
    label
  );

  patchAccountSnapshotIfPresent(
    lines
  );

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
 * 5) Pure read-only verifier
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
  "ALPHA_V3_AGGREGATE_OPEN_RISK_VERIFY_V4";

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
        exactlyAtLimit
          .maxAllowedQuantity,

      issues:
        exactlyAtLimit.issues,
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
        aboveLimit.issues,
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
        missingStop.issues,
    },

    quantityLimited: {
      approved:
        quantityLimited.approved,

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

write(
  files.verify,
  verifier
);

/* =================================================
 * 6) Static verification
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
  restoredCleanV2Backups:
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

  managerAggregate:
    riskText.includes(
      "aggregateOpenRiskQuantityLimit"
    ) &&
    riskText.includes(
      'code: "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED"'
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

  preflightReadsStop:
    preflightText === null ||
    preflightText.includes(
      "current_stop_price"
    ),

  preflightPassesAggregate:
    preflightText === null ||
    (
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
          ? "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_V4_REPAIRED_AND_IMPLEMENTED"
          : "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_V4_REPAIR_INCOMPLETE",

      version:
        VERSION,

      restoreSource:
        "*.bak-alpha-v3-aggregate-open-risk-v2",

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
          ? "RUN_ALPHA_V3_AGGREGATE_OPEN_RISK_VERIFY_V4"
          : "STOP_AND_REVIEW_REPAIR",
    },
    null,
    2
  )
);

if (!allChecksPassed) {
  process.exitCode = 2;
}
