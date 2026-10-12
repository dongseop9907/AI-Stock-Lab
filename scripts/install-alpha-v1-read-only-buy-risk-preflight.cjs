#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_READ_ONLY_BUY_RISK_PREFLIGHT_INSTALLER';

const helper =
  "import {\n  createSupabaseServerClient,\n} from \"@/lib/supabase\";\n\nimport {\n  resolveOrderModel,\n} from \"@/lib/models/resolve-order-model\";\n\nimport {\n  validateBuyRisk,\n} from \"@/lib/trading/risk-manager\";\n\nimport type {\n  BuyRiskInput,\n  BuyRiskResult,\n} from \"@/lib/trading/types\";\n\nexport interface ReadOnlyBuyRiskPreflightInput {\n  stockCode: string;\n  modelId: string;\n\n  entryPrice: number;\n  proposedStopPrice: number;\n  requestedQuantity: number;\n\n  entryObservedAt?: string | null;\n}\n\ninterface PaperAccountRecord {\n  id: string;\n  cash_balance: number | string;\n  daily_realized_pnl: number | string;\n  trading_mode: \"PAPER\" | \"LIVE\";\n}\n\ninterface PositionRecord {\n  stock_code: string;\n  sector: string | null;\n  quantity: number;\n  average_price: number | string;\n}\n\ninterface StockRecord {\n  stock_code: string;\n  stock_name: string;\n  sector: string | null;\n}\n\ninterface SnapshotRecord {\n  stock_code: string;\n  close_price: number | string | null;\n  observed_at: string;\n}\n\nfunction toNumber(\n  value:\n    | number\n    | string\n    | null\n    | undefined,\n): number {\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : 0;\n}\n\nfunction validatePreflightRequest(\n  input:\n    ReadOnlyBuyRiskPreflightInput,\n) {\n  if (\n    !input.stockCode\n      ?.trim()\n  ) {\n    throw new Error(\n      \"PREFLIGHT_STOCK_CODE_REQUIRED\",\n    );\n  }\n\n  if (\n    !input.modelId\n      ?.trim()\n  ) {\n    throw new Error(\n      \"PREFLIGHT_MODEL_ID_REQUIRED\",\n    );\n  }\n\n  if (\n    !Number.isFinite(\n      input.entryPrice,\n    ) ||\n    input.entryPrice <=\n      0\n  ) {\n    throw new Error(\n      \"PREFLIGHT_ENTRY_PRICE_INVALID\",\n    );\n  }\n\n  if (\n    !Number.isFinite(\n      input.proposedStopPrice,\n    ) ||\n    input.proposedStopPrice <=\n      0\n  ) {\n    throw new Error(\n      \"PREFLIGHT_STOP_PRICE_INVALID\",\n    );\n  }\n\n  if (\n    !Number.isInteger(\n      input.requestedQuantity,\n    ) ||\n    input.requestedQuantity <=\n      0\n  ) {\n    throw new Error(\n      \"PREFLIGHT_QUANTITY_INVALID\",\n    );\n  }\n}\n\nexport async function evaluateReadOnlyBuyRiskPreflight(\n  input:\n    ReadOnlyBuyRiskPreflightInput,\n) {\n  validatePreflightRequest(\n    input,\n  );\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data: accountData,\n    error: accountError,\n  } =\n    await supabase\n      .from(\n        \"paper_accounts\",\n      )\n      .select(`\n        id,\n        cash_balance,\n        daily_realized_pnl,\n        trading_mode\n      `)\n      .eq(\n        \"account_name\",\n        \"default-paper\",\n      )\n      .single();\n\n  if (\n    accountError ||\n    !accountData\n  ) {\n    throw new Error(\n      `PREFLIGHT_ACCOUNT_READ_FAILED:${\n        accountError\n          ?.message ??\n        \"ACCOUNT_NOT_FOUND\"\n      }`,\n    );\n  }\n\n  const account =\n    accountData as\n      PaperAccountRecord;\n\n  if (\n    account.trading_mode !==\n    \"PAPER\"\n  ) {\n    throw new Error(\n      \"PREFLIGHT_REQUIRES_PAPER_ACCOUNT\",\n    );\n  }\n\n  const orderModel =\n    await resolveOrderModel(\n      input.modelId,\n      account.trading_mode,\n    );\n\n  const {\n    data: stockData,\n    error: stockError,\n  } =\n    await supabase\n      .from(\n        \"stocks\",\n      )\n      .select(\n        \"stock_code, stock_name, sector\",\n      )\n      .eq(\n        \"stock_code\",\n        input.stockCode,\n      )\n      .eq(\n        \"is_active\",\n        true,\n      )\n      .single();\n\n  if (\n    stockError ||\n    !stockData\n  ) {\n    throw new Error(\n      `PREFLIGHT_STOCK_READ_FAILED:${\n        stockError\n          ?.message ??\n        input.stockCode\n      }`,\n    );\n  }\n\n  const stock =\n    stockData as\n      StockRecord;\n\n  /*\n   * Read the latest target price only for drift diagnostics.\n   * The actual validator uses the Entry Timing candidate's entryPrice,\n   * preserving the exact proposed trade being preflighted.\n   */\n  const {\n    data:\n      targetSnapshots,\n    error:\n      targetPriceError,\n  } =\n    await supabase\n      .from(\n        \"market_snapshots\",\n      )\n      .select(\n        \"stock_code, close_price, observed_at\",\n      )\n      .eq(\n        \"stock_code\",\n        input.stockCode,\n      )\n      .order(\n        \"observed_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(1);\n\n  if (\n    targetPriceError\n  ) {\n    throw new Error(\n      `PREFLIGHT_TARGET_PRICE_READ_FAILED:${targetPriceError.message}`,\n    );\n  }\n\n  const latestTargetSnapshot =\n    (\n      targetSnapshots?.[0] ??\n      null\n    ) as\n      SnapshotRecord |\n      null;\n\n  const latestMarketPrice =\n    toNumber(\n      latestTargetSnapshot\n        ?.close_price,\n    );\n\n  const {\n    data: positionData,\n    error: positionError,\n  } =\n    await supabase\n      .from(\n        \"paper_positions\",\n      )\n      .select(`\n        stock_code,\n        sector,\n        quantity,\n        average_price\n      `)\n      .eq(\n        \"account_id\",\n        account.id,\n      );\n\n  if (\n    positionError\n  ) {\n    throw new Error(\n      `PREFLIGHT_POSITION_READ_FAILED:${positionError.message}`,\n    );\n  }\n\n  const positions =\n    (\n      positionData ??\n      []\n    ) as\n      PositionRecord[];\n\n  const positionCodes =\n    [\n      ...new Set(\n        positions.map(\n          (\n            position,\n          ) =>\n            position\n              .stock_code,\n        ),\n      ),\n    ];\n\n  let snapshotRows:\n    SnapshotRecord[] =\n    [];\n\n  if (\n    positionCodes.length >\n    0\n  ) {\n    const {\n      data,\n      error,\n    } =\n      await supabase\n        .from(\n          \"market_snapshots\",\n        )\n        .select(\n          \"stock_code, close_price, observed_at\",\n        )\n        .in(\n          \"stock_code\",\n          positionCodes,\n        )\n        .order(\n          \"observed_at\",\n          {\n            ascending:\n              false,\n          },\n        );\n\n    if (error) {\n      throw new Error(\n        `PREFLIGHT_POSITION_PRICE_READ_FAILED:${error.message}`,\n      );\n    }\n\n    snapshotRows =\n      (\n        data ??\n        []\n      ) as\n        SnapshotRecord[];\n  }\n\n  const latestPriceByStock =\n    new Map<\n      string,\n      number\n    >();\n\n  for (\n    const snapshot\n    of snapshotRows\n  ) {\n    if (\n      latestPriceByStock\n        .has(\n          snapshot\n            .stock_code,\n        )\n    ) {\n      continue;\n    }\n\n    const price =\n      toNumber(\n        snapshot\n          .close_price,\n      );\n\n    if (\n      price >\n      0\n    ) {\n      latestPriceByStock\n        .set(\n          snapshot\n            .stock_code,\n          price,\n        );\n    }\n  }\n\n  let currentInvestedAmount =\n    0;\n\n  let currentStockExposureAmount =\n    0;\n\n  let currentSectorExposureAmount =\n    0;\n\n  for (\n    const position\n    of positions\n  ) {\n    const currentPrice =\n      latestPriceByStock\n        .get(\n          position\n            .stock_code,\n        ) ??\n      toNumber(\n        position\n          .average_price,\n      );\n\n    const positionValue =\n      currentPrice *\n      position.quantity;\n\n    currentInvestedAmount +=\n      positionValue;\n\n    if (\n      position.stock_code ===\n      input.stockCode\n    ) {\n      currentStockExposureAmount +=\n        positionValue;\n    }\n\n    if (\n      stock.sector &&\n      position.sector ===\n        stock.sector\n    ) {\n      currentSectorExposureAmount +=\n        positionValue;\n    }\n  }\n\n  const cashBalance =\n    toNumber(\n      account\n        .cash_balance,\n    );\n\n  const accountEquity =\n    cashBalance +\n    currentInvestedAmount;\n\n  const existingPosition =\n    positions.find(\n      (\n        position,\n      ) =>\n        position.stock_code ===\n        input.stockCode,\n    );\n\n  const riskInput:\n    BuyRiskInput =\n    {\n      stockCode:\n        input.stockCode,\n\n      entryPrice:\n        input.entryPrice,\n\n      proposedStopPrice:\n        input.proposedStopPrice,\n\n      requestedQuantity:\n        input.requestedQuantity,\n\n      accountEquity,\n      availableCash:\n        cashBalance,\n\n      currentInvestedAmount,\n      currentStockExposureAmount,\n      currentSectorExposureAmount,\n\n      dailyRealizedPnl:\n        toNumber(\n          account\n            .daily_realized_pnl,\n        ),\n\n      openPositionCount:\n        positions.length,\n\n      isNewPosition:\n        !existingPosition,\n\n      tradingMode:\n        account\n          .trading_mode,\n\n      modelStatus:\n        orderModel.status,\n    };\n\n  const riskResult:\n    BuyRiskResult =\n    validateBuyRisk(\n      riskInput,\n    );\n\n  const marketPriceDifference =\n    latestMarketPrice >\n      0\n      ? latestMarketPrice -\n        input.entryPrice\n      : null;\n\n  const marketPriceDifferenceRate =\n    latestMarketPrice >\n      0 &&\n    input.entryPrice >\n      0\n      ? (\n          latestMarketPrice -\n          input.entryPrice\n        ) /\n        input.entryPrice\n      : null;\n\n  const priceDriftWarnings:\n    string[] =\n    [];\n\n  if (\n    latestMarketPrice >\n      0 &&\n    latestMarketPrice !==\n      input.entryPrice\n  ) {\n    priceDriftWarnings.push(\n      \"ENTRY_PRICE_DIFFERS_FROM_LATEST_SNAPSHOT\",\n    );\n  }\n\n  if (\n    input.entryObservedAt &&\n    latestTargetSnapshot\n      ?.observed_at &&\n    new Date(\n      latestTargetSnapshot\n        .observed_at,\n    ).getTime() >\n      new Date(\n        input.entryObservedAt,\n      ).getTime()\n  ) {\n    priceDriftWarnings.push(\n      \"NEWER_MARKET_SNAPSHOT_EXISTS_AFTER_ENTRY_CANDIDATE\",\n    );\n  }\n\n  return {\n    status:\n      \"READ_ONLY_BUY_RISK_PREFLIGHT_COMPLETE\",\n\n    input: {\n      stockCode:\n        input.stockCode,\n\n      modelId:\n        input.modelId,\n\n      entryPrice:\n        input.entryPrice,\n\n      proposedStopPrice:\n        input.proposedStopPrice,\n\n      requestedQuantity:\n        input.requestedQuantity,\n\n      entryObservedAt:\n        input\n          .entryObservedAt ??\n        null,\n    },\n\n    resolved: {\n      accountId:\n        account.id,\n\n      tradingMode:\n        account\n          .trading_mode,\n\n      modelStatus:\n        orderModel.status,\n\n      stockName:\n        stock.stock_name,\n\n      sector:\n        stock.sector,\n\n      latestMarketPrice:\n        latestMarketPrice >\n          0\n          ? latestMarketPrice\n          : null,\n\n      latestMarketObservedAt:\n        latestTargetSnapshot\n          ?.observed_at ??\n        null,\n\n      marketPriceDifference,\n      marketPriceDifferenceRate,\n\n      priceDriftWarnings,\n    },\n\n    accountSnapshot: {\n      accountEquity,\n      availableCash:\n        cashBalance,\n\n      currentInvestedAmount,\n      currentStockExposureAmount,\n      currentSectorExposureAmount,\n\n      dailyRealizedPnl:\n        toNumber(\n          account\n            .daily_realized_pnl,\n        ),\n\n      openPositionCount:\n        positions.length,\n\n      isNewPosition:\n        !existingPosition,\n    },\n\n    riskInput,\n    risk:\n      riskResult,\n\n    approved:\n      riskResult\n        .approved,\n\n    executionEligible:\n      riskResult\n        .approved &&\n      priceDriftWarnings\n        .length ===\n        0,\n\n    executionBlockers: [\n      ...(\n        riskResult\n          .approved\n          ? []\n          : riskResult\n              .issues\n              .map(\n                (\n                  issue,\n                ) =>\n                  `RISK:${issue.code}`,\n              )\n      ),\n\n      ...priceDriftWarnings,\n    ],\n\n    safety: {\n      databaseWrites:\n        0,\n\n      riskDecisionWrites:\n        0,\n\n      entrySignalWrites:\n        0,\n\n      orderWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n    },\n  };\n}\n";

const smoke =
  "import {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nimport {\n  evaluateReadOnlyBuyRiskPreflight,\n} from \"../lib/trading/read-only-buy-risk-preflight\";\n\nconst VERSION =\n  \"ALPHA_V1_READ_ONLY_BUY_RISK_PREFLIGHT_SMOKE\";\n\nfunction toNumber(\n  value: unknown,\n): number {\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : 0;\n}\n\nasync function resolveLatestEntryModelId() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const candidate =\n    await supabase\n      .from(\n        \"ai_model_versions\",\n      )\n      .select(\n        \"id, status, purpose, created_at\",\n      )\n      .eq(\n        \"purpose\",\n        \"ENTRY_TIMING\",\n      )\n      .eq(\n        \"status\",\n        \"CANDIDATE\",\n      )\n      .order(\n        \"created_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(1)\n      .maybeSingle();\n\n  if (\n    candidate.error\n  ) {\n    throw new Error(\n      `ENTRY_MODEL_CANDIDATE_READ_FAILED:${candidate.error.message}`,\n    );\n  }\n\n  if (\n    candidate.data\n      ?.id\n  ) {\n    return String(\n      candidate.data.id,\n    );\n  }\n\n  const approved =\n    await supabase\n      .from(\n        \"ai_model_versions\",\n      )\n      .select(\n        \"id, status, purpose, approved_at\",\n      )\n      .eq(\n        \"purpose\",\n        \"ENTRY_TIMING\",\n      )\n      .eq(\n        \"status\",\n        \"APPROVED\",\n      )\n      .order(\n        \"approved_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(1)\n      .maybeSingle();\n\n  if (\n    approved.error\n  ) {\n    throw new Error(\n      `ENTRY_MODEL_APPROVED_READ_FAILED:${approved.error.message}`,\n    );\n  }\n\n  if (\n    !approved.data\n      ?.id\n  ) {\n    throw new Error(\n      \"ACTIVE_ENTRY_TIMING_MODEL_NOT_FOUND\",\n    );\n  }\n\n  return String(\n    approved.data.id,\n  );\n}\n\nasync function main() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const stockCode =\n    \"005930\";\n\n  const modelId =\n    await resolveLatestEntryModelId();\n\n  const snapshot =\n    await supabase\n      .from(\n        \"market_snapshots\",\n      )\n      .select(\n        \"stock_code, close_price, observed_at\",\n      )\n      .eq(\n        \"stock_code\",\n        stockCode,\n      )\n      .order(\n        \"observed_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(1)\n      .maybeSingle();\n\n  if (\n    snapshot.error ||\n    !snapshot.data\n  ) {\n    throw new Error(\n      `TARGET_SNAPSHOT_READ_FAILED:${\n        snapshot.error\n          ?.message ??\n        \"NO_SNAPSHOT\"\n      }`,\n    );\n  }\n\n  const entryPrice =\n    toNumber(\n      snapshot\n        .data\n        .close_price,\n    );\n\n  if (\n    entryPrice <=\n    0\n  ) {\n    throw new Error(\n      \"TARGET_ENTRY_PRICE_INVALID\",\n    );\n  }\n\n  const proposedStopPrice =\n    Math.floor(\n      entryPrice *\n      0.975,\n    );\n\n  const preflight =\n    await evaluateReadOnlyBuyRiskPreflight({\n      stockCode,\n      modelId,\n      entryPrice,\n      proposedStopPrice,\n      requestedQuantity:\n        1,\n\n      entryObservedAt:\n        String(\n          snapshot\n            .data\n            .observed_at,\n        ),\n    });\n\n  const report = {\n    status:\n      \"ALPHA_V1_READ_ONLY_BUY_RISK_PREFLIGHT_SMOKE_COMPLETE\",\n\n    version:\n      VERSION,\n\n    diagnosticFixture: {\n      stockCode,\n      modelId,\n      entryPrice,\n      proposedStopPrice,\n      requestedQuantity:\n        1,\n\n      stopDistanceRate:\n        (\n          entryPrice -\n          proposedStopPrice\n        ) /\n        entryPrice,\n    },\n\n    preflight,\n\n    contract: {\n      riskFormula:\n        \"EXISTING_VALIDATE_BUY_RISK\",\n\n      accountContext:\n        \"SAME_PAPER_ACCOUNT_POSITION_MARK_TO_MARKET_CONTRACT_AS_PAPER_ORDER_SERVICE\",\n\n      ordersCreated:\n        0,\n\n      riskDecisionWrites:\n        0,\n\n      entrySignalWrites:\n        0,\n    },\n\n    nextGate:\n      \"ALPHA_V1_BIND_READ_ONLY_RISK_PREFLIGHT_AFTER_ENTRY_TIMING_CANDIDATE\",\n  };\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (\n    error,\n  ) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_READ_ONLY_BUY_RISK_PREFLIGHT_SMOKE_FAILED\",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            riskDecisionWrites:\n              0,\n\n            entrySignalWrites:\n              0,\n\n            orderWrites:\n              0,\n\n            ordersCreated:\n              0,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

function atomicWrite(
  file,
  content,
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive:
        true,
    },
  );

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    content,
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
}

try {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  atomicWrite(
    path.join(
      root,
      'lib',
      'trading',
      'read-only-buy-risk-preflight.ts',
    ),
    helper,
  );

  atomicWrite(
    path.join(
      root,
      'scripts',
      'alpha-v1-read-only-buy-risk-preflight-smoke.ts',
    ),
    smoke,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_READ_ONLY_BUY_RISK_PREFLIGHT_INSTALLED',

        version:
          VERSION,

        files: [
          'lib/trading/read-only-buy-risk-preflight.ts',
          'scripts/alpha-v1-read-only-buy-risk-preflight-smoke.ts',
        ],

        contract: {
          candidateTradeInput: [
            'stockCode',
            'modelId',
            'entryPrice',
            'proposedStopPrice',
            'requestedQuantity',
            'entryObservedAt',
          ],

          riskValidator:
            'EXISTING_VALIDATE_BUY_RISK',

          accountContext:
            'MIRROR_PAPER_ORDER_SERVICE_READS',

          productionServiceModified:
            false,

          riskFormulaDuplicated:
            false,

          writes: {
            riskDecisions:
              0,

            aiEntrySignals:
              0,

            paperOrderRequests:
              0,
          },
        },

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },

        nextAction:
          'RUN_READ_ONLY_BUY_RISK_PREFLIGHT_SMOKE',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_READ_ONLY_BUY_RISK_PREFLIGHT_INSTALL_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        ordersCreated:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode =
    2;
}
