const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "alpha-v1-controlled-3-stock-daily-bar-insert-only.ts"
  );

const STATIC =
  path.join(
    ROOT,
    "scripts",
    "controlled-3-stock-supabase-client-factory-type-v1-static-verify.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_CONTROLLED_3_STOCK_SUPABASE_CLIENT_FACTORY_TYPE_V1_FAILED",
        reason,
        ...extra
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

if (
  !fs.existsSync(
    TARGET
  )
) {
  fail(
    "TARGET_SOURCE_NOT_FOUND"
  );

  return;
}

let source =
  fs.readFileSync(
    TARGET,
    "utf8"
  );

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
    "alpha-v1-controlled-3-stock-daily-bar-insert-only.before-supabase-client-factory-type-v1.ts"
  );

if (
  !fs.existsSync(
    backup
  )
) {
  fs.copyFileSync(
    TARGET,
    backup
  );
}

const factoryMarker =
  "/* AI_STOCK_LAB_CONTROLLED_3_STOCK_SUPABASE_CLIENT_FACTORY_TYPE_V1 */";

if (
  !source.includes(
    factoryMarker
  )
) {
  const readScopeMarker =
    "async function readScopeRows(";

  const readScopeIndex =
    source.indexOf(
      readScopeMarker
    );

  if (
    readScopeIndex <
    0
  ) {
    fail(
      "READ_SCOPE_ROWS_NOT_FOUND"
    );

    return;
  }

  const factory =
`${factoryMarker}
function createControlledApplySupabaseClient(
  url: string,
  key: string,
) {
  return createClient(
    url,
    key,
    {
      auth: {
        persistSession:
          false,

        autoRefreshToken:
          false,
      },
    },
  );
}

type ControlledApplySupabaseClient =
  ReturnType<
    typeof createControlledApplySupabaseClient
  >;

`;

  source =
    source.slice(
      0,
      readScopeIndex
    ) +
    factory +
    source.slice(
      readScopeIndex
    );
}

source =
  source.replace(
    /async function readScopeRows\(\s*supabase:\s*ReturnType<\s*typeof createClient\s*>,\s*\)/m,
    `async function readScopeRows(
  supabase:
    ControlledApplySupabaseClient,
)`
  );

const oldClientBlock =
/  const supabase =\s*createClient\(\s*config\.url,\s*config\.key,\s*\{\s*auth:\s*\{\s*persistSession:\s*false,\s*autoRefreshToken:\s*false,\s*\},\s*\},\s*\);/m;

if (
  oldClientBlock.test(
    source
  )
) {
  source =
    source.replace(
      oldClientBlock,
`  const supabase =
    createControlledApplySupabaseClient(
      config.url,
      config.key,
    );`
    );
}

const checks = {
  factoryInstalled:
    source.includes(
      factoryMarker
    ) &&
    source.includes(
      "function createControlledApplySupabaseClient("
    ),

  exactLocalReturnTypeAlias:
    source.includes(
      "type ControlledApplySupabaseClient ="
    ) &&
    source.includes(
      "typeof createControlledApplySupabaseClient"
    ),

  readScopeUsesLocalAlias:
    source.includes(
      "supabase:\n    ControlledApplySupabaseClient,"
    ) ||
    source.includes(
      "supabase:\r\n    ControlledApplySupabaseClient,"
    ),

  mainUsesSameFactory:
    source.includes(
      "createControlledApplySupabaseClient(\n      config.url,\n      config.key,"
    ) ||
    source.includes(
      "createControlledApplySupabaseClient(\r\n      config.url,\r\n      config.key,"
    ),

  oldGenericReturnTypeRemoved:
    !/ReturnType<\s*typeof createClient\s*>/.test(
      source
    ),

  authOptionsPreserved:
    source.includes(
      "persistSession:"
    ) &&
    source.includes(
      "autoRefreshToken:"
    ),

  anyCastAdded:
    false,

  databaseBehaviorChanged:
    false
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        ![
          "anyCastAdded",
          "databaseBehaviorChanged"
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
  TARGET,
  source,
  "utf8"
);

const staticSource = `const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "alpha-v1-controlled-3-stock-daily-bar-insert-only.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_CONTROLLED_3_STOCK_SUPABASE_CLIENT_FACTORY_TYPE_V1_STATIC_FAILED",
    failed: [
      "targetExists"
    ]
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    factoryPresent:
      source.includes(
        "function createControlledApplySupabaseClient("
      ),

    typeAliasUsesFactoryReturn:
      source.includes(
        "type ControlledApplySupabaseClient ="
      ) &&
      source.includes(
        "typeof createControlledApplySupabaseClient"
      ),

    readScopeUsesAlias:
      source.includes(
        "ControlledApplySupabaseClient,"
      ),

    mainUsesFactory:
      source.includes(
        "createControlledApplySupabaseClient("
      ) &&
      source.includes(
        "config.url"
      ) &&
      source.includes(
        "config.key"
      ),

    genericCreateClientReturnTypeGone:
      !/ReturnType<\\\\s*typeof createClient\\\\s*>/.test(
        source
      ),

    authOptionsStillPresent:
      source.includes(
        "persistSession:"
      ) &&
      source.includes(
        "autoRefreshToken:"
      ),

    noSupabaseAnyCast:
      !source.includes(
        "supabase as any"
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
        ? "AI_STOCK_LAB_CONTROLLED_3_STOCK_SUPABASE_CLIENT_FACTORY_TYPE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_CONTROLLED_3_STOCK_SUPABASE_CLIENT_FACTORY_TYPE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      controlledApplyExecuted:
        false,

      databaseReads:
        0,

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
        ? "RUN_DASHBOARD_CONTRACT_AND_NEXT_BUILD"
        : "REPAIR_SUPABASE_CLIENT_TYPE_CONTRACT"
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

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_CONTROLLED_3_STOCK_SUPABASE_CLIENT_FACTORY_TYPE_V1_REPAIRED",

      changedFile:
        "scripts/alpha-v1-controlled-3-stock-daily-bar-insert-only.ts",

      generatedFile:
        "scripts/controlled-3-stock-supabase-client-factory-type-v1-static-verify.cjs",

      backupFile:
        "scripts/backups/alpha-v1-controlled-3-stock-daily-bar-insert-only.before-supabase-client-factory-type-v1.ts",

      repair: {
        sourceProblem:
          "ReturnType<typeof createClient> loses the concrete generic instantiation and produces an incompatible abstract client type",

        solution:
          "derive helper parameter type from the exact local configured client factory",

        runtimeClientConfig:
          "UNCHANGED",

        authOptions:
          "UNCHANGED",

        queryBehavior:
          "UNCHANGED",

        insertBehavior:
          "UNCHANGED",

        anyCast:
          "NOT_USED"
      },

      checks,

      safety: {
        controlledApplyExecuted:
          false,

        databaseReads:
          0,

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
    },
    null,
    2
  )
);

process.exitCode = 0;
