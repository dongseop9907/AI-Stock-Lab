const fs = require("fs");
const path = require("path");

const root = process.cwd();

const serviceRel =
  "lib/trading/paper-order-service.ts";

const serviceFile =
  path.resolve(root, serviceRel);

const typesFile =
  path.resolve(
    root,
    "lib/trading/types.ts"
  );

const verifierFile =
  path.resolve(
    root,
    "scripts/alpha-v3-paper-order-service-repair-v1-verify.cjs"
  );

const tsconfigFile =
  path.resolve(
    root,
    "tsconfig.alpha-v3-production-cycle.json"
  );

if (!fs.existsSync(serviceFile)) {
  throw new Error(
    "PAPER_ORDER_SERVICE_NOT_FOUND"
  );
}

if (!fs.existsSync(typesFile)) {
  throw new Error(
    "TRADING_TYPES_NOT_FOUND"
  );
}

const currentService =
  fs.readFileSync(
    serviceFile,
    "utf8"
  );

const backupFile =
  `${serviceFile}.before-alpha-v3-paper-order-service-repair-v1.bak`;

if (!fs.existsSync(backupFile)) {
  fs.copyFileSync(
    serviceFile,
    backupFile
  );
}

const typesText =
  fs.readFileSync(
    typesFile,
    "utf8"
  );

const buyRiskMatch =
  /export\s+interface\s+BuyRiskInput\s*\{([\s\S]*?)\n\}/m.exec(
    typesText
  );

if (!buyRiskMatch) {
  throw new Error(
    "BUY_RISK_INPUT_INTERFACE_NOT_FOUND"
  );
}

const buyRiskBody =
  buyRiskMatch[1];

const propertyNames =
  [
    ...buyRiskBody.matchAll(
      /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:/gm
    ),
  ].map(
    (match) =>
      match[1]
  );

const extraLines = [];

if (
  propertyNames.includes(
    "currentAggregateOpenRiskAmount"
  )
) {
  extraLines.push(
`    currentAggregateOpenRiskAmount,`
  );
}

const booleanLines =
  buyRiskBody
    .split(/\r?\n/)
    .map(
      (line) =>
        line.match(
          /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\??\s*:\s*boolean\s*;?/
        )
    )
    .filter(Boolean)
    .map(
      (match) =>
        match[1]
    );

const stopValidityField =
  booleanLines.find(
    (name) =>
      /stop/i.test(name) &&
      /(missing|invalid|valid)/i.test(name)
  ) ?? null;

if (stopValidityField) {
  if (
    /(missing|invalid)/i.test(
      stopValidityField
    )
  ) {
    extraLines.push(
`    ${stopValidityField}:
      hasMissingOpenPositionStop,`
    );
  } else if (
    /valid/i.test(
      stopValidityField
    )
  ) {
    extraLines.push(
`    ${stopValidityField}:
      !hasMissingOpenPositionStop,`
    );
  }
}

let source =
  "import { resolveOrderModel } from \"@/lib/models/resolve-order-model\";\nimport { createSupabaseServerClient } from \"@/lib/supabase\";\nimport { createPaperBuyOrderWithCommittedRisk } from \"@/lib/trading/committed-risk-reservation\";\nimport { validateBuyRisk } from \"@/lib/trading/risk-manager\";\n\ninterface CreatePaperBuyOrderInput {\n  stockCode: string;\n  proposedStopPrice: number;\n  requestedQuantity: number;\n  modelId: string;\n}\n\ninterface PaperAccountRecord {\n  id: string;\n  cash_balance: number | string;\n  daily_realized_pnl: number | string;\n  trading_mode: \"PAPER\" | \"LIVE\";\n}\n\ninterface PositionRecord {\n  stock_code: string;\n  sector: string | null;\n  quantity: number;\n  average_price: number | string;\n  current_stop_price: number | string | null;\n}\n\ninterface StockRecord {\n  stock_code: string;\n  stock_name: string;\n  sector: string | null;\n}\n\ninterface SnapshotRecord {\n  stock_code: string;\n  close_price: number | string | null;\n  observed_at: string;\n}\n\nfunction toNumber(\n  value: number | string | null,\n): number {\n  const parsed = Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : 0;\n}\n\nfunction validateRequest(\n  input: CreatePaperBuyOrderInput,\n): void {\n  if (!input.stockCode?.trim()) {\n    throw new Error(\n      \"\uc885\ubaa9\ucf54\ub4dc\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.\",\n    );\n  }\n\n  if (!input.modelId?.trim()) {\n    throw new Error(\n      \"\ubaa8\ub378 ID\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.\",\n    );\n  }\n\n  if (\n    !Number.isInteger(\n      input.requestedQuantity,\n    ) ||\n    input.requestedQuantity <= 0\n  ) {\n    throw new Error(\n      \"\uc8fc\ubb38 \uc218\ub7c9\uc740 1\uc8fc \uc774\uc0c1\uc758 \uc815\uc218\uc5ec\uc57c \ud569\ub2c8\ub2e4.\",\n    );\n  }\n\n  if (\n    !Number.isFinite(\n      input.proposedStopPrice,\n    ) ||\n    input.proposedStopPrice <= 0\n  ) {\n    throw new Error(\n      \"\uc190\uc808\uac00\uac00 \uc62c\ubc14\ub974\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.\",\n    );\n  }\n}\n\nexport async function createPaperBuyOrder(\n  input: CreatePaperBuyOrderInput,\n) {\n  validateRequest(input);\n\n  const supabase =\n    createSupabaseServerClient();\n\n  /*\n   * \uacc4\uc88c/\uc794\uc561\uc740 \ud074\ub77c\uc774\uc5b8\ud2b8 \uc785\ub825\uc744 \uc2e0\ub8b0\ud558\uc9c0 \uc54a\uace0\n   * \uc11c\ubc84 DB\uc5d0\uc11c \uc9c1\uc811 \uc870\ud68c\ud55c\ub2e4.\n   */\n  const {\n    data: accountData,\n    error: accountError,\n  } =\n    await supabase\n      .from(\"paper_accounts\")\n      .select(\n        `\n          id,\n          cash_balance,\n          daily_realized_pnl,\n          trading_mode\n        `,\n      )\n      .eq(\n        \"account_name\",\n        \"default-paper\",\n      )\n      .single();\n\n  if (\n    accountError ||\n    !accountData\n  ) {\n    throw new Error(\n      `\ubaa8\uc758\uacc4\uc88c \uc870\ud68c \uc2e4\ud328: ${\n        accountError?.message ??\n        \"\uacc4\uc88c\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.\"\n      }`,\n    );\n  }\n\n  const account =\n    accountData as PaperAccountRecord;\n\n  if (\n    account.trading_mode !==\n    \"PAPER\"\n  ) {\n    throw new Error(\n      \"\ud604\uc7ac \uc8fc\ubb38 API\ub294 \ubaa8\uc758\ud22c\uc790 \uacc4\uc88c\ub9cc \uc0ac\uc6a9\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.\",\n    );\n  }\n\n  const orderModel =\n    await resolveOrderModel(\n      input.modelId,\n      account.trading_mode,\n    );\n\n  const {\n    data: stockData,\n    error: stockError,\n  } =\n    await supabase\n      .from(\"stocks\")\n      .select(\n        \"stock_code, stock_name, sector\",\n      )\n      .eq(\n        \"stock_code\",\n        input.stockCode,\n      )\n      .eq(\n        \"is_active\",\n        true,\n      )\n      .single();\n\n  if (\n    stockError ||\n    !stockData\n  ) {\n    throw new Error(\n      `\uc885\ubaa9 \uc870\ud68c \uc2e4\ud328: ${\n        stockError?.message ??\n        input.stockCode\n      }`,\n    );\n  }\n\n  const stock =\n    stockData as StockRecord;\n\n  /*\n   * \ub9e4\uc218\uac00\ub3c4 \ud074\ub77c\uc774\uc5b8\ud2b8 \uc785\ub825\uc774 \uc544\ub2c8\ub77c\n   * \uc11c\ubc84\uc5d0 \uc800\uc7a5\ub41c \ucd5c\uc2e0 snapshot\uc744 \uc0ac\uc6a9\ud55c\ub2e4.\n   */\n  const {\n    data: targetSnapshots,\n    error: priceError,\n  } =\n    await supabase\n      .from(\"market_snapshots\")\n      .select(\n        \"stock_code, close_price, observed_at\",\n      )\n      .eq(\n        \"stock_code\",\n        input.stockCode,\n      )\n      .order(\n        \"observed_at\",\n        {\n          ascending: false,\n        },\n      )\n      .limit(1);\n\n  if (priceError) {\n    throw new Error(\n      `\ud604\uc7ac\uac00 \uc870\ud68c \uc2e4\ud328: ${priceError.message}`,\n    );\n  }\n\n  const latestTargetSnapshot =\n    targetSnapshots?.[0] as\n      | SnapshotRecord\n      | undefined;\n\n  const entryPrice =\n    toNumber(\n      latestTargetSnapshot\n        ?.close_price ??\n        null,\n    );\n\n  if (entryPrice <= 0) {\n    throw new Error(\n      \"\uc800\uc7a5\ub41c \ud604\uc7ac\uac00\uac00 \uc5c6\uc2b5\ub2c8\ub2e4. \uba3c\uc800 \uc2dc\uc138\ub97c \uc218\uc9d1\ud574 \uc8fc\uc138\uc694.\",\n    );\n  }\n\n  /*\n   * Risk V3:\n   * exposure + aggregate open stop-risk \uacc4\uc0b0\uc5d0\n   * \ud604\uc7ac \ubcf4\uc720 \ud3ec\uc9c0\uc158\uc758 \uc9c4\uc785\uac00\uc640 \uc190\uc808\uac00\uac00 \ubaa8\ub450 \ud544\uc694\ud558\ub2e4.\n   */\n  const {\n    data: positionData,\n    error: positionError,\n  } =\n    await supabase\n      .from(\"paper_positions\")\n      .select(\n        `\n          stock_code,\n          sector,\n          quantity,\n          average_price,\n          current_stop_price\n        `,\n      )\n      .eq(\n        \"account_id\",\n        account.id,\n      );\n\n  if (positionError) {\n    throw new Error(\n      `\ubcf4\uc720 \uc885\ubaa9 \uc870\ud68c \uc2e4\ud328: ${positionError.message}`,\n    );\n  }\n\n  const positions =\n    (\n      positionData ??\n      []\n    ) as PositionRecord[];\n\n  const positionCodes =\n    Array.from(\n      new Set(\n        positions.map(\n          (position) =>\n            position.stock_code,\n        ),\n      ),\n    );\n\n  let snapshotRows:\n    SnapshotRecord[] =\n    [];\n\n  if (\n    positionCodes.length > 0\n  ) {\n    const {\n      data,\n      error,\n    } =\n      await supabase\n        .from(\n          \"market_snapshots\",\n        )\n        .select(\n          \"stock_code, close_price, observed_at\",\n        )\n        .in(\n          \"stock_code\",\n          positionCodes,\n        )\n        .order(\n          \"observed_at\",\n          {\n            ascending: false,\n          },\n        );\n\n    if (error) {\n      throw new Error(\n        `\ubcf4\uc720 \uc885\ubaa9 \uc2dc\uc138 \uc870\ud68c \uc2e4\ud328: ${error.message}`,\n      );\n    }\n\n    snapshotRows =\n      (\n        data ??\n        []\n      ) as SnapshotRecord[];\n  }\n\n  const latestPriceByStock =\n    new Map<\n      string,\n      number\n    >();\n\n  for (\n    const snapshot of snapshotRows\n  ) {\n    if (\n      latestPriceByStock.has(\n        snapshot.stock_code,\n      )\n    ) {\n      continue;\n    }\n\n    const currentPrice =\n      toNumber(\n        snapshot.close_price,\n      );\n\n    if (\n      currentPrice > 0\n    ) {\n      latestPriceByStock.set(\n        snapshot.stock_code,\n        currentPrice,\n      );\n    }\n  }\n\n  let currentInvestedAmount =\n    0;\n\n  let currentStockExposureAmount =\n    0;\n\n  let currentSectorExposureAmount =\n    0;\n\n  let currentAggregateOpenRiskAmount =\n    0;\n\n  let hasMissingOpenPositionStop =\n    false;\n\n  for (\n    const position of positions\n  ) {\n    const currentPrice =\n      latestPriceByStock.get(\n        position.stock_code,\n      ) ??\n      toNumber(\n        position.average_price,\n      );\n\n    const positionValue =\n      currentPrice *\n      position.quantity;\n\n    currentInvestedAmount +=\n      positionValue;\n\n    if (\n      position.stock_code ===\n      input.stockCode\n    ) {\n      currentStockExposureAmount +=\n        positionValue;\n    }\n\n    if (\n      stock.sector &&\n      position.sector ===\n        stock.sector\n    ) {\n      currentSectorExposureAmount +=\n        positionValue;\n    }\n\n    const averagePrice =\n      toNumber(\n        position.average_price,\n      );\n\n    const stopPrice =\n      toNumber(\n        position.current_stop_price,\n      );\n\n    if (\n      averagePrice <= 0 ||\n      stopPrice <= 0\n    ) {\n      hasMissingOpenPositionStop =\n        true;\n\n      continue;\n    }\n\n    currentAggregateOpenRiskAmount +=\n      Math.max(\n        0,\n        averagePrice -\n          stopPrice,\n      ) *\n      Math.max(\n        0,\n        position.quantity,\n      );\n  }\n\n  const cashBalance =\n    toNumber(\n      account.cash_balance,\n    );\n\n  const accountEquity =\n    cashBalance +\n    currentInvestedAmount;\n\n  const existingPosition =\n    positions.find(\n      (position) =>\n        position.stock_code ===\n        input.stockCode,\n    );\n\n  const riskInput = {\n    stockCode:\n      input.stockCode,\n\n    entryPrice,\n\n    proposedStopPrice:\n      input.proposedStopPrice,\n\n    requestedQuantity:\n      input.requestedQuantity,\n\n    accountEquity,\n\n    availableCash:\n      cashBalance,\n\n    currentInvestedAmount,\n\n    currentStockExposureAmount,\n\n    currentSectorExposureAmount,\n\n__RISK_V3_EXTRA_FIELDS__\n\n    dailyRealizedPnl:\n      toNumber(\n        account.daily_realized_pnl,\n      ),\n\n    openPositionCount:\n      positions.length,\n\n    isNewPosition:\n      !existingPosition,\n\n    tradingMode:\n      account.trading_mode,\n\n    modelStatus:\n      orderModel.status,\n  };\n\n  const riskResult =\n    validateBuyRisk(\n      riskInput,\n    );\n\n  /*\n   * \uc0ac\uc804 \uc704\ud5d8\ud310\ub2e8\uc740 \uc2b9\uc778/\uac70\ubd80\uc640 \uad00\uacc4\uc5c6\uc774 \uae30\ub85d\ud55c\ub2e4.\n   * Atomic committed-risk RPC\ub294 \uc774 decision id\ub97c idempotency key\ub85c \uc0ac\uc6a9\ud55c\ub2e4.\n   */\n  const {\n    data: decisionData,\n    error: decisionError,\n  } =\n    await supabase\n      .from(\n        \"risk_decisions\",\n      )\n      .insert({\n        account_id:\n          account.id,\n\n        stock_code:\n          input.stockCode,\n\n        action:\n          \"BUY\",\n\n        approved:\n          riskResult.approved,\n\n        requested_payload: {\n          originalRequest:\n            input,\n\n          resolvedEntryPrice:\n            entryPrice,\n\n          priceObservedAt:\n            latestTargetSnapshot\n              ?.observed_at ??\n            null,\n\n          accountSnapshot: {\n            accountEquity,\n\n            availableCash:\n              cashBalance,\n\n            currentInvestedAmount,\n\n            currentStockExposureAmount,\n\n            currentSectorExposureAmount,\n\n            currentAggregateOpenRiskAmount,\n\n            hasMissingOpenPositionStop,\n\n            openPositionCount:\n              positions.length,\n          },\n        },\n\n        result_payload:\n          riskResult,\n      })\n      .select(\"id\")\n      .single();\n\n  if (\n    decisionError ||\n    !decisionData\n  ) {\n    throw new Error(\n      `\uc704\ud5d8\uac80\uc99d \uacb0\uacfc \uc800\uc7a5 \uc2e4\ud328: ${\n        decisionError?.message ??\n        \"\uacb0\uacfc\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.\"\n      }`,\n    );\n  }\n\n  /*\n   * Risk V3 committed-risk boundary.\n   *\n   * \uc5ec\uae30\uc11c\ubd80\ud130\ub294 paper_order_requests\uc5d0 \uc9c1\uc811 INSERT\ud558\uc9c0 \uc54a\ub294\ub2e4.\n   * PostgreSQL RPC\uac00 account-scoped advisory lock \uc544\ub798\uc5d0\uc11c:\n   * - \uae30\uc874 open position stop risk\n   * - active BUY reservation risk\n   * - \uc774\ubc88 proposed risk\n   * \ub97c \ud569\uc0b0\ud558\uace0 order + reservation\uc744 \uc6d0\uc790\uc801\uc73c\ub85c \ub9cc\ub4e0\ub2e4.\n   */\n  const committedOrderResult =\n    await createPaperBuyOrderWithCommittedRisk({\n      accountId:\n        account.id,\n\n      stockCode:\n        input.stockCode,\n\n      requestedQuantity:\n        input.requestedQuantity,\n\n      entryPrice,\n\n      stopPrice:\n        input.proposedStopPrice,\n\n      riskDecisionId:\n        decisionData.id,\n\n      preflightApproved:\n        riskResult.approved,\n\n      equity:\n        accountEquity,\n\n      maxAggregateOpenRiskRate:\n        0.02,\n    });\n\n  const orderData =\n    committedOrderResult.order;\n\n  const committedRisk =\n    committedOrderResult.committedRisk;\n\n  if (!orderData) {\n    throw new Error(\n      \"\ubaa8\uc758\uc8fc\ubb38 \uc800\uc7a5 \uc2e4\ud328: \uc8fc\ubb38 \uacb0\uacfc\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.\",\n    );\n  }\n\n  return {\n    account: {\n      id:\n        account.id,\n\n      accountEquity,\n\n      cashBalance,\n\n      tradingMode:\n        account.trading_mode,\n    },\n\n    stock: {\n      stockCode:\n        stock.stock_code,\n\n      stockName:\n        stock.stock_name,\n\n      entryPrice,\n\n      sector:\n        stock.sector,\n    },\n\n    risk: {\n      ...riskResult,\n\n      /*\n       * DB atomic committed-risk gate\uac00 \ucd5c\uc885 \uc2b9\uc778\uad8c\uc790\ub2e4.\n       * \uc0ac\uc804 riskResult\uac00 true\uc5ec\ub3c4 \ub3d9\uc2dc \uc8fc\ubb38 \ub54c\ubb38\uc5d0 \ucd5c\uc885 \uac70\ubd80\ub420 \uc218 \uc788\ub2e4.\n       */\n      approved:\n        orderData.status ===\n        \"RISK_APPROVED\",\n\n      committedRisk,\n    },\n\n    order:\n      orderData,\n  };\n}\n";

source =
  source.replace(
    "__RISK_V3_EXTRA_FIELDS__",
    extraLines.length > 0
      ? extraLines.join("\n\n")
      : ""
  );

fs.writeFileSync(
  serviceFile,
  source,
  "utf8"
);

fs.mkdirSync(
  path.dirname(verifierFile),
  {
    recursive: true
  }
);

fs.writeFileSync(
  verifierFile,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst serviceRel =\n  \"lib/trading/paper-order-service.ts\";\n\nconst serviceFile =\n  path.resolve(root, serviceRel);\n\nif (!fs.existsSync(serviceFile)) {\n  throw new Error(\n    \"PAPER_ORDER_SERVICE_NOT_FOUND\"\n  );\n}\n\nconst text =\n  fs.readFileSync(\n    serviceFile,\n    \"utf8\"\n  );\n\nconst checks = {\n  accountQueryRestored:\n    /\\.from\\(\"paper_accounts\"\\)/.test(\n      text\n    ),\n\n  modelResolutionRestored:\n    /resolveOrderModel\\s*\\(/.test(\n      text\n    ),\n\n  stockQueryRestored:\n    /\\.from\\(\"stocks\"\\)/.test(\n      text\n    ),\n\n  targetSnapshotRestored:\n    /\\.from\\(\"market_snapshots\"\\)[\\s\\S]{0,1000}?input\\.stockCode/.test(\n      text\n    ),\n\n  positionQueryIncludesStop:\n    /\\.from\\(\"paper_positions\"\\)[\\s\\S]{0,700}?current_stop_price/.test(\n      text\n    ),\n\n  aggregateOpenRiskCalculated:\n    /currentAggregateOpenRiskAmount\\s*\\+=/.test(\n      text\n    ) &&\n    /averagePrice[\\s\\S]{0,180}?stopPrice/.test(\n      text\n    ),\n\n  missingStopTracked:\n    /hasMissingOpenPositionStop/.test(\n      text\n    ),\n\n  riskPreflightRestored:\n    /validateBuyRisk\\s*\\(\\s*riskInput/.test(\n      text\n    ),\n\n  riskDecisionInsertRestored:\n    /\\.from\\(\\s*\"risk_decisions\"\\s*\\)[\\s\\S]{0,1200}?\\.insert\\s*\\(/.test(\n      text\n    ),\n\n  atomicCommittedRiskHelperUsed:\n    /createPaperBuyOrderWithCommittedRisk\\s*\\(\\s*\\{/.test(\n      text\n    ),\n\n  directPaperOrderInsertRemoved:\n    !/\\.from\\(\\s*\"paper_order_requests\"\\s*\\)[\\s\\S]{0,300}?\\.insert\\s*\\(/.test(\n      text\n    ),\n\n  atomicHelperUsesDecisionId:\n    /riskDecisionId\\s*:\\s*[\\s\\S]{0,80}?decisionData\\.id/.test(\n      text\n    ),\n\n  atomicHelperUsesPreflight:\n    /preflightApproved\\s*:\\s*[\\s\\S]{0,80}?riskResult\\.approved/.test(\n      text\n    ),\n\n  atomicHelperUsesEquity:\n    /equity\\s*:\\s*[\\s\\S]{0,80}?accountEquity/.test(\n      text\n    ),\n\n  finalApprovalUsesDbStatus:\n    /approved\\s*:\\s*[\\s\\S]{0,100}?orderData\\.status\\s*===\\s*[\\s\\S]{0,50}?\"RISK_APPROVED\"/.test(\n      text\n    ),\n\n  staleFakeOrderErrorRemoved:\n    !/\\bconst\\s+orderError\\b/.test(\n      text\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(\n      ([, value]) =>\n        value !== true\n    )\n    .map(\n      ([name]) =>\n        name\n    );\n\nconst result = {\n  status:\n    failed.length === 0\n      ? \"ALPHA_V3_PAPER_ORDER_SERVICE_REPAIR_V1_VERIFIED\"\n      : \"ALPHA_V3_PAPER_ORDER_SERVICE_REPAIR_V1_REVIEW\",\n\n  checks,\n  failed,\n\n  contract: {\n    restoredFlow: [\n      \"ACCOUNT\",\n      \"MODEL\",\n      \"STOCK\",\n      \"PRICE\",\n      \"POSITIONS\",\n      \"EXPOSURES\",\n      \"AGGREGATE_OPEN_RISK\",\n      \"VALIDATE_BUY_RISK\",\n      \"RISK_DECISION\",\n      \"ATOMIC_COMMITTED_RISK_ORDER_CREATE\",\n    ],\n\n    directPaperOrderInsert:\n      false,\n\n    committedRiskAtomicBoundary:\n      true,\n\n    databaseWritesByVerifier:\n      0,\n  },\n\n  nextGate:\n    failed.length === 0\n      ? \"RUN_TARGETED_PRODUCTION_TYPESCRIPT_CHECK\"\n      : \"REVIEW_PAPER_ORDER_SERVICE_REPAIR\",\n};\n\nconsole.log(\n  JSON.stringify(\n    result,\n    null,\n    2\n  )\n);\n\nif (\n  failed.length > 0\n) {\n  process.exitCode = 2;\n}\n",
  "utf8"
);

fs.writeFileSync(
  tsconfigFile,
  JSON.stringify(
    {"extends": "./tsconfig.json", "compilerOptions": {"noEmit": true, "types": ["node"], "skipLibCheck": true}, "include": ["lib/trading/paper-order-service.ts", "lib/trading/committed-risk-reservation.ts", "lib/trading/risk-manager.ts", "lib/trading/types.ts", "lib/trading/policy.ts", "lib/models/resolve-order-model.ts", "lib/supabase.ts", "lib/trading/automation-cycle-contract.ts", "lib/trading/run-committed-risk-maintenance.ts", "lib/trading/execute-approved-paper-orders.ts", "lib/trading/execute-paper-order.ts", "app/api/trading/automation/cycle/route.ts"], "exclude": ["scripts", "node_modules"]},
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_PAPER_ORDER_SERVICE_REPAIR_V1_INSTALLED",

      repairedFile:
        serviceRel,

      backupFile:
        "lib/trading/paper-order-service.ts.before-alpha-v3-paper-order-service-repair-v1.bak",

      detectedBuyRiskProperties:
        propertyNames,

      detectedAggregateRiskField:
        propertyNames.includes(
          "currentAggregateOpenRiskAmount"
        ),

      detectedStopValidityField:
        stopValidityField,

      generatedVerifier:
        "scripts/alpha-v3-paper-order-service-repair-v1-verify.cjs",

      generatedTargetedTsconfig:
        "tsconfig.alpha-v3-production-cycle.json",

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      nextAction:
        "VERIFY_REPAIR_THEN_RUN_TARGETED_PRODUCTION_TYPESCRIPT_CHECK"
    },
    null,
    2
  )
);
