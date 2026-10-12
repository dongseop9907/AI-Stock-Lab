const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const target = path.join(
  ROOT,
  "lib",
  "trading",
  "execute-paper-order.ts"
);

if (!fs.existsSync(target)) {
  throw new Error(
    `TARGET_NOT_FOUND:${target}`
  );
}

const before =
  fs.readFileSync(
    target,
    "utf8"
  );

const v4Count =
  (
    before.match(
      /execute_paper_buy_order_with_execution_price_v4/g
    ) || []
  ).length;

const v5Count =
  (
    before.match(
      /execute_paper_buy_order_with_execution_price_v5/g
    ) || []
  ).length;

if (v5Count > 0 && v4Count === 0) {
  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_CALLER_ALREADY_V5",

    target:
      "lib/trading/execute-paper-order.ts",

    v5References:
      v5Count,

    productionModified:
      false
  }, null, 2));

  process.exitCode = 0;
}
else {
  if (v4Count !== 1) {
    throw new Error(
      `EXPECTED_EXACTLY_ONE_V4_REFERENCE count=${v4Count}`
    );
  }

  const after =
    before.replace(
      /execute_paper_buy_order_with_execution_price_v4/g,
      "execute_paper_buy_order_with_execution_price_v5"
    );

  fs.writeFileSync(
    target,
    after,
    "utf8"
  );

  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_CALLER_UPDATED",

    target:
      "lib/trading/execute-paper-order.ts",

    change:
      "execute_paper_buy_order_with_execution_price_v4 -> execute_paper_buy_order_with_execution_price_v5",

    callerArgumentShapeChanged:
      false,

    productionModified:
      true,

    realTradingEnabled:
      false
  }, null, 2));

  process.exitCode = 0;
}
