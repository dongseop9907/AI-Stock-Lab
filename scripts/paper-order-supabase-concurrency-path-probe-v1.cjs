const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function read(rel) {
  const full = path.join(ROOT, rel);

  return fs.existsSync(full)
    ? fs.readFileSync(full, "utf8")
    : "";
}

function list(dirRel) {
  const dir = path.join(ROOT, dirRel);

  return fs.existsSync(dir)
    ? fs.readdirSync(dir)
    : [];
}

function envKeys(rel) {
  return read(rel)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("#") &&
        line.includes("="),
    )
    .map((line) =>
      line.slice(0, line.indexOf("=")).trim(),
    )
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function collectMatches(source, regex) {
  const out = [];
  let match;

  while ((match = regex.exec(source)) !== null) {
    out.push(match[1] ?? match[0]);

    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }
  }

  return unique(out);
}

const envFiles = [
  ".env.local",
  ".env",
  ".env.test",
].filter((rel) =>
  fs.existsSync(path.join(ROOT, rel)),
);

const allEnvKeys =
  unique(
    envFiles.flatMap(envKeys),
  );

const supabaseUrlKeys =
  allEnvKeys.filter((key) =>
    /SUPABASE.*URL|NEXT_PUBLIC_SUPABASE_URL/i.test(key)
  );

const serviceRoleKeys =
  allEnvKeys.filter((key) =>
    /SERVICE.*ROLE|SUPABASE.*SERVICE/i.test(key)
  );

const anonKeys =
  allEnvKeys.filter((key) =>
    /ANON.*KEY|SUPABASE.*ANON/i.test(key)
  );

const candidateSupabaseFiles = [];

for (const dirRel of [
  "lib",
  "lib/supabase",
  "utils",
  "utils/supabase",
]) {
  const dir = path.join(ROOT, dirRel);

  if (!fs.existsSync(dir)) {
    continue;
  }

  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();

    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (!/\.(ts|tsx|js|cjs|mjs)$/.test(name)) {
        continue;
      }

      const rel =
        path.relative(ROOT, full).replace(/\\/g, "/");

      const src =
        fs.readFileSync(full, "utf8");

      if (
        /supabase/i.test(src) &&
        (
          /createClient/.test(src) ||
          /createSupabase/.test(src)
        )
      ) {
        candidateSupabaseFiles.push({
          file: rel,
          hasCreateClient:
            /createClient\s*\(/.test(src),

          hasServerFactory:
            /createSupabaseServerClient|createServerClient|service[_ -]?role/i.test(src),

          envRefs:
            collectMatches(
              src,
              /process\.env\.([A-Z0-9_]+)/g,
            ),
        });
      }
    }
  }
}

const scriptNames = list("scripts");

const regressionNames =
  scriptNames.filter((name) =>
    /paper-buy-execution-event-idempotency-v1-post-deploy-regression|paper-protective-sell-v4-runtime-replay-regression/i.test(name)
  );

const regressions =
  regressionNames.map((name) => {
    const rel =
      "scripts/" + name;

    const src = read(rel);

    const tables =
      collectMatches(
        src,
        /\.from\s*\(\s*["']([^"']+)["']\s*\)/g,
      );

    const rpcNames =
      collectMatches(
        src,
        /\.rpc\s*\(\s*["']([^"']+)["']/g,
      );

    const processEnvRefs =
      collectMatches(
        src,
        /process\.env\.([A-Z0-9_]+)/g,
      );

    const hasSupabaseImport =
      /@supabase\/supabase-js|createClient|createSupabaseServerClient/i.test(
        src,
      );

    const hasFixtureInsert =
      /\.insert\s*\(|insert\s+into/i.test(src);

    const hasDeleteCleanup =
      /\.delete\s*\(|delete\s+from/i.test(src);

    const hasPromiseAll =
      /Promise\.all\s*\(/.test(src);

    return {
      file: rel,
      hasSupabaseImport,
      tables,
      rpcNames,
      processEnvRefs,
      hasFixtureInsert,
      hasDeleteCleanup,
      hasPromiseAll,
    };
  });

const exactRpcEvidence = {
  buyV5:
    regressions.some((row) =>
      row.rpcNames.includes(
        "execute_paper_buy_order_with_execution_price_v5",
      )
    ),

  sellV4:
    regressions.some((row) =>
      row.rpcNames.includes(
        "execute_paper_protective_sell_v4",
      )
    ),
};

const twoIndependentHttpClientsPossible =
  supabaseUrlKeys.length > 0 &&
  serviceRoleKeys.length > 0;

const fixtureReusePossible =
  regressions.some(
    (row) =>
      row.hasFixtureInsert &&
      row.hasDeleteCleanup,
  );

const classification =
  twoIndependentHttpClientsPossible
    ? (
        fixtureReusePossible
          ? "SUPABASE_HTTP_CONCURRENCY_PATH_READY"
          : "SUPABASE_HTTP_AVAILABLE_FIXTURE_REUSE_NOT_PROVEN"
      )
    : "SUPABASE_HTTP_SERVICE_ROLE_PATH_NOT_READY";

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_PAPER_ORDER_SUPABASE_CONCURRENCY_PATH_PROBE_V1_COMPLETE",

      classification,

      env: {
        files:
          envFiles,

        supabaseUrlKeys,
        serviceRoleKeys,
        anonKeys,

        secretValuesPrinted:
          false,
      },

      supabaseFactories:
        candidateSupabaseFiles,

      regressions,

      exactRpcEvidence,

      derived: {
        twoIndependentHttpClientsPossible,
        fixtureReusePossible,

        canUsePromiseAllHttpConcurrency:
          twoIndependentHttpClientsPossible,

        requiresPgPackage:
          false,

        requiresDatabaseUrl:
          false,
      },

      interpretation: {
        ifReady:
          "Use two separate Supabase service-role clients and Promise.all to issue the same RPC concurrently. Each HTTP RPC request executes in its own PostgreSQL transaction/session.",

        cleanup:
          "Reuse existing synthetic fixture insert/delete patterns; never target real PAPER rows.",
      },

      safety: {
        readOnly: true,
        environmentValuesReadButNotPrinted:
          true,

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

      nextGate:
        twoIndependentHttpClientsPossible &&
        fixtureReusePossible
          ? "GENERATE_SUPABASE_HTTP_TWO_CLIENT_CONCURRENT_STRESS"
          : "REPAIR_ONLY_MISSING_TEST_CONNECTIVITY_OR_FIXTURE_DISCOVERY",
    },
    null,
    2,
  ),
);

process.exitCode = 0;
