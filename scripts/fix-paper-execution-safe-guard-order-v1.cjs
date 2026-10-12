const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const PAPER = path.join(
  ROOT,
  "lib",
  "trading",
  "execute-paper-order.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "paper-execution-safe-guard-order-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_EXECUTION_SAFE_GUARD_ORDER_V1_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(PAPER)) {
  fail(
    "EXECUTE_PAPER_ORDER_SOURCE_NOT_FOUND"
  );
  return;
}

function extractBraceBlock(
  source,
  startIndex
) {
  const braceStart =
    source.indexOf(
      "{",
      startIndex
    );

  if (braceStart < 0) {
    return null;
  }

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (
    let i = braceStart;
    i < source.length;
    i++
  ) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === "\n") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (
        ch === "*" &&
        next === "/"
      ) {
        blockComment = false;
        i += 1;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote !== null) {
      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (
      ch === "/" &&
      next === "/"
    ) {
      lineComment = true;
      i += 1;
      continue;
    }

    if (
      ch === "/" &&
      next === "*"
    ) {
      blockComment = true;
      i += 1;
      continue;
    }

    if (
      ch === "'" ||
      ch === '"' ||
      ch.charCodeAt(0) === 96
    ) {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;

      if (depth === 0) {
        return {
          start:
            startIndex,

          end:
            i + 1,

          text:
            source.slice(
              startIndex,
              i + 1
            )
        };
      }
    }
  }

  return null;
}

let source =
  fs.readFileSync(
    PAPER,
    "utf8"
  );

const guardMarker =
  "  if (\n    !safeExecution.allowed ||";

const guardStart =
  source.indexOf(
    guardMarker
  );

const marketInputMarker =
  "  const realismMarketInput =";

const marketInputStart =
  source.indexOf(
    marketInputMarker
  );

if (
  guardStart < 0 ||
  marketInputStart < 0
) {
  fail(
    "EXPECTED_GUARD_OR_MARKET_INPUT_MARKER_NOT_FOUND",
    {
      guardStart,
      marketInputStart
    }
  );
  return;
}

if (
  guardStart <
  marketInputStart
) {
  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_EXECUTION_SAFE_GUARD_ORDER_V1_ALREADY_REPAIRED",

    checks: {
      guardBeforeNullableUse:
        true,

      productLogicChanged:
        false
    },

    safety: {
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
      "RUN_STATIC_AND_NEXT_BUILD"
  }, null, 2));

  process.exitCode = 0;
  return;
}

const block =
  extractBraceBlock(
    source,
    guardStart
  );

if (!block) {
  fail(
    "SAFE_EXECUTION_GUARD_BLOCK_EXTRACTION_FAILED"
  );
  return;
}

if (
  !block.text.includes(
    "failUnsafePaperBuyExecution"
  ) ||
  !block.text.includes(
    "PAPER_BUY_EXECUTION_BLOCKED"
  )
) {
  fail(
    "EXTRACTED_BLOCK_IS_NOT_EXPECTED_FAIL_CLOSED_GUARD"
  );
  return;
}

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
    "execute-paper-order.before-safe-guard-order-v1.ts"
  );

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    PAPER,
    backup
  );
}

let withoutGuard =
  source.slice(
    0,
    block.start
  ) +
  source.slice(
    block.end
  );

withoutGuard =
  withoutGuard.replace(
    /\n{4,}/g,
    "\n\n\n"
  );

const newMarketIndex =
  withoutGuard.indexOf(
    marketInputMarker
  );

if (newMarketIndex < 0) {
  fail(
    "MARKET_INPUT_MARKER_LOST_AFTER_GUARD_REMOVAL"
  );
  return;
}

const movedGuard =
  block.text.trimEnd() +
  "\n\n";

const repaired =
  withoutGuard.slice(
    0,
    newMarketIndex
  ) +
  movedGuard +
  withoutGuard.slice(
    newMarketIndex
  );

const finalGuardIndex =
  repaired.indexOf(
    guardMarker
  );

const observedAtUseIndex =
  repaired.indexOf(
    "observedAt: safeExecution.executionPriceObservedAt"
  );

const realismNowUseIndex =
  repaired.indexOf(
    "now:\n        safeExecution.executionPriceObservedAt"
  );

const rpcObservedAtIndex =
  repaired.indexOf(
    "p_execution_observed_at:"
  );

const guardCount =
  (
    repaired.match(
      /!safeExecution\.allowed/g
    ) ||
    []
  ).length;

const checks = {
  guardExists:
    finalGuardIndex >= 0,

  guardUnique:
    guardCount === 1,

  guardBeforeMarketInput:
    finalGuardIndex >= 0 &&
    finalGuardIndex <
      repaired.indexOf(
        marketInputMarker
      ),

  guardBeforeObservedAtUse:
    finalGuardIndex >= 0 &&
    observedAtUseIndex >= 0 &&
    finalGuardIndex <
      observedAtUseIndex,

  guardBeforeRealismNowUse:
    finalGuardIndex >= 0 &&
    realismNowUseIndex >= 0 &&
    finalGuardIndex <
      realismNowUseIndex,

  guardBeforeRpcObservedAt:
    finalGuardIndex >= 0 &&
    rpcObservedAtIndex >= 0 &&
    finalGuardIndex <
      rpcObservedAtIndex,

  failClosedBehaviorPreserved:
    repaired.includes(
      "failUnsafePaperBuyExecution"
    ) &&
    repaired.includes(
      '"PAPER_BUY_EXECUTION_BLOCKED"'
    ),

  fallbackTimestampInvented:
    false,

  executionSemanticsChanged:
    false
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        ![
          "fallbackTimestampInvented",
          "executionSemanticsChanged"
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
      failed
    }
  );
  return;
}

fs.writeFileSync(
  PAPER,
  repaired,
  "utf8"
);

const staticSource = `const fs = require("fs");
const path = require("path");

const file = path.join(
  process.cwd(),
  "lib",
  "trading",
  "execute-paper-order.ts"
);

if (!fs.existsSync(file)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_EXECUTION_SAFE_GUARD_ORDER_V1_STATIC_FAILED",
    failed: [
      "sourceExists"
    ]
  }, null, 2));
  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      file,
      "utf8"
    );

  const guard =
    source.indexOf(
      "  if (\\n    !safeExecution.allowed ||"
    );

  const market =
    source.indexOf(
      "  const realismMarketInput ="
    );

  const observed =
    source.indexOf(
      "observedAt: safeExecution.executionPriceObservedAt"
    );

  const nowUse =
    source.indexOf(
      "now:\\n        safeExecution.executionPriceObservedAt"
    );

  const checks = {
    sourceExists:
      true,

    guardBeforeMarketInput:
      guard >= 0 &&
      market >= 0 &&
      guard < market,

    guardBeforeObservedAt:
      guard >= 0 &&
      observed >= 0 &&
      guard < observed,

    guardBeforeRealismNow:
      guard >= 0 &&
      nowUse >= 0 &&
      guard < nowUse,

    failClosedStillPresent:
      source.includes(
        "failUnsafePaperBuyExecution"
      ) &&
      source.includes(
        "\\"PAPER_BUY_EXECUTION_BLOCKED\\""
      ),

    noFallbackTimestamp:
      !source.includes(
        "executionPriceObservedAt ?? new Date"
      ) &&
      !source.includes(
        "executionPriceObservedAt || new Date"
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
        ? "AI_STOCK_LAB_PAPER_EXECUTION_SAFE_GUARD_ORDER_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_PAPER_EXECUTION_SAFE_GUARD_ORDER_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      fallbackTimestampInvented:
        false,

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
        ? "RUN_NEXT_BUILD"
        : "REPAIR_SAFE_EXECUTION_GUARD_ORDER"
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

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_EXECUTION_SAFE_GUARD_ORDER_V1_REPAIRED",

  changedFile:
    "lib/trading/execute-paper-order.ts",

  generatedFile:
    "scripts/paper-execution-safe-guard-order-v1-static-verify.cjs",

  backupFile:
    "scripts/backups/execute-paper-order.before-safe-guard-order-v1.ts",

  repair: {
    previousProblem:
      "nullable safeExecution fields were consumed before existing fail-closed guard",

    newOrder:
      "validate safeExecution first, then resolve realism market input and evaluate realism",

    fallbackTimestamp:
      "NOT_INVENTED",

    failClosedBehavior:
      "PRESERVED"
  },

  checks,

  safety: {
    installerExecutedPaperOrder:
      false,

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
}, null, 2));

process.exitCode = 0;
