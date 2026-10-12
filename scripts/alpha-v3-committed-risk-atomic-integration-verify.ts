import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT =
  process.cwd();

const MIGRATION =
  path.resolve(
    ROOT,
    "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql",
  );

const HELPER =
  path.resolve(
    ROOT,
    "lib/trading/committed-risk-reservation.ts",
  );

const SERVICE =
  path.resolve(
    ROOT,
    "lib/trading/paper-order-service.ts",
  );

function text(
  file: string,
) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `FILE_MISSING:${path.relative(ROOT, file)}`,
    );
  }

  return fs.readFileSync(
    file,
    "utf8",
  );
}

const sql =
  text(MIGRATION);

const helper =
  text(HELPER);

const service =
  text(SERVICE);

const checks = {
  atomicCreateRpc:
    /create_paper_buy_order_with_committed_risk_v3/i.test(sql),

  accountScopedAdvisoryLock:
    /pg_advisory_xact_lock[\s\S]*p_account_id/i.test(sql),

  openRiskCalculatedInDb:
    /average_price[\s\S]*current_stop_price[\s\S]*quantity/i.test(sql),

  reservedRiskCalculatedInDb:
    /sum[\s\S]*reserved_risk_amount/i.test(sql),

  twoPctBudget:
    /0\.02/.test(sql),

  sameTransactionOrderInsert:
    /insert into public\.paper_order_requests/i.test(sql),

  rpcIdempotency:
    /risk_decision_id\s*=\s*p_risk_decision_id/i.test(sql),

  invalidStopFailClosed:
    /OPEN_POSITION_STOP_MISSING/i.test(sql),

  terminalReleaseIncludesFilled:
    /'FILLED'/.test(sql),

  terminalReleaseIncludesRiskRejected:
    /'RISK_REJECTED'/.test(sql),

  helperCallsAtomicRpc:
    /create_paper_buy_order_with_committed_risk_v3/.test(helper),

  serviceImportsHelper:
    /createPaperBuyOrderWithCommittedRisk/.test(service),

  directOrderInsertRemoved:
    !/\.from\(\s*"paper_order_requests"\s*\)\s*\.insert\(/m.test(service),

  servicePassesEquity:
    /equity:\s*accountEquity/.test(service),

  servicePassesRiskDecision:
    /riskDecisionId:\s*decisionData\.id/.test(service),

  serviceReturnsCommittedRisk:
    /committedRisk/.test(service),
};

const syntacticDiagnostics = [
  [HELPER, helper],
  [SERVICE, service],
].flatMap(
  ([file, source]) =>
    ts.transpileModule(
      source,
      {
        fileName:
          file,
        compilerOptions: {
          target:
            ts.ScriptTarget.ES2022,
          module:
            ts.ModuleKind.ESNext,
          jsx:
            ts.JsxEmit.Preserve,
        },
        reportDiagnostics:
          true,
      },
    )
      .diagnostics ??
    [],
);

const syntaxErrors =
  syntacticDiagnostics.map(
    (diagnostic) =>
      ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      ),
  );

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        !value,
    )
    .map(
      ([key]) =>
        key,
    );

const ok =
  failed.length === 0 &&
  syntaxErrors.length === 0;

console.log(
  JSON.stringify(
    {
      status:
        ok
          ? "ALPHA_V3_COMMITTED_RISK_ATOMIC_INTEGRATION_V2_VERIFIED"
          : "ALPHA_V3_COMMITTED_RISK_ATOMIC_INTEGRATION_V2_VERIFY_FAILED",

      checks,
      failed,
      syntaxErrors,

      contract: {
        committedRisk:
          "OPEN_POSITION_STOP_RISK + ACTIVE_BUY_RESERVED_RISK",

        atomicBoundary:
          "POSTGRES_RPC_CREATES_ORDER_AND_RESERVATION_IN_ONE_TRANSACTION",

        maxAggregateOpenRiskRate:
          0.02,

        retryIdempotency:
          "RISK_DECISION_ID",

        productionPolicyChanged:
          false,

        databaseApplied:
          false,
      },

      nextGate:
        ok
          ? "APPLY_MIGRATION_052_THEN_RUN_DB_CONCURRENCY_TEST"
          : "REPAIR_ATOMIC_COMMITTED_RISK_INTEGRATION",
    },
    null,
    2,
  ),
);

if (!ok) {
  process.exitCode =
    2;
}
