const fs = require("fs");
const path = require("path");

const root = process.cwd();

const outputs = [
  {
    rel:
      "lib/trading/paper-execution-price-model.ts",
    text:
      "export const PAPER_EXECUTION_PRICE_MODEL_VERSION =\n  \"ALPHA_V3_PAPER_EXECUTION_PRICE_MODEL_V1\" as const;\n\nexport interface PaperExecutionPricePolicy {\n  maxSnapshotAgeMs: number;\n  maxFutureClockSkewMs: number;\n}\n\nexport const DEFAULT_PAPER_EXECUTION_PRICE_POLICY:\n  Readonly<PaperExecutionPricePolicy> =\n  Object.freeze({\n    maxSnapshotAgeMs:\n      10 * 60_000,\n\n    maxFutureClockSkewMs:\n      30_000,\n  });\n\nexport interface MarketSnapshotLike {\n  stock_code: string;\n  close_price:\n    | number\n    | string\n    | null;\n  observed_at: string;\n}\n\nexport type PaperExecutionPriceBlocker =\n  | \"STOCK_CODE_REQUIRED\"\n  | \"SNAPSHOT_NOT_FOUND\"\n  | \"SNAPSHOT_STOCK_MISMATCH\"\n  | \"SNAPSHOT_PRICE_INVALID\"\n  | \"SNAPSHOT_TIME_INVALID\"\n  | \"SNAPSHOT_FROM_FUTURE\"\n  | \"SNAPSHOT_STALE\";\n\nexport interface PaperExecutionPriceDecision {\n  version:\n    typeof PAPER_EXECUTION_PRICE_MODEL_VERSION;\n\n  usable: boolean;\n\n  blocker:\n    PaperExecutionPriceBlocker |\n    null;\n\n  executionPrice:\n    number |\n    null;\n\n  source:\n    \"MARKET_SNAPSHOT_CLOSE\";\n\n  observedAt:\n    string |\n    null;\n\n  ageMs:\n    number |\n    null;\n\n  policy:\n    PaperExecutionPricePolicy;\n\n  semantics: {\n    syntheticRandomSlippage: false;\n    plannedEntryPriceUsedAsFillFallback: false;\n    missingOrStaleMarketPriceFailsClosed: true;\n  };\n}\n\nfunction numeric(\n  value:\n    unknown,\n): number | null {\n  const parsed =\n    Number(\n      value,\n    );\n\n  return Number.isFinite(\n    parsed,\n  )\n    ? parsed\n    : null;\n}\n\nexport function evaluatePaperExecutionPriceSnapshot(\n  input: {\n    stockCode: string;\n    snapshot:\n      MarketSnapshotLike |\n      null;\n    now?: Date;\n  },\n  policy:\n    PaperExecutionPricePolicy =\n      DEFAULT_PAPER_EXECUTION_PRICE_POLICY,\n): PaperExecutionPriceDecision {\n  const now =\n    input.now ??\n    new Date();\n\n  const base = {\n    version:\n      PAPER_EXECUTION_PRICE_MODEL_VERSION,\n\n    source:\n      \"MARKET_SNAPSHOT_CLOSE\" as const,\n\n    policy: {\n      ...policy,\n    },\n\n    semantics: {\n      syntheticRandomSlippage:\n        false as const,\n\n      plannedEntryPriceUsedAsFillFallback:\n        false as const,\n\n      missingOrStaleMarketPriceFailsClosed:\n        true as const,\n    },\n  };\n\n  const stockCode =\n    input.stockCode.trim();\n\n  if (\n    !stockCode\n  ) {\n    return {\n      ...base,\n      usable:\n        false,\n      blocker:\n        \"STOCK_CODE_REQUIRED\",\n      executionPrice:\n        null,\n      observedAt:\n        null,\n      ageMs:\n        null,\n    };\n  }\n\n  if (\n    !input.snapshot\n  ) {\n    return {\n      ...base,\n      usable:\n        false,\n      blocker:\n        \"SNAPSHOT_NOT_FOUND\",\n      executionPrice:\n        null,\n      observedAt:\n        null,\n      ageMs:\n        null,\n    };\n  }\n\n  if (\n    input.snapshot\n      .stock_code !==\n    stockCode\n  ) {\n    return {\n      ...base,\n      usable:\n        false,\n      blocker:\n        \"SNAPSHOT_STOCK_MISMATCH\",\n      executionPrice:\n        null,\n      observedAt:\n        input.snapshot\n          .observed_at,\n      ageMs:\n        null,\n    };\n  }\n\n  const price =\n    numeric(\n      input.snapshot\n        .close_price,\n    );\n\n  if (\n    price ===\n      null ||\n    price <=\n      0\n  ) {\n    return {\n      ...base,\n      usable:\n        false,\n      blocker:\n        \"SNAPSHOT_PRICE_INVALID\",\n      executionPrice:\n        null,\n      observedAt:\n        input.snapshot\n          .observed_at,\n      ageMs:\n        null,\n    };\n  }\n\n  const observedMs =\n    Date.parse(\n      input.snapshot\n        .observed_at,\n    );\n\n  if (\n    !Number.isFinite(\n      observedMs,\n    )\n  ) {\n    return {\n      ...base,\n      usable:\n        false,\n      blocker:\n        \"SNAPSHOT_TIME_INVALID\",\n      executionPrice:\n        null,\n      observedAt:\n        input.snapshot\n          .observed_at,\n      ageMs:\n        null,\n    };\n  }\n\n  const ageMs =\n    now.getTime() -\n    observedMs;\n\n  if (\n    ageMs <\n      -policy.maxFutureClockSkewMs\n  ) {\n    return {\n      ...base,\n      usable:\n        false,\n      blocker:\n        \"SNAPSHOT_FROM_FUTURE\",\n      executionPrice:\n        null,\n      observedAt:\n        input.snapshot\n          .observed_at,\n      ageMs,\n    };\n  }\n\n  if (\n    ageMs >\n    policy.maxSnapshotAgeMs\n  ) {\n    return {\n      ...base,\n      usable:\n        false,\n      blocker:\n        \"SNAPSHOT_STALE\",\n      executionPrice:\n        null,\n      observedAt:\n        input.snapshot\n          .observed_at,\n      ageMs,\n    };\n  }\n\n  return {\n    ...base,\n\n    usable:\n      true,\n\n    blocker:\n      null,\n\n    executionPrice:\n      price,\n\n    observedAt:\n      input.snapshot\n        .observed_at,\n\n    ageMs:\n      Math.max(\n        0,\n        ageMs,\n      ),\n  };\n}\n"
  },
  {
    rel:
      "lib/trading/paper-execution-price-resolver.ts",
    text:
      "import {\n  createSupabaseServerClient,\n} from \"@/lib/supabase\";\n\nimport {\n  evaluatePaperExecutionPriceSnapshot,\n  type PaperExecutionPriceDecision,\n  type PaperExecutionPricePolicy,\n} from \"@/lib/trading/paper-execution-price-model\";\n\nexport async function resolvePaperExecutionPrice(\n  input: {\n    stockCode: string;\n    now?: Date;\n    policy?: PaperExecutionPricePolicy;\n  },\n): Promise<PaperExecutionPriceDecision> {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase\n      .from(\n        \"market_snapshots\",\n      )\n      .select(\n        \"stock_code,close_price,observed_at\",\n      )\n      .eq(\n        \"stock_code\",\n        input.stockCode,\n      )\n      .order(\n        \"observed_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(\n        1,\n      );\n\n  if (\n    error\n  ) {\n    throw new Error(\n      `PAPER_EXECUTION_PRICE_SNAPSHOT_READ_FAILED:${error.message}`,\n    );\n  }\n\n  const snapshot =\n    data?.[0] ??\n    null;\n\n  return evaluatePaperExecutionPriceSnapshot(\n    {\n      stockCode:\n        input.stockCode,\n\n      snapshot,\n\n      now:\n        input.now,\n    },\n\n    input.policy,\n  );\n}\n"
  },
  {
    rel:
      "lib/trading/resolve-safe-paper-buy-execution.ts",
    text:
      "import {\n  evaluateBuyExecutionGapSlippageRisk,\n  type BuyExecutionRiskEvaluation,\n} from \"@/lib/trading/gap-slippage-risk\";\n\nimport {\n  resolvePaperExecutionPrice,\n} from \"@/lib/trading/paper-execution-price-resolver\";\n\nexport interface ResolveSafePaperBuyExecutionInput {\n  stockCode: string;\n  plannedEntryPrice: number;\n  stopPrice: number;\n  quantity: number;\n  accountEquity: number;\n  reservedRiskAmount: number;\n  now?: Date;\n}\n\nexport interface SafePaperBuyExecutionDecision {\n  allowed: boolean;\n\n  executionPrice:\n    number |\n    null;\n\n  executionPriceObservedAt:\n    string |\n    null;\n\n  executionPriceSource:\n    \"MARKET_SNAPSHOT_CLOSE\";\n\n  priceDecision:\n    Awaited<\n      ReturnType<\n        typeof resolvePaperExecutionPrice\n      >\n    >;\n\n  riskDecision:\n    BuyExecutionRiskEvaluation |\n    null;\n\n  reason:\n    string;\n\n  semantics: {\n    plannedEntryPriceFallback: false;\n    unsafeBuyFailsClosed: true;\n  };\n}\n\nexport async function resolveSafePaperBuyExecution(\n  input:\n    ResolveSafePaperBuyExecutionInput,\n): Promise<SafePaperBuyExecutionDecision> {\n  const priceDecision =\n    await resolvePaperExecutionPrice({\n      stockCode:\n        input.stockCode,\n\n      now:\n        input.now,\n    });\n\n  if (\n    !priceDecision.usable ||\n    priceDecision.executionPrice ===\n      null\n  ) {\n    return {\n      allowed:\n        false,\n\n      executionPrice:\n        null,\n\n      executionPriceObservedAt:\n        priceDecision.observedAt,\n\n      executionPriceSource:\n        \"MARKET_SNAPSHOT_CLOSE\",\n\n      priceDecision,\n\n      riskDecision:\n        null,\n\n      reason:\n        `EXECUTION_PRICE_BLOCKED:${priceDecision.blocker}`,\n\n      semantics: {\n        plannedEntryPriceFallback:\n          false,\n\n        unsafeBuyFailsClosed:\n          true,\n      },\n    };\n  }\n\n  const riskDecision =\n    evaluateBuyExecutionGapSlippageRisk({\n      stockCode:\n        input.stockCode,\n\n      plannedEntryPrice:\n        input.plannedEntryPrice,\n\n      executionPrice:\n        priceDecision.executionPrice,\n\n      stopPrice:\n        input.stopPrice,\n\n      quantity:\n        input.quantity,\n\n      accountEquity:\n        input.accountEquity,\n\n      reservedRiskAmount:\n        input.reservedRiskAmount,\n    });\n\n  return {\n    allowed:\n      riskDecision.allowed,\n\n    executionPrice:\n      priceDecision.executionPrice,\n\n    executionPriceObservedAt:\n      priceDecision.observedAt,\n\n    executionPriceSource:\n      \"MARKET_SNAPSHOT_CLOSE\",\n\n    priceDecision,\n\n    riskDecision,\n\n    reason:\n      riskDecision.allowed\n        ? \"SAFE_PAPER_BUY_EXECUTION_ALLOWED\"\n        : `GAP_SLIPPAGE_BLOCKED:${riskDecision.blockers.join(\",\")}`,\n\n    semantics: {\n      plannedEntryPriceFallback:\n        false,\n\n      unsafeBuyFailsClosed:\n        true,\n    },\n  };\n}\n"
  },
  {
    rel:
      "scripts/alpha-v3-paper-execution-price-model-v1-contract-test.ts",
    text:
      "import {\n  strict as assert,\n} from \"node:assert\";\n\nimport {\n  DEFAULT_PAPER_EXECUTION_PRICE_POLICY,\n  evaluatePaperExecutionPriceSnapshot,\n} from \"../lib/trading/paper-execution-price-model\";\n\nfunction main() {\n  const now =\n    new Date(\n      \"2026-10-08T06:00:00.000Z\",\n    );\n\n  const checks:\n    Record<\n      string,\n      boolean\n    > = {};\n\n  const fresh =\n    evaluatePaperExecutionPriceSnapshot({\n      stockCode:\n        \"005930\",\n\n      snapshot: {\n        stock_code:\n          \"005930\",\n\n        close_price:\n          101_000,\n\n        observed_at:\n          \"2026-10-08T05:55:00.000Z\",\n      },\n\n      now,\n    });\n\n  checks.freshSnapshotUsedAsExecutionPrice =\n    fresh.usable ===\n      true &&\n    fresh.executionPrice ===\n      101_000 &&\n    fresh.source ===\n      \"MARKET_SNAPSHOT_CLOSE\";\n\n  const stale =\n    evaluatePaperExecutionPriceSnapshot({\n      stockCode:\n        \"005930\",\n\n      snapshot: {\n        stock_code:\n          \"005930\",\n\n        close_price:\n          101_000,\n\n        observed_at:\n          \"2026-10-08T05:40:00.000Z\",\n      },\n\n      now,\n    });\n\n  checks.staleSnapshotFailsClosed =\n    stale.usable ===\n      false &&\n    stale.blocker ===\n      \"SNAPSHOT_STALE\";\n\n  const missing =\n    evaluatePaperExecutionPriceSnapshot({\n      stockCode:\n        \"005930\",\n\n      snapshot:\n        null,\n\n      now,\n    });\n\n  checks.missingSnapshotFailsClosed =\n    missing.usable ===\n      false &&\n    missing.blocker ===\n      \"SNAPSHOT_NOT_FOUND\";\n\n  const invalidPrice =\n    evaluatePaperExecutionPriceSnapshot({\n      stockCode:\n        \"005930\",\n\n      snapshot: {\n        stock_code:\n          \"005930\",\n\n        close_price:\n          0,\n\n        observed_at:\n          \"2026-10-08T05:59:00.000Z\",\n      },\n\n      now,\n    });\n\n  checks.invalidPriceFailsClosed =\n    invalidPrice.usable ===\n      false &&\n    invalidPrice.blocker ===\n      \"SNAPSHOT_PRICE_INVALID\";\n\n  const future =\n    evaluatePaperExecutionPriceSnapshot({\n      stockCode:\n        \"005930\",\n\n      snapshot: {\n        stock_code:\n          \"005930\",\n\n        close_price:\n          101_000,\n\n        observed_at:\n          \"2026-10-08T06:01:00.000Z\",\n      },\n\n      now,\n    });\n\n  checks.futureSnapshotBeyondClockSkewBlocked =\n    future.usable ===\n      false &&\n    future.blocker ===\n      \"SNAPSHOT_FROM_FUTURE\";\n\n  checks.noSyntheticRandomSlippage =\n    fresh.semantics\n      .syntheticRandomSlippage ===\n      false;\n\n  checks.noEntryFallback =\n    fresh.semantics\n      .plannedEntryPriceUsedAsFillFallback ===\n      false;\n\n  checks.defaultFreshnessTenMinutes =\n    DEFAULT_PAPER_EXECUTION_PRICE_POLICY\n      .maxSnapshotAgeMs ===\n      10 * 60_000;\n\n  assert.equal(\n    fresh.usable,\n    true,\n  );\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          !value,\n      )\n      .map(\n        ([name]) =>\n          name,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length ===\n          0\n            ? \"ALPHA_V3_PAPER_EXECUTION_PRICE_MODEL_V1_CONTRACT_VERIFIED\"\n            : \"ALPHA_V3_PAPER_EXECUTION_PRICE_MODEL_V1_CONTRACT_REVIEW\",\n\n        checks,\n\n        failed,\n\n        policy: {\n          source:\n            \"LATEST_MARKET_SNAPSHOT_CLOSE\",\n\n          maxSnapshotAgeMinutes:\n            10,\n\n          syntheticRandomSlippage:\n            false,\n\n          plannedEntryFallback:\n            false,\n\n          staleOrMissing:\n            \"FAIL_CLOSED\",\n        },\n\n        productionBinding:\n          false,\n\n        safety: {\n          databaseReads:\n            0,\n\n          databaseWrites:\n            0,\n\n          networkCalls:\n            0,\n\n          ordersCreated:\n            0,\n\n          positionsChanged:\n            0,\n        },\n\n        nextGate:\n          failed.length ===\n          0\n            ? \"BIND_SAFE_EXECUTION_RESOLVER_TO_PAPER_BUY_EXECUTOR\"\n            : \"REVIEW_EXECUTION_PRICE_MODEL\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  if (\n    failed.length >\n      0\n  ) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain();\n"
  },
  {
    rel:
      "scripts/alpha-v3-paper-execution-price-model-v1-static-verify.cjs",
    text:
      "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root =\n  process.cwd();\n\nconst model =\n  fs.readFileSync(\n    path.resolve(\n      root,\n      \"lib/trading/paper-execution-price-model.ts\"\n    ),\n    \"utf8\"\n  );\n\nconst resolver =\n  fs.readFileSync(\n    path.resolve(\n      root,\n      \"lib/trading/paper-execution-price-resolver.ts\"\n    ),\n    \"utf8\"\n  );\n\nconst safe =\n  fs.readFileSync(\n    path.resolve(\n      root,\n      \"lib/trading/resolve-safe-paper-buy-execution.ts\"\n    ),\n    \"utf8\"\n  );\n\nconst checks = {\n  latestSnapshotClose:\n    resolver.includes(\n      '\"market_snapshots\"'\n    ) &&\n    resolver.includes(\n      '\"stock_code,close_price,observed_at\"'\n    ) &&\n    resolver.includes(\n      '\"observed_at\"'\n    ),\n\n  freshTenMinutePolicy:\n    model.includes(\n      \"10 * 60_000\"\n    ),\n\n  noRandomSlippage:\n    model.includes(\n      \"syntheticRandomSlippage:\\n        false\"\n    ),\n\n  noEntryFallback:\n    model.includes(\n      \"plannedEntryPriceUsedAsFillFallback:\\n        false\"\n    ),\n\n  staleFailsClosed:\n    model.includes(\n      '\"SNAPSHOT_STALE\"'\n    ) &&\n    model.includes(\n      \"missingOrStaleMarketPriceFailsClosed:\\n        true\"\n    ),\n\n  compositeUsesGapSlippageGuard:\n    safe.includes(\n      \"evaluateBuyExecutionGapSlippageRisk\"\n    ),\n\n  compositeUsesPriceResolver:\n    safe.includes(\n      \"resolvePaperExecutionPrice\"\n    ),\n\n  unsafeBuyFailsClosed:\n    safe.includes(\n      \"unsafeBuyFailsClosed:\\n          true\"\n    ),\n\n  productionExecutorNotYetPatched:\n    !fs\n      .readFileSync(\n        path.resolve(\n          root,\n          \"lib/trading/execute-paper-order.ts\"\n        ),\n        \"utf8\"\n      )\n      .includes(\n        \"resolveSafePaperBuyExecution\"\n      )\n};\n\nconst failed =\n  Object.entries(\n    checks\n  )\n    .filter(\n      ([, value]) =>\n        !value\n    )\n    .map(\n      ([name]) =>\n        name\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_PAPER_EXECUTION_PRICE_MODEL_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_PAPER_EXECUTION_PRICE_MODEL_V1_STATIC_REVIEW\",\n\n      checks,\n\n      failed,\n\n      productionBinding:\n        false,\n\n      safety: {\n        databaseWrites:\n          0,\n\n        ordersCreated:\n          0,\n\n        positionsChanged:\n          0\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"CONTRACT_TYPESCRIPT_THEN_EXECUTOR_BINDING\"\n          : \"REVIEW_EXECUTION_PRICE_MODEL_V1\"\n    },\n    null,\n    2\n  )\n);\n\nif (\n  failed.length >\n  0\n) {\n  process.exitCode =\n    2;\n}\n"
  }
];

for (const item of outputs) {
  const file = path.resolve(
    root,
    item.rel
  );

  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  fs.writeFileSync(
    file,
    item.text,
    "utf8"
  );
}

const packagePath =
  path.resolve(
    root,
    "package.json"
  );

const pkg =
  JSON.parse(
    fs.readFileSync(
      packagePath,
      "utf8"
    )
  );

pkg.scripts =
  pkg.scripts ??
  {};

pkg.scripts[
  "paper-execution-price:test"
] =
  "tsx scripts/alpha-v3-paper-execution-price-model-v1-contract-test.ts";

fs.writeFileSync(
  packagePath,
  JSON.stringify(
    pkg,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_PAPER_EXECUTION_PRICE_MODEL_V1_INSTALLED",

      generatedFiles:
        outputs.map(
          (item) =>
            item.rel
        ),

      model: {
        source:
          "LATEST_MARKET_SNAPSHOT_CLOSE",

        maxSnapshotAgeMinutes:
          10,

        randomSlippage:
          false,

        plannedEntryFallback:
          false,

        staleOrMissingSnapshot:
          "FAIL_CLOSED",

        gapSlippageGuard:
          "COMPOSED_BUT_NOT_YET_BOUND_TO_EXECUTOR"
      },

      productionBinding:
        false,

      safety: {
        databaseWrites:
          0,

        networkCalls:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        forwardOosChanged:
          false
      },

      nextAction:
        "STATIC_CONTRACT_TYPESCRIPT_THEN_BIND_TO_PAPER_EXECUTOR"
    },
    null,
    2
  )
);
