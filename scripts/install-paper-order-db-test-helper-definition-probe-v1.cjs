const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");
const OUT_REL = "scripts/paper-order-db-test-helper-definition-probe-v1.cjs";
const OUT = path.join(ROOT, OUT_REL);

const probe = `
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

function read(full) {
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
}

function listSql() {
  if (!fs.existsSync(MIG_DIR)) return [];
  return fs.readdirSync(MIG_DIR).filter((n) => n.endsWith(".sql")).sort();
}

function extractFunctionBlocks(src) {
  const out = [];
  const re = /create\\s+or\\s+replace\\s+function\\s+public\\.([a-zA-Z0-9_]+)\\s*\\(/gi;
  let m;

  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const start = m.index;

    const dollarStart = src.indexOf("$$", re.lastIndex);
    if (dollarStart < 0) continue;

    const dollarEnd = src.indexOf("$$;", dollarStart + 2);
    if (dollarEnd < 0) continue;

    const block = src.slice(start, dollarEnd + 3);

    out.push({
      name,
      block
    });

    re.lastIndex = dollarEnd + 3;
  }

  return out;
}

const files = listSql();
const hits = [];

for (const name of files) {
  const full = path.join(MIG_DIR, name);
  const src = read(full);
  const blocks = extractFunctionBlocks(src);

  for (const fn of blocks) {
    const lower = fn.name.toLowerCase();

    const isExactSell =
      lower === "run_paper_sell_v4_replay_rt_v1";

    const isBuyHelperCandidate =
      (
        lower.includes("paper") &&
        lower.includes("buy")
      ) &&
      (
        lower.includes("test") ||
        lower.includes("regression") ||
        lower.includes("replay") ||
        lower.includes("idempot") ||
        lower.startsWith("run_")
      );

    const isSellHelperCandidate =
      (
        lower.includes("paper") &&
        lower.includes("sell")
      ) &&
      (
        lower.includes("test") ||
        lower.includes("regression") ||
        lower.includes("replay") ||
        lower.startsWith("run_")
      );

    if (!isExactSell && !isBuyHelperCandidate && !isSellHelperCandidate) {
      continue;
    }

    const b = fn.block;

    hits.push({
      migration: name,
      functionName: fn.name,
      exactSellRuntimeHelper: isExactSell,
      buyHelperCandidate: isBuyHelperCandidate,
      sellHelperCandidate: isSellHelperCandidate,

      signals: {
        callsBuyV5:
          /execute_paper_buy_order_with_execution_price_v5\\s*\\(/i.test(b),

        callsSellV4:
          /execute_paper_protective_sell_v4\\s*\\(/i.test(b),

        insertsAccount:
          /insert\\s+into\\s+public\\.paper_accounts/i.test(b),

        insertsOrder:
          /insert\\s+into\\s+public\\.paper_order_requests/i.test(b),

        insertsPosition:
          /insert\\s+into\\s+public\\.paper_positions/i.test(b),

        readsBuyLedger:
          /paper_buy_execution_events_v1/i.test(b),

        readsSellLedger:
          /paper_protective_execution_fills_v2/i.test(b),

        readsTradeHistory:
          /paper_trade_history/i.test(b),

        transaction:
          /\\bbegin\\b/i.test(b),

        rollbackMarker:
          /rollback|fixture|synthetic|test/i.test(b),

        pgSleep:
          /pg_sleep\\s*\\(/i.test(b),

        advisoryLock:
          /pg_advisory/i.test(b),

        exceptionRollbackPattern:
          /raise\\s+exception/i.test(b)
      },

      functionDefinition: b
    });
  }
}

const exactSell = hits.filter((x) => x.exactSellRuntimeHelper);
const buyHelpers = hits.filter((x) => x.buyHelperCandidate);

const summary = {
  exactSellRuntimeHelperFound: exactSell.length > 0,
  exactSellRuntimeHelperCount: exactSell.length,

  buyTestHelperFound: buyHelpers.length > 0,
  buyTestHelperCount: buyHelpers.length,

  buyHelpersCallingV5:
    buyHelpers.filter((x) => x.signals.callsBuyV5).map((x) => ({
      migration: x.migration,
      functionName: x.functionName
    })),

  sellHelpersCallingV4:
    hits.filter((x) => x.signals.callsSellV4).map((x) => ({
      migration: x.migration,
      functionName: x.functionName
    }))
};

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_ORDER_DB_TEST_HELPER_DEFINITION_PROBE_V1_COMPLETE",

  summary,

  helpers: hits,

  interpretation: {
    ifBuyHelperExists:
      "Reuse existing BUY DB-side fixture/rollback helper for concurrent two-client stress.",

    ifBuyHelperMissing:
      "Create one isolated BUY V5 fixture/rollback helper by copying existing schema-safe fixture patterns, then call it concurrently through Supabase HTTP.",

    sell:
      "Reuse run_paper_sell_v4_replay_rt_v1 or its exact current successor rather than rebuilding SELL fixtures from scratch."
  },

  safety: {
    readOnly: true,
    sourceFilesModified: 0,
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    rpcInvoked: false,
    secretsPrinted: false,
    ordersCreated: 0,
    positionsChanged: 0,
    realTradingEnabled: false
  },

  nextGate:
    summary.exactSellRuntimeHelperFound
      ? (
          summary.buyHelpersCallingV5.length > 0
            ? "BUILD_FINAL_TWO_CLIENT_CONCURRENT_STRESS_FROM_EXISTING_HELPERS"
            : "CREATE_BUY_V5_ISOLATED_HELPER_THEN_BUILD_FINAL_TWO_CLIENT_STRESS"
        )
      : "REPAIR_TEST_HELPER_DISCOVERY_BEFORE_CONCURRENT_STRESS"
}, null, 2));

process.exitCode = 0;
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, probe, "utf8");

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_ORDER_DB_TEST_HELPER_DEFINITION_PROBE_V1_INSTALLED",
  generatedFile: OUT_REL,
  purpose:
    "Extract exact DB-side SELL V4 runtime rollback helper and discover any BUY V5 test helper candidates before final concurrent stress.",
  productSourceChanges: 0,
  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    rpcInvoked: false,
    secretsPrinted: false,
    realTradingEnabled: false
  },
  nextAction:
    "RUN_HELPER_DEFINITION_PROBE_AND_FULL_TSC"
}, null, 2));
