import fs from "node:fs";
import path from "node:path";

async function main() {
  const ROOT = process.cwd();
  const MIG_DIR = path.join(ROOT, "supabase", "migrations");

  const SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "";

  const SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "";

  function walkSql(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];

    const out: string[] = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        out.push(...walkSql(abs));
      } else if (entry.isFile() && entry.name.endsWith(".sql")) {
        out.push(abs);
      }
    }

    return out;
  }

  function rel(abs: string) {
    return path.relative(ROOT, abs).replaceAll("\\", "/");
  }

  function context(
    text: string,
    patterns: RegExp[],
    radius = 8,
  ) {
    const lines = text.split(/\r?\n/);
    const out: any[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (!patterns.some(p => p.test(lines[i]))) continue;

      const start = Math.max(0, i - radius);
      const end = Math.min(lines.length - 1, i + radius);

      out.push({
        line: i + 1,
        text: lines[i],
        context: lines.slice(start, end + 1).map((line, offset) => ({
          line: start + offset + 1,
          text: line,
        })),
      });
    }

    return out;
  }

  const sqlFiles =
    walkSql(MIG_DIR)
      .sort()
      .map(abs => ({
        file: rel(abs),
        text: fs.readFileSync(abs, "utf8"),
      }));

  const allSql =
    sqlFiles
      .map(row => `-- FILE ${row.file}\n${row.text}`)
      .join("\n\n");

  const triggerSource = sqlFiles
    .filter(row =>
      /entry_broker_fee_basis_total|entry_broker_fee_basis_remaining|apply_paper_trade_entry_fee_basis_v1|accumulate_paper_position_entry_fee_basis_v1/i.test(
        row.text,
      ),
    );

  const sourceChecks = {
    positionFeeBasisColumns:
      /entry_broker_fee_basis_total/i.test(allSql) &&
      /entry_broker_fee_basis_remaining/i.test(allSql),

    buyFeeAccumulatorFunction:
      /accumulate_paper_position_entry_fee_basis_v1/i.test(allSql),

    buyFeeAccumulatorTrigger:
      /trigger[\s\S]{0,500}?accumulate_paper_position_entry_fee_basis_v1/i.test(
        allSql,
      ),

    tradeFeeAllocatorFunction:
      /apply_paper_trade_entry_fee_basis_v1/i.test(allSql),

    tradeFeeAllocatorTrigger:
      /trigger[\s\S]{0,700}?apply_paper_trade_entry_fee_basis_v1/i.test(
        allSql,
      ),

    proportionalAllocationEvidence:
      /new\.quantity[\s\S]{0,700}?v_position_quantity/i.test(allSql),

    finalRemainderEvidence:
      /v_fee_before/i.test(allSql) &&
      /v_fee_after/i.test(allSql),

    costModelV2Evidence:
      /PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS/i.test(
        allSql,
      ),

    sourcePositionUniqueRepair:
      /source_position_id/i.test(allSql) &&
      /drop constraint/i.test(allSql),
  };

  const failedSourceChecks =
    Object.entries(sourceChecks)
      .filter(([, ok]) => ok !== true)
      .map(([name]) => name);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_READINESS_AUDIT_V1_BLOCKED",

      reason:
        "Missing Supabase URL or service role key.",

      sourceChecks,
      failedSourceChecks,

      safety: {
        sourceOnlyUntilBlocked: true,
        databaseReads: 0,
        databaseWrites: 0,
        rpcInvoked: false,
        realTradingEnabled: false,
      },
    }, null, 2));

    process.exitCode = 2;
    return;
  }

  const base =
    SUPABASE_URL.replace(/\/+$/, "") +
    "/rest/v1";

  const headers: Record<string, string> = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  };

  async function get(
    url: string,
    accept = "application/json",
  ) {
    const response =
      await fetch(url, {
        method: "GET",
        headers: {
          ...headers,
          Accept: accept,
        },
      });

    const text =
      await response.text();

    let json: any = null;

    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
    };
  }

  const openApi =
    await get(
      `${base}/`,
      "application/openapi+json",
    );

  const accounts =
    await get(
      `${base}/paper_accounts?select=id,cash_balance,trading_mode&trading_mode=eq.PAPER&limit=3`,
    );

  const stocks =
    await get(
      `${base}/stocks?select=stock_code,sector&limit=5`,
    );

  const positions =
    await get(
      `${base}/paper_positions?select=id,account_id,stock_code,quantity,average_price,entry_order_id,entry_broker_fee_basis_total,entry_broker_fee_basis_remaining&limit=5`,
    );

  const trades =
    await get(
      `${base}/paper_trade_history?select=id,source_position_id,buy_order_id,sell_order_id,quantity,entry_broker_fee,total_transaction_cost,net_pnl,cost_model_version&limit=5`,
    );

  const orders =
    await get(
      `${base}/paper_order_requests?select=id,account_id,stock_code,side,status,risk_decision_id,requested_quantity,approved_quantity,filled_quantity,execution_broker_fee,execution_fill_count&limit=5`,
    );

  const risks =
    await get(
      `${base}/risk_decisions?select=id,account_id,stock_code,action,approved&limit=5`,
    );

  const api: any =
    openApi.json ?? {};

  const schemas: any =
    api?.components?.schemas ??
    api?.definitions ??
    {};

  function schemaFor(name: string) {
    const direct =
      schemas?.[name];

    if (direct) return direct;

    const key =
      Object.keys(schemas)
        .find(k =>
          k.toLowerCase() === name.toLowerCase() ||
          k.toLowerCase().endsWith(`.${name.toLowerCase()}`)
        );

    return key
      ? schemas[key]
      : null;
  }

  function summarizeSchema(name: string) {
    const schema =
      schemaFor(name);

    if (!schema) {
      return {
        found: false,
        required: [],
        properties: [],
        propertyDetails: {},
      };
    }

    const props =
      schema.properties ?? {};

    const propertyDetails =
      Object.fromEntries(
        Object.entries(props).map(([key, value]: [string, any]) => [
          key,
          {
            type: value?.type ?? null,
            format: value?.format ?? null,
            nullable:
              value?.nullable ??
              null,
            default:
              value?.default ??
              null,
          },
        ]),
      );

    return {
      found: true,
      required:
        Array.isArray(schema.required)
          ? schema.required
          : [],
      properties:
        Object.keys(props),
      propertyDetails,
    };
  }

  const remoteSchema = {
    paper_accounts:
      summarizeSchema("paper_accounts"),

    risk_decisions:
      summarizeSchema("risk_decisions"),

    paper_order_requests:
      summarizeSchema("paper_order_requests"),

    paper_positions:
      summarizeSchema("paper_positions"),

    paper_trade_history:
      summarizeSchema("paper_trade_history"),
  };

  const remoteChecks = {
    openApiReachable:
      openApi.ok,

    paperAccountAvailable:
      accounts.ok &&
      Array.isArray(accounts.json) &&
      accounts.json.length > 0,

    stockAvailable:
      stocks.ok &&
      Array.isArray(stocks.json) &&
      stocks.json.length > 0,

    positionsQueryable:
      positions.ok,

    tradesQueryable:
      trades.ok,

    ordersQueryable:
      orders.ok,

    riskDecisionsQueryable:
      risks.ok,

    positionFeeBasisColumnsQueryable:
      positions.ok,

    tradeCostColumnsQueryable:
      trades.ok,

    paperOrderRequiredSchemaVisible:
      remoteSchema.paper_order_requests.found,

    paperPositionRequiredSchemaVisible:
      remoteSchema.paper_positions.found,

    paperTradeRequiredSchemaVisible:
      remoteSchema.paper_trade_history.found,

    riskDecisionRequiredSchemaVisible:
      remoteSchema.risk_decisions.found,
  };

  const failedRemoteChecks =
    Object.entries(remoteChecks)
      .filter(([, ok]) => ok !== true)
      .map(([name]) => name);

  const pass =
    failedSourceChecks.length === 0 &&
    failedRemoteChecks.length === 0;

  console.log(JSON.stringify({
    status:
      pass
        ? "AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_READINESS_AUDIT_V1_PASS"
        : "AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_READINESS_AUDIT_V1_REVIEW",

    classification:
      pass
        ? "REMOTE_FIXTURE_SCHEMA_AND_FEE_BASIS_RUNTIME_HARNESS_READY"
        : "RUNTIME_FIXTURE_SCHEMA_OR_FEE_BASIS_SOURCE_REVIEW_REQUIRED",

    sourceChecks,
    failedSourceChecks,

    feeBasisSourceFiles:
      triggerSource.map(row => row.file),

    sourceEvidence:
      triggerSource.slice(-3).map(row => ({
        file: row.file,
        evidence:
          context(
            row.text,
            [
              /entry_broker_fee_basis_total/i,
              /entry_broker_fee_basis_remaining/i,
              /accumulate_paper_position_entry_fee_basis_v1/i,
              /apply_paper_trade_entry_fee_basis_v1/i,
              /PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS/i,
            ],
            7,
          ).slice(0, 24),
      })),

    remoteChecks,
    failedRemoteChecks,

    remoteSchema,

    remotePreview: {
      paperAccounts:
        accounts.json,

      stocks:
        stocks.json,

      positions:
        positions.json,

      trades:
        trades.json,

      orders:
        orders.json,

      riskDecisions:
        risks.json,
    },

    plannedRuntimeScenario: {
      buy1:
        {
          quantity: 100,
          fee: 1000,
        },

      buy2:
        {
          quantity: 100,
          fee: 1000,
        },

      startingPosition:
        {
          quantity: 200,
          expectedTotalEntryFeeBasis: 2000,
          expectedRemainingEntryFeeBasis: 2000,
        },

      exits: [
        {
          quantity: 50,
          expectedEntryFeeAllocation: 500,
          expectedRemainingFeeBasis: 1500,
        },
        {
          quantity: 100,
          expectedEntryFeeAllocation: 1000,
          expectedRemainingFeeBasis: 500,
        },
        {
          quantity: 50,
          expectedEntryFeeAllocation: 500,
          expectedRemainingFeeBasis: 0,
        },
      ],

      expectedTradeRows:
        3,

      expectedAllocatedEntryFeeSum:
        2000,

      persistentFixtureRowsAfterRollback:
        0,
    },

    safety: {
      readOnly: true,
      databaseReads: 6,
      databaseWrites: 0,
      rpcInvoked: false,
      ordersCreated: 0,
      ordersExecuted: 0,
      positionsChanged: 0,
      realTradingEnabled: false,
      secretsPrinted: false,
    },

    nextGate:
      pass
        ? "BUILD_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_ROLLBACK_RUNTIME_REGRESSION_V1"
        : "REVIEW_ONLY_FAILED_READINESS_CHECKS",
  }, null, 2));

  process.exitCode =
    pass
      ? 0
      : 1;
}

void main();
