const fs = require("fs");
const path = require("path");

const root = process.cwd();

const outputs = [
  {
    rel:
      "scripts/alpha-v3-data-freshness-db-create-fill-guards-v1-db-verify.ts",
    text:
      "import {\n  createClient,\n} from \"@supabase/supabase-js\";\n\nconst supabaseUrl =\n  String(\n    process.env.NEXT_PUBLIC_SUPABASE_URL ??\n    process.env.SUPABASE_URL ??\n    \"\",\n  )\n    .trim()\n    .replace(/\\/+$/, \"\");\n\nconst serviceRoleKey =\n  String(\n    process.env.SUPABASE_SERVICE_ROLE_KEY ??\n    process.env.SUPABASE_SERVICE_KEY ??\n    \"\",\n  ).trim();\n\nif (\n  !supabaseUrl ||\n  !serviceRoleKey\n) {\n  throw new Error(\n    \"SUPABASE_SERVICE_ROLE_CONFIG_MISSING\",\n  );\n}\n\nconst supabase =\n  createClient(\n    supabaseUrl,\n    serviceRoleKey,\n    {\n      auth: {\n        persistSession: false,\n        autoRefreshToken: false,\n      },\n    },\n  );\n\nasync function countRows(\n  table:\n    string,\n): Promise<number | null> {\n  const result =\n    await supabase\n      .from(table)\n      .select(\n        \"*\",\n        {\n          count: \"exact\",\n          head: true,\n        },\n      );\n\n  if (result.error) {\n    return null;\n  }\n\n  return result.count ?? 0;\n}\n\nasync function latestOne(\n  table:\n    string,\n) {\n  const result =\n    await supabase\n      .from(table)\n      .select(\"*\")\n      .order(\n        \"observed_at\",\n        {\n          ascending: false,\n        },\n      )\n      .order(\n        \"created_at\",\n        {\n          ascending: false,\n        },\n      )\n      .limit(1)\n      .maybeSingle();\n\n  return result;\n}\n\nasync function validator(\n  input: {\n    freshnessStatus:\n      string | null;\n\n    freshnessUsable:\n      boolean | null;\n\n    expectedMarketDate:\n      string | null;\n\n    stockLatestDate:\n      string | null;\n\n    businessWeekdayLag:\n      number | null;\n\n    indexDateAligned:\n      boolean | null;\n\n    allSourceDatesAligned:\n      boolean | null;\n\n    qualityStatus:\n      string | null;\n\n    qualityFreshnessStatus:\n      string | null;\n\n    qualityUsable:\n      boolean | null;\n\n    qualityExpectedMarketDate:\n      string | null;\n  },\n) {\n  const result =\n    await supabase.rpc(\n      \"validate_paper_buy_data_freshness_v1\",\n      {\n        p_freshness_status:\n          input.freshnessStatus,\n\n        p_freshness_usable:\n          input.freshnessUsable,\n\n        p_expected_market_date:\n          input.expectedMarketDate,\n\n        p_stock_latest_date:\n          input.stockLatestDate,\n\n        p_business_weekday_lag:\n          input.businessWeekdayLag,\n\n        p_index_date_aligned:\n          input.indexDateAligned,\n\n        p_all_source_dates_aligned:\n          input.allSourceDatesAligned,\n\n        p_quality_status:\n          input.qualityStatus,\n\n        p_quality_freshness_status:\n          input.qualityFreshnessStatus,\n\n        p_quality_usable:\n          input.qualityUsable,\n\n        p_quality_expected_market_date:\n          input.qualityExpectedMarketDate,\n      },\n    );\n\n  if (result.error) {\n    return {\n      ok: false,\n      error:\n        result.error.message,\n      data: null,\n    };\n  }\n\n  return {\n    ok: true,\n    error: null,\n    data:\n      result.data,\n  };\n}\n\nasync function main() {\n  const before = {\n    orders:\n      await countRows(\n        \"paper_order_requests\",\n      ),\n\n    positions:\n      await countRows(\n        \"paper_positions\",\n      ),\n  };\n\n  const [\n    freshnessResult,\n    qualityResult,\n  ] =\n    await Promise.all([\n      latestOne(\n        \"market_data_freshness_observations\",\n      ),\n\n      latestOne(\n        \"market_data_quality_gate_observations\",\n      ),\n    ]);\n\n  if (\n    freshnessResult.error ||\n    !freshnessResult.data\n  ) {\n    throw new Error(\n      \"LATEST_FRESHNESS_OBSERVATION_READ_FAILED:\" +\n      (\n        freshnessResult.error?.message ??\n        \"MISSING\"\n      ),\n    );\n  }\n\n  if (\n    qualityResult.error ||\n    !qualityResult.data\n  ) {\n    throw new Error(\n      \"LATEST_QUALITY_GATE_OBSERVATION_READ_FAILED:\" +\n      (\n        qualityResult.error?.message ??\n        \"MISSING\"\n      ),\n    );\n  }\n\n  const freshness =\n    freshnessResult.data as any;\n\n  const quality =\n    qualityResult.data as any;\n\n  const syntheticFresh =\n    await validator({\n      freshnessStatus:\n        \"FRESH\",\n\n      freshnessUsable:\n        true,\n\n      expectedMarketDate:\n        \"2026-10-08\",\n\n      stockLatestDate:\n        \"2026-10-08\",\n\n      businessWeekdayLag:\n        0,\n\n      indexDateAligned:\n        true,\n\n      allSourceDatesAligned:\n        true,\n\n      qualityStatus:\n        \"PASS\",\n\n      qualityFreshnessStatus:\n        \"FRESH\",\n\n      qualityUsable:\n        true,\n\n      qualityExpectedMarketDate:\n        \"2026-10-08\",\n    });\n\n  const syntheticStale =\n    await validator({\n      freshnessStatus:\n        \"STALE\",\n\n      freshnessUsable:\n        false,\n\n      expectedMarketDate:\n        \"2026-10-08\",\n\n      stockLatestDate:\n        \"2026-10-07\",\n\n      businessWeekdayLag:\n        1,\n\n      indexDateAligned:\n        true,\n\n      allSourceDatesAligned:\n        true,\n\n      qualityStatus:\n        \"FAIL_FRESHNESS\",\n\n      qualityFreshnessStatus:\n        \"STALE\",\n\n      qualityUsable:\n        false,\n\n      qualityExpectedMarketDate:\n        \"2026-10-08\",\n    });\n\n  const syntheticMismatch =\n    await validator({\n      freshnessStatus:\n        \"FRESH\",\n\n      freshnessUsable:\n        true,\n\n      expectedMarketDate:\n        \"2026-10-08\",\n\n      stockLatestDate:\n        \"2026-10-07\",\n\n      businessWeekdayLag:\n        0,\n\n      indexDateAligned:\n        true,\n\n      allSourceDatesAligned:\n        true,\n\n      qualityStatus:\n        \"PASS\",\n\n      qualityFreshnessStatus:\n        \"FRESH\",\n\n      qualityUsable:\n        true,\n\n      qualityExpectedMarketDate:\n        \"2026-10-08\",\n    });\n\n  const canonical =\n    await validator({\n      freshnessStatus:\n        freshness.status ?? null,\n\n      freshnessUsable:\n        freshness.usable_for_shadow_comparison ?? null,\n\n      expectedMarketDate:\n        freshness.expected_market_date ?? null,\n\n      stockLatestDate:\n        freshness.stock_latest_date ?? null,\n\n      businessWeekdayLag:\n        freshness.business_weekday_lag ?? null,\n\n      indexDateAligned:\n        freshness.index_date_aligned ?? null,\n\n      allSourceDatesAligned:\n        freshness.all_source_dates_aligned ?? null,\n\n      qualityStatus:\n        quality.status ?? null,\n\n      qualityFreshnessStatus:\n        quality.freshness_status ?? null,\n\n      qualityUsable:\n        quality.usable_for_forward_shadow ?? null,\n\n      qualityExpectedMarketDate:\n        quality.expected_market_date ?? null,\n    });\n\n  const assertionResult =\n    await supabase.rpc(\n      \"assert_paper_buy_data_freshness_allowed_v1\",\n    );\n\n  const after = {\n    orders:\n      await countRows(\n        \"paper_order_requests\",\n      ),\n\n    positions:\n      await countRows(\n        \"paper_positions\",\n      ),\n  };\n\n  const deltas = {\n    orders:\n      before.orders !== null &&\n      after.orders !== null\n        ? after.orders -\n          before.orders\n        : null,\n\n    positions:\n      before.positions !== null &&\n      after.positions !== null\n        ? after.positions -\n          before.positions\n        : null,\n  };\n\n  const canonicalAllowed =\n    canonical.ok &&\n    canonical.data?.allowed ===\n      true;\n\n  const canonicalReason =\n    canonical.ok\n      ? canonical.data?.reason ??\n        null\n      : canonical.error;\n\n  const currentIsStale =\n    String(\n      freshness.status ??\n      \"\",\n    ).toUpperCase() ===\n      \"STALE\" ||\n    String(\n      quality.status ??\n      \"\",\n    ).toUpperCase() ===\n      \"FAIL_FRESHNESS\" ||\n    Number(\n      freshness.business_weekday_lag ??\n      0,\n    ) > 0;\n\n  const assertionBlocked =\n    Boolean(\n      assertionResult.error,\n    ) &&\n    String(\n      assertionResult.error?.message ??\n      \"\",\n    ).includes(\n      \"DATA_FRESHNESS_NEW_RISK_BLOCKED\",\n    );\n\n  const checks = {\n    migrationFunctionsReachable:\n      syntheticFresh.ok &&\n      syntheticStale.ok &&\n      syntheticMismatch.ok,\n\n    pureFreshAllowed:\n      syntheticFresh.data?.allowed ===\n        true &&\n      syntheticFresh.data?.reason ===\n        \"FRESH_DATA_NEW_RISK_ALLOWED\",\n\n    pureStaleBlocked:\n      syntheticStale.data?.allowed ===\n        false &&\n      syntheticStale.data?.reason ===\n        \"STALE_MARKET_DATA\",\n\n    pureDateMismatchBlocked:\n      syntheticMismatch.data?.allowed ===\n        false &&\n      syntheticMismatch.data?.reason ===\n        \"MARKET_DATE_MISMATCH\",\n\n    canonicalValidatorRead:\n      canonical.ok,\n\n    currentStateRecognized:\n      currentIsStale\n        ? canonicalAllowed ===\n            false\n        : true,\n\n    currentStaleAssertionBlocks:\n      currentIsStale\n        ? assertionBlocked\n        : true,\n\n    noOrderWrites:\n      deltas.orders ===\n        null ||\n      deltas.orders ===\n        0,\n\n    noPositionWrites:\n      deltas.positions ===\n        null ||\n      deltas.positions ===\n        0,\n  };\n\n  const failed =\n    Object.entries(checks)\n      .filter(\n        ([, value]) => !value,\n      )\n      .map(\n        ([key]) => key,\n      );\n\n  const status =\n    failed.length === 0\n      ? \"ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_DB_VERIFIED\"\n      : \"ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_DB_REVIEW\";\n\n  console.log(\n    JSON.stringify(\n      {\n        status,\n\n        current: {\n          freshnessStatus:\n            freshness.status ??\n            null,\n\n          qualityStatus:\n            quality.status ??\n            null,\n\n          expectedMarketDate:\n            freshness.expected_market_date ??\n            null,\n\n          stockLatestDate:\n            freshness.stock_latest_date ??\n            null,\n\n          businessWeekdayLag:\n            freshness.business_weekday_lag ??\n            null,\n\n          canonicalAllowed,\n\n          canonicalReason,\n\n          assertionBlocked,\n\n          assertionError:\n            assertionResult.error?.message ??\n            null,\n        },\n\n        pureValidator: {\n          fresh:\n            syntheticFresh,\n\n          stale:\n            syntheticStale,\n\n          dateMismatch:\n            syntheticMismatch,\n        },\n\n        before,\n        after,\n        deltas,\n\n        checks,\n        failed,\n\n        safety: {\n          productionCreateRpcCalled:\n            false,\n\n          productionFillRpcCalled:\n            false,\n\n          databaseWritesByVerifier:\n            0,\n\n          ordersCreated:\n            0,\n\n          positionsChanged:\n            0,\n        },\n\n        nextGate:\n          failed.length === 0\n            ? \"DATA_FRESHNESS_DB_DEFENSE_IN_DEPTH_COMPLETE\"\n            : \"REVIEW_DB_FRESHNESS_GUARDS_V1\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  if (\n    failed.length > 0\n  ) {\n    process.exitCode = 2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_DB_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            productionCreateRpcCalled:\n              false,\n\n            productionFillRpcCalled:\n              false,\n\n            databaseWritesByVerifier:\n              0,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 2;\n  },\n);\n"
  },
  {
    rel:
      "scripts/alpha-v3-data-freshness-db-create-fill-guards-v1-db-verify-harness-static.cjs",
    text:
      "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst rel =\n  \"scripts/alpha-v3-data-freshness-db-create-fill-guards-v1-db-verify.ts\";\n\nconst text =\n  fs.readFileSync(\n    path.resolve(root, rel),\n    \"utf8\"\n  );\n\nconst checks = {\n  pureValidatorRpc:\n    text.includes(\n      \"validate_paper_buy_data_freshness_v1\"\n    ),\n\n  dbAssertionRpc:\n    text.includes(\n      \"assert_paper_buy_data_freshness_allowed_v1\"\n    ),\n\n  canonicalFreshnessRead:\n    text.includes(\n      \"market_data_freshness_observations\"\n    ),\n\n  canonicalQualityRead:\n    text.includes(\n      \"market_data_quality_gate_observations\"\n    ),\n\n  noCreateRpc:\n    !text.includes(\n      \"create_paper_buy_order_with_committed_risk_v3\"\n    ),\n\n  noFillRpc:\n    !text.includes(\n      'supabase.rpc(\\n      \"execute_paper_buy_order\"'\n    ),\n\n  noMutationMethods:\n    !/\\.(insert|upsert|update|delete)\\s*\\(/m.test(\n      text\n    ),\n\n  orderCountOnly:\n    text.includes(\n      '\"paper_order_requests\"'\n    ),\n\n  positionCountOnly:\n    text.includes(\n      '\"paper_positions\"'\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(\n      ([, value]) => !value\n    )\n    .map(\n      ([key]) => key\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_DB_VERIFY_HARNESS_STATIC_VERIFIED\"\n          : \"ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_DB_VERIFY_HARNESS_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      safety: {\n        databaseWrites:\n          0,\n\n        productionCreateRpcCalled:\n          false,\n\n        productionFillRpcCalled:\n          false,\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"APPLY_01700_THEN_RUN_DB_VERIFY\"\n          : \"REVIEW_DB_VERIFY_HARNESS\",\n    },\n    null,\n    2\n  )\n);\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n"
  }
];

for (const item of outputs) {
  const file =
    path.resolve(
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

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_DB_VERIFY_INSTALLED",

      generatedFiles:
        outputs.map(
          (item) => item.rel
        ),

      verificationMode:
        "PURE_VALIDATOR_PLUS_CANONICAL_ASSERTION_NO_PRODUCTION_ORDER_RPC",

      safety: {
        productionCreateRpcCalled:
          false,

        productionFillRpcCalled:
          false,

        databaseWritesByVerifier:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0
      },

      nextAction:
        "STATIC_VERIFY_THEN_APPLY_01700_AND_RUN_DB_VERIFY"
    },
    null,
    2
  )
);
