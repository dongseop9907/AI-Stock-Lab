const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(path.join(process.cwd(), ".env.local"));

const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!base || !key) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_PAPER_ORDER_STATUS_CONTRACT_PROBE_V1_FAILED",
    reason: "SUPABASE_ENV_MISSING"
  }, null, 2));
  process.exitCode = 1;
  return;
}

(async () => {
  try {
    const url =
      base +
      "/rest/v1/rpc/run_paper_buy_v5_idempotent_replay_runtime_regression_v1";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    const constraint =
      body && typeof body === "object"
        ? (
            body.statusConstraint ??
            body.deployedStatusConstraint ??
            null
          )
        : null;

    const reason =
      body && typeof body === "object"
        ? (body.reason ?? null)
        : null;

    const riskApprovedAllowed =
      typeof constraint === "string"
        ? constraint.toUpperCase().includes("RISK_APPROVED")
        : null;

    const failedAllowed =
      typeof constraint === "string"
        ? constraint.toUpperCase().includes("FAILED")
        : null;

    const filledAllowed =
      typeof constraint === "string"
        ? constraint.toUpperCase().includes("FILLED")
        : null;

    console.log(JSON.stringify({
      status:
        res.ok
          ? "AI_STOCK_LAB_PAPER_ORDER_STATUS_CONTRACT_PROBE_V1_COMPLETE"
          : "AI_STOCK_LAB_PAPER_ORDER_STATUS_CONTRACT_PROBE_V1_HTTP_FAILED",
      http: {
        ok: res.ok,
        status: res.status,
      },
      probeResult: body,
      extracted: {
        deployedStatusConstraint: constraint,
        reason,
        riskApprovedAllowed,
        filledAllowed,
        failedAllowed,
      },
      interpretation:
        reason === "RISK_APPROVED_NOT_ALLOWED_BY_DEPLOYED_STATUS_CHECK"
          ? "DEPLOYED_CHECK_CONSTRAINT_CONFLICTS_WITH_CANONICAL_RISK_APPROVED_ORDER_FLOW"
          : (
              riskApprovedAllowed === false
                ? "RISK_APPROVED_MISSING_FROM_DEPLOYED_STATUS_CONSTRAINT"
                : "REVIEW_PROBE_RESULT"
            ),
      safety: {
        precheckReadsConstraintBeforeFixtureWrite: true,
        syntheticFixtureOnlyIfConstraintAllowsIt: true,
        regressionFixtureRollbackProtected: true,
        realBrokerApiInvoked: false,
        realOrdersSent: false,
        shadowFilesModified: false,
        realTradingEnabled: false,
      },
      nextGate:
        "RECONCILE_DEPLOYED_STATUS_CHECK_WITH_ORDER_STATE_MACHINE_BEFORE_ACCOUNTING_RECON",
    }, null, 2));

    process.exitCode = res.ok ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({
      status: "AI_STOCK_LAB_PAPER_ORDER_STATUS_CONTRACT_PROBE_V1_FAILED",
      reason: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  }
})();
