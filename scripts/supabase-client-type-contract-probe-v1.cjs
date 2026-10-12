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

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SUPABASE_CLIENT_TYPE_CONTRACT_PROBE_V1_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail(
    "TARGET_SOURCE_NOT_FOUND"
  );
  return;
}

const source =
  fs.readFileSync(
    TARGET,
    "utf8"
  );

const lines =
  source.split(/\r?\n/);

function snippet(
  center,
  before = 20,
  after = 30
) {
  const start =
    Math.max(
      0,
      center - 1 - before
    );

  const end =
    Math.min(
      lines.length,
      center + after
    );

  return lines
    .slice(
      start,
      end
    )
    .map(
      (text, offset) => ({
        line:
          start +
          offset +
          1,
        text,
      })
    );
}

function findMatches(
  needle
) {
  const out = [];

  for (
    let i = 0;
    i < lines.length;
    i += 1
  ) {
    if (
      lines[i].includes(
        needle
      )
    ) {
      out.push({
        line:
          i + 1,
        snippet:
          snippet(
            i + 1
          ),
      });
    }
  }

  return out;
}

const report = {
  status:
    "AI_STOCK_LAB_SUPABASE_CLIENT_TYPE_CONTRACT_PROBE_V1_COMPLETE",

  buildError: {
    file:
      "scripts/alpha-v1-controlled-3-stock-daily-bar-insert-only.ts",
    line:
      465,
    expression:
      "readScopeRows(supabase)",
    problem:
      "actual SupabaseClient<any, public,...> is not assignable to helper parameter SupabaseClient<unknown,...never...>",
  },

  sourceContext: {
    imports:
      snippet(
        1,
        0,
        80
      ),

    readScopeRows:
      findMatches(
        "readScopeRows"
      ),

    supabaseDeclarations: [
      ...findMatches(
        "const supabase"
      ),
      ...findMatches(
        "let supabase"
      ),
      ...findMatches(
        "createClient("
      ),
      ...findMatches(
        "createSupabaseServerClient"
      ),
    ],

    supabaseTypeUses:
      findMatches(
        "SupabaseClient"
      ),

    nearbyReadHelpers: [
      ...findMatches(
        "async function read"
      ),
      ...findMatches(
        "function read"
      ),
    ],
  },

  decisionRules: {
    ifReadScopeRowsOnlyNeedsFromSelect:
      "type helper parameter to the same concrete SupabaseClient type used by this script or infer via ReturnType",

    ifMultipleHelpersShareClient:
      "introduce one local client type alias and reuse it",

    forbidden: [
      "DO_NOT_CAST_SUPABASE_AS_ANY",
      "DO_NOT_CHANGE_DATABASE_BEHAVIOR",
      "DO_NOT_EXECUTE_INSERTS_OR_REPLAY",
    ],
  },

  safety: {
    sourceOnly:
      true,
    filesModified:
      0,
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
      false,
  },

  nextGate:
    "PATCH_SUPABASE_HELPER_PARAMETER_TO_MATCH_ACTUAL_CLIENT_TYPE",
};

fs.mkdirSync(
  path.join(
    ROOT,
    "logs"
  ),
  {
    recursive:
      true
  }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "supabase-client-type-contract-probe-v1.json"
  ),
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    report,
    null,
    2
  )
);

process.exitCode = 0;
