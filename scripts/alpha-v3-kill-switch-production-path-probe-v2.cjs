const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "lib/trading/get-trading-system-control.ts",
  "app/api/trading/system/control/route.ts",
  "app/api/trading/automation/run/route.ts",
  "app/api/trading/automation/cycle/route.ts",
  "app/api/trading/automation/manual/route.ts",
  "app/api/orders/paper/route.ts",
  "app/api/orders/paper/execute/route.ts",
  "app/api/orders/paper/execute-approved/route.ts",
  "lib/trading/paper-order-service.ts",
  "lib/trading/committed-risk-reservation.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "lib/trading/execute-paper-order.ts",
  "lib/trading/generate-entry-signals.ts",
  "app/api/trading/stop-loss/check/route.ts",
  "app/api/trading/trailing-stop/update/route.ts",
  "scripts/alpha-v3-automation-cycle-scheduler.ts",
  "supabase/migrations/018_trading_system_controls.sql",
  "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql",
  "supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql"
];

const terms = [
  "emergencyStop",
  "emergency_stop",
  "automationEnabled",
  "automation_enabled",
  "paperOrderEnabled",
  "paper_order_enabled",
  "realOrderEnabled",
  "real_order_enabled",
  "getTradingSystemControl",
  "createPaperBuyOrder",
  "createPaperBuyOrderWithCommittedRisk",
  "executeApprovedPaperOrders",
  "executePaperOrder",
  "execute_paper_buy_order",
  "autoOrder",
  "RISK_APPROVED",
  "stop-loss",
  "trailing-stop",
  "fetch(",
  ".rpc(",
  ".from("
];

function lineNumber(text, index) {
  return text.slice(0, Math.max(0, index)).split("\n").length;
}

function excerpt(lines, line, radius = 8) {
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);

  return {
    startLine: start,
    endLine: end,
    text: lines
      .slice(start - 1, end)
      .map((value, i) => `${start + i}: ${value}`)
      .join("\n")
  };
}

function findAll(text, needle) {
  const result = [];
  let cursor = 0;

  while (true) {
    const index = text.indexOf(needle, cursor);

    if (index < 0) {
      break;
    }

    result.push({
      index,
      line: lineNumber(text, index)
    });

    cursor = index + Math.max(needle.length, 1);
  }

  return result;
}

function collectFunctionsOrBlocks(text, lines) {
  const evidence = [];

  const patterns = [
    {
      label: "CONTROL_READ_BLOCK",
      regex: /getTradingSystemControl\s*\(/g
    },
    {
      label: "EMERGENCY_STOP_BLOCK",
      regex: /emergencyStop|emergency_stop/g
    },
    {
      label: "AUTO_ORDER_BLOCK",
      regex: /autoOrder/g
    },
    {
      label: "ORDER_CREATE_BLOCK",
      regex: /createPaperBuyOrder(?:WithCommittedRisk)?\s*\(/g
    },
    {
      label: "APPROVED_EXECUTION_BLOCK",
      regex: /executeApprovedPaperOrders\s*\(/g
    },
    {
      label: "ORDER_EXECUTION_BLOCK",
      regex: /executePaperOrder\s*\(/g
    },
    {
      label: "FILL_RPC_BLOCK",
      regex: /execute_paper_buy_order/g
    },
    {
      label: "RISK_APPROVED_BLOCK",
      regex: /RISK_APPROVED/g
    }
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.regex.exec(text)) !== null) {
      const line = lineNumber(text, match.index);

      evidence.push({
        label: pattern.label,
        line,
        excerpt: excerpt(lines, line, 10)
      });

      if (evidence.length >= 80) {
        return evidence;
      }
    }
  }

  return evidence;
}

function classifyFile(rel, text) {
  const lower = text.toLowerCase();

  const readsControl =
    text.includes("getTradingSystemControl") ||
    (
      lower.includes("trading_system_control") &&
      (
        lower.includes(".select(") ||
        /select[\s\S]{0,200}trading_system_control/i.test(text)
      )
    );

  const checksEmergency =
    /emergencyStop|emergency_stop/.test(text);

  const checksAutomationEnabled =
    /automationEnabled|automation_enabled/.test(text);

  const checksPaperOrderEnabled =
    /paperOrderEnabled|paper_order_enabled/.test(text);

  const checksRealOrderEnabled =
    /realOrderEnabled|real_order_enabled/.test(text);

  const canCreateOrder =
    /createPaperBuyOrder(?:WithCommittedRisk)?/.test(text) ||
    /create_paper_buy_order_with_committed_risk_v3/.test(text);

  const canExecuteOrder =
    /executeApprovedPaperOrders|executePaperOrder|execute_paper_buy_order/.test(text);

  const canTriggerAutomation =
    rel.includes("/automation/") ||
    rel.includes("automation-cycle-scheduler");

  const looksProtectiveExit =
    rel.includes("stop-loss") ||
    rel.includes("trailing-stop");

  const isBoundary =
    rel.startsWith("app/api/") ||
    rel.includes("automation-cycle-scheduler");

  const needsKillSwitchGuard =
    (
      canCreateOrder ||
      canExecuteOrder ||
      canTriggerAutomation
    ) &&
    !looksProtectiveExit;

  let risk = "LOW";

  if (
    needsKillSwitchGuard &&
    !readsControl &&
    !checksEmergency
  ) {
    risk = "HIGH";
  } else if (
    needsKillSwitchGuard &&
    (
      readsControl ||
      checksEmergency
    )
  ) {
    risk = "CONTROL_AWARE";
  } else if (looksProtectiveExit) {
    risk = "PROTECTIVE_EXIT_REVIEW";
  }

  return {
    readsControl,
    checksEmergency,
    checksAutomationEnabled,
    checksPaperOrderEnabled,
    checksRealOrderEnabled,
    canCreateOrder,
    canExecuteOrder,
    canTriggerAutomation,
    looksProtectiveExit,
    isBoundary,
    needsKillSwitchGuard,
    risk
  };
}

const results = [];

for (const rel of targets) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    results.push({
      file: rel,
      exists: false
    });
    continue;
  }

  const text = fs
    .readFileSync(abs, "utf8")
    .replace(/\r\n/g, "\n");

  const lines = text.split("\n");

  const termHits = {};

  for (const term of terms) {
    const matches = findAll(text, term);

    if (matches.length > 0) {
      termHits[term] = matches
        .slice(0, 12)
        .map((item) => ({
          line: item.line,
          excerpt: excerpt(lines, item.line, 4)
        }));
    }
  }

  results.push({
    file: rel,
    exists: true,
    lineCount: lines.length,
    classification: classifyFile(rel, text),
    evidence: collectFunctionsOrBlocks(text, lines),
    termHits
  });
}

const productionResults =
  results.filter(
    (item) =>
      item.exists &&
      !item.file.startsWith("supabase/migrations/")
  );

const highRisk =
  productionResults.filter(
    (item) =>
      item.classification?.risk === "HIGH"
  );

const controlAware =
  productionResults.filter(
    (item) =>
      item.classification?.risk === "CONTROL_AWARE"
  );

const protective =
  productionResults.filter(
    (item) =>
      item.classification?.risk === "PROTECTIVE_EXIT_REVIEW"
  );

const missing =
  results
    .filter((item) => !item.exists)
    .map((item) => item.file);

const report = {
  status:
    "ALPHA_V3_KILL_SWITCH_PRODUCTION_PATH_PROBE_V2_COMPLETE",

  summary: {
    targetFileCount: targets.length,
    existingFileCount:
      results.filter((item) => item.exists).length,
    missingFileCount: missing.length,

    productionHighRiskCount:
      highRisk.length,

    productionControlAwareCount:
      controlAware.length,

    protectiveExitReviewCount:
      protective.length,

    highRiskFiles:
      highRisk.map((item) => item.file),

    controlAwareFiles:
      controlAware.map((item) => item.file),

    protectiveExitFiles:
      protective.map((item) => item.file),

    missingFiles: missing
  },

  productionPolicyCandidate: {
    authoritativeSource:
      "trading_system_control.emergency_stop",

    semantics: {
      emergencyStopTrue:
        "LATCHED_NEW_ENTRY_AND_BUY_EXECUTION_BLOCK",

      automationEnabledFalse:
        "AUTOMATION_CYCLE_SHOULD_NOT_START_NORMAL_TRADING_WORK",

      paperOrderEnabledFalse:
        "NO_NEW_PAPER_BUY_ORDER_AND_NO_APPROVED_BUY_EXECUTION",

      realOrderEnabledFalse:
        "NO_LIVE_ORDER_SUBMISSION"
    },

    protectiveExitPolicy:
      "STOP_LOSS_AND_TRAILING_EXIT_SHOULD_REMAIN_ALLOWED_WHILE_KILL_SWITCH_IS_ACTIVE_UNLESS_A_SEPARATE_HARD_SHUTDOWN_MODE_IS_EXPLICITLY_INTRODUCED",

    defenseInDepthCandidate: [
      "AUTOMATION_RUN_BOUNDARY",
      "PAPER_ORDER_CREATE_SERVICE",
      "APPROVED_ORDER_EXECUTOR",
      "SINGLE_ORDER_EXECUTOR",
      "DB_CREATE_RPC",
      "DB_FILL_RPC"
    ],

    resetPolicyCandidate:
      "MANUAL_EXPLICIT_RESET_WITH_REASON_ACTOR_TIMESTAMP_AND_AUDIT_ONLY",

    latchPolicyCandidate:
      "AUTO_TRIGGER_CAN_SET_TRUE_BUT_NEVER_AUTO_RESET_TO_FALSE"
  },

  results,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    ordersChanged: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-kill-switch-production-path-probe-v2.json",

  nextGate:
    "REVIEW_PRODUCTION_GUARD_GAPS_THEN_BUILD_KILL_SWITCH_CONTRACT_V1"
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.resolve(
    root,
    "logs/alpha-v3-kill-switch-production-path-probe-v2.json"
  ),
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status: report.status,
      summary: report.summary,
      productionPolicyCandidate:
        report.productionPolicyCandidate,
      safety: report.safety,
      logFile: report.logFile,
      nextGate: report.nextGate
    },
    null,
    2
  )
);
