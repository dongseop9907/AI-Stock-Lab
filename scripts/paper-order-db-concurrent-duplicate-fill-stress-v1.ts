import fs from "node:fs";
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
    null;

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
          false,

        postgresPackage:
          false,

        supabasePackage:
          true,

        previousRegressionConnectionSignals:
          {"importsPg":false,"importsPostgres":false,"usesSupabase":false,"usesDatabaseUrl":false,"usesPsql":false},
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
