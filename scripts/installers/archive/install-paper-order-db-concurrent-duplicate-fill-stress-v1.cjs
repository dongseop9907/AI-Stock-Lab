const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const scriptsDir = path.join(ROOT, "scripts");
const outRel = "scripts/paper-order-db-concurrent-duplicate-fill-stress-v1.ts";
const outPath = path.join(ROOT, outRel);

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function list(dirRel) {
  const p = path.join(ROOT, dirRel);
  return fs.existsSync(p) ? fs.readdirSync(p) : [];
}

const pkgText = read("package.json");
let pkg = {};
try {
  pkg = JSON.parse(pkgText || "{}");
} catch {}

const deps = {
  ...(pkg.dependencies || {}),
  ...(pkg.devDependencies || {}),
};

const hasPgPackage =
  Object.prototype.hasOwnProperty.call(deps, "pg");

const hasPostgresPackage =
  Object.prototype.hasOwnProperty.call(deps, "postgres");

const hasSupabasePackage =
  Object.prototype.hasOwnProperty.call(
    deps,
    "@supabase/supabase-js",
  );

const envCandidates = [
  ".env.local",
  ".env",
  ".env.test",
];

const envText = envCandidates
  .filter(exists)
  .map(read)
  .join("\n");

const dbUrlKeys = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "SUPABASE_DB_URL",
  "DIRECT_URL",
];

const detectedDbUrlKey =
  dbUrlKeys.find((key) =>
    new RegExp(
      "^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=",
      "m",
    ).test(envText)
  ) || null;

const regressionFiles = list("scripts").filter((name) =>
  /paper-buy-execution-event-idempotency-v1-post-deploy-regression|paper-protective-sell-v4-runtime-replay-regression/i.test(name)
);

const regressionCombined = regressionFiles
  .map((name) => read(path.join("scripts", name)))
  .join("\n");

const connectionSignals = {
  importsPg:
    /from\s+["']pg["']|require\s*\(\s*["']pg["']\s*\)/.test(
      regressionCombined,
    ),
  importsPostgres:
    /from\s+["']postgres["']|require\s*\(\s*["']postgres["']\s*\)/.test(
      regressionCombined,
    ),
  usesSupabase:
    /createClient|createSupabase|supabase\.rpc|\.rpc\s*\(/i.test(
      regressionCombined,
    ),
  usesDatabaseUrl:
    /DATABASE_URL|POSTGRES_URL|SUPABASE_DB_URL|DIRECT_URL/i.test(
      regressionCombined,
    ),
  usesPsql:
    /\bpsql\b/i.test(regressionCombined),
};

let driver = null;

if (hasPgPackage || connectionSignals.importsPg) {
  driver = "pg";
} else if (
  hasPostgresPackage ||
  connectionSignals.importsPostgres
) {
  driver = "postgres";
}

const harness = String.raw`import fs from "node:fs";
import path from "node:path";

type Json = Record<string, unknown>;

const ROOT = process.cwd();

function read(rel: string): string {
  const full = path.join(ROOT, rel);

  return fs.existsSync(full)
    ? fs.readFileSync(full, "utf8")
    : "";
}

function loadEnvFile(rel: string) {
  const text = read(rel);

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (
      !line ||
      line.startsWith("#")
    ) {
      continue;
    }

    const eq = line.indexOf("=");

    if (eq <= 0) {
      continue;
    }

    const key = line
      .slice(0, eq)
      .trim();

    let value = line
      .slice(eq + 1)
      .trim();

    if (
      (value.startsWith('"') &&
        value.endsWith('"')) ||
      (value.startsWith("'") &&
        value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (
      key &&
      process.env[key] === undefined
    ) {
      process.env[key] = value;
    }
  }
}

for (const envFile of [
  ".env.local",
  ".env",
  ".env.test",
]) {
  loadEnvFile(envFile);
}

const DB_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "SUPABASE_DB_URL",
  "DIRECT_URL",
] as const;

function resolveDbUrl(): {
  key: string;
  value: string;
} | null {
  for (const key of DB_URL_KEYS) {
    const value =
      process.env[key];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return {
        key,
        value: value.trim(),
      };
    }
  }

  return null;
}

function out(value: unknown) {
  console.log(
    JSON.stringify(
      value,
      null,
      2,
    ),
  );
}

async function main() {
  const driver =
    ${JSON.stringify(driver)};

  const dbUrl =
    resolveDbUrl();

  if (!driver) {
    out({
      status:
        "AI_STOCK_LAB_PAPER_ORDER_DB_CONCURRENT_DUPLICATE_FILL_STRESS_V1_BLOCKED",

      reason:
        "NO_DIRECT_POSTGRES_DRIVER_DETECTED",

      detected: {
        pgPackage:
          ${JSON.stringify(hasPgPackage)},

        postgresPackage:
          ${JSON.stringify(hasPostgresPackage)},

        supabasePackage:
          ${JSON.stringify(hasSupabasePackage)},

        previousRegressionConnectionSignals:
          ${JSON.stringify(connectionSignals)},
      },

      safety: {
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        realTradingEnabled: false,
      },

      nextGate:
        "ADD_TEST_ONLY_POSTGRES_DRIVER_OR_ADAPT_EXISTING_DB_CONNECTION",
    });

    process.exitCode = 2;
    return;
  }

  if (!dbUrl) {
    out({
      status:
        "AI_STOCK_LAB_PAPER_ORDER_DB_CONCURRENT_DUPLICATE_FILL_STRESS_V1_BLOCKED",

      reason:
        "DIRECT_DATABASE_URL_NOT_FOUND",

      searchedKeys:
        DB_URL_KEYS,

      safety: {
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        realTradingEnabled: false,
      },

      nextGate:
        "PROVIDE_EXISTING_TEST_DB_CONNECTION_ENVIRONMENT",
    });

    process.exitCode = 2;
    return;
  }

  /*
   * This harness intentionally stops here until it can inspect the
   * exact local post-deploy fixture SQL/RPC call shapes at runtime.
   * It emits a machine-readable plan, never guesses schema columns,
   * and never touches PAPER state merely to discover them.
   */
  const buyRegressionCandidates =
    fs.readdirSync(
      path.join(ROOT, "scripts"),
    ).filter(
      (name) =>
        /paper-buy-execution-event-idempotency-v1-post-deploy-regression/i.test(
          name,
        ),
    );

  const sellRegressionCandidates =
    fs.readdirSync(
      path.join(ROOT, "scripts"),
    ).filter(
      (name) =>
        /paper-protective-sell-v4-runtime-replay-regression/i.test(
          name,
        ),
    );

  const buySource =
    buyRegressionCandidates
      .map((name) =>
        read(
          path.join(
            "scripts",
            name,
          ),
        ),
      )
      .join("\n");

  const sellSource =
    sellRegressionCandidates
      .map((name) =>
        read(
          path.join(
            "scripts",
            name,
          ),
        ),
      )
      .join("\n");

  const extraction = {
    buyHasV5:
      /execute_paper_buy_order_with_execution_price_v5/.test(
        buySource,
      ),

    buyHasRollback:
      /rollback/i.test(
        buySource,
      ),

    buyHasFixtureWrites:
      /insert\s+into|\.insert\s*\(/i.test(
        buySource,
      ),

    sellHasV4:
      /execute_paper_protective_sell_v4/.test(
        sellSource,
      ),

    sellHasRollback:
      /rollback/i.test(
        sellSource,
      ),

    sellHasFixtureWrites:
      /insert\s+into|\.insert\s*\(/i.test(
        sellSource,
      ),
  };

  const allShapeReady =
    extraction.buyHasV5 &&
    extraction.buyHasRollback &&
    extraction.buyHasFixtureWrites &&
    extraction.sellHasV4 &&
    extraction.sellHasRollback &&
    extraction.sellHasFixtureWrites;

  out({
    status:
      allShapeReady
        ? "AI_STOCK_LAB_PAPER_ORDER_DB_CONCURRENT_DUPLICATE_FILL_STRESS_V1_FIXTURE_SHAPES_READY"
        : "AI_STOCK_LAB_PAPER_ORDER_DB_CONCURRENT_DUPLICATE_FILL_STRESS_V1_FIXTURE_SHAPES_INCOMPLETE",

    mode:
      "READINESS_ONLY_NO_DB_MUTATION",

    driver,

    dbUrlKey:
      dbUrl.key,

    regressionCandidates: {
      buy:
        buyRegressionCandidates,

      sell:
        sellRegressionCandidates,
    },

    extraction,

    safety: {
      databaseConnected:
        false,

      databaseReads:
        0,

      databaseWrites:
        0,

      rpcInvoked:
        false,

      ordersCreated:
        0,

      ordersExecuted:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    nextGate:
      allShapeReady
        ? "GENERATE_EXACT_TWO_SESSION_STRESS_FROM_EXISTING_FIXTURE_SHAPES"
        : "INSPECT_EXACT_REGRESSION_FIXTURE_SHAPES_BEFORE_DB_STRESS",
  });

  process.exitCode =
    allShapeReady
      ? 0
      : 3;
}

main().catch(
  (error) => {
    out({
      status:
        "AI_STOCK_LAB_PAPER_ORDER_DB_CONCURRENT_DUPLICATE_FILL_STRESS_V1_ERROR",

      message:
        error instanceof Error
          ? error.message
          : String(error),

      safety: {
        databaseWrites:
          "NOT_STARTED_BY_DESIGN",

        realTradingEnabled:
          false,
      },
    });

    process.exitCode = 1;
  },
);
`;

fs.mkdirSync(scriptsDir, { recursive: true });
fs.writeFileSync(outPath, harness, "utf8");

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_ORDER_DB_CONCURRENT_DUPLICATE_FILL_STRESS_V1_INSTALLED",

  generatedFile:
    outRel,

  detected: {
    pgPackage:
      hasPgPackage,

    postgresPackage:
      hasPostgresPackage,

    supabasePackage:
      hasSupabasePackage,

    detectedDbUrlKey,

    chosenDirectDriver:
      driver,

    regressionFiles,

    connectionSignals,
  },

  behavior:
    "READINESS_ONLY_FIRST_RUN_NO_DB_CONNECTION_OR_MUTATION",

  reason:
    "Exact fixture/RPC shapes are extracted before generating true two-session concurrent mutation test.",

  productSourceChanges:
    0,

  safety: {
    databaseReads:
      0,

    databaseWrites:
      0,

    rpcInvoked:
      false,

    ordersCreated:
      0,

    positionsChanged:
      0,

    realTradingEnabled:
      false,
  },

  nextAction:
    "RUN_GENERATED_READINESS_HARNESS_AND_FULL_TSC",
}, null, 2));
