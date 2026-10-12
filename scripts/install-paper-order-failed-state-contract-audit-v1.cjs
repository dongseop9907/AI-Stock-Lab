const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const OUTPUT = path.join(
  SCRIPTS,
  "paper-order-failed-state-contract-audit-v1.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_PAPER_ORDER_FAILED_STATE_CONTRACT_AUDIT_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(path.join(ROOT, "supabase", "migrations"))) {
  fail("SUPABASE_MIGRATIONS_NOT_FOUND");
} else {
  fs.mkdirSync(SCRIPTS, { recursive: true });

  const audit = String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

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
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function files() {
  return fs.readdirSync(MIG_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      rel: "supabase/migrations/" + name,
      src: fs.readFileSync(path.join(MIG_DIR, name), "utf8"),
    }));
}

function compact(src, patterns, max = 12) {
  const out = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((re) => re.test(lines[i]))) {
      out.push({ line: i + 1, text: lines[i].trim().slice(0, 220) });
      if (out.length >= max) break;
    }
  }
  return out;
}

function latestContaining(all, regex) {
  const matches = all.filter((f) => regex.test(f.src));
  return matches.length ? matches[matches.length - 1] : null;
}

function allContaining(all, regex) {
  return all.filter((f) => regex.test(f.src));
}

loadEnv(path.join(ROOT, ".env.local"));

(async () => {
  const all = files();

  const statusConstraintFiles = allContaining(
    all,
    /paper_order_requests_status_check/i
  );

  const failedWriteFiles = allContaining(
    all,
    /paper_order_requests[\s\S]{0,1600}status\s*=\s*'FAILED'|status\s*=\s*'FAILED'[\s\S]{0,1600}paper_order_requests/i
  );

  const terminalReleaseFiles = allContaining(
    all,
    /release_terminal_paper_order_reserved_risk_v3/i
  );

  const stateMachineFiles = allContaining(
    all,
    /ALPHA_V3_ORDER_STATE_MACHINE_V1/i
  );

  const latestConstraintSource =
    latestContaining(all, /paper_order_requests_status_check/i);

  const latestBuyV2 =
    latestContaining(
      all,
      /create\s+or\s+replace\s+function\s+public\.execute_paper_buy_order_with_execution_price_v2\s*\(/i
    );

  const latestBuyV5 =
    latestContaining(
      all,
      /create\s+or\s+replace\s+function\s+public\.execute_paper_buy_order_with_execution_price_v5\s*\(/i
    );

  const latestStateMachine =
    stateMachineFiles.length
      ? stateMachineFiles[stateMachineFiles.length - 1]
      : null;

  const sourceFacts = {
    failedWritePathPresent:
      failedWriteFiles.length > 0,

    terminalReleaseMentionsFailed:
      terminalReleaseFiles.some((f) =>
        /FAILED/i.test(f.src)
      ),

    stateMachineSourceFound:
      Boolean(latestStateMachine),

    stateMachineMentionsFailed:
      Boolean(
        latestStateMachine &&
        /FAILED/i.test(latestStateMachine.src)
      ),

    stateMachineMentionsRiskApprovedToExpired:
      Boolean(
        latestStateMachine &&
        /RISK_APPROVED[\s\S]{0,500}EXPIRED|EXPIRED[\s\S]{0,500}RISK_APPROVED/i
          .test(latestStateMachine.src)
      ),

    stateMachineMentionsRiskApprovedToFilled:
      Boolean(
        latestStateMachine &&
        /RISK_APPROVED[\s\S]{0,500}FILLED|FILLED[\s\S]{0,500}RISK_APPROVED/i
          .test(latestStateMachine.src)
      ),
  };

  let remote = {
    attempted: false,
    httpOk: false,
    status: null,
    deployedStatusConstraint: null,
    failedAllowed: null,
    riskApprovedAllowed: null,
    filledAllowed: null,
    probeStatus: null,
    error: null,
  };

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (base && key) {
    remote.attempted = true;
    try {
      const res = await fetch(
        base +
        "/rest/v1/rpc/run_paper_buy_v5_idempotent_replay_runtime_regression_v1",
        {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: "{}",
        }
      );

      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }

      const constraint =
        body && typeof body === "object"
          ? (body.deployedStatusConstraint ?? null)
          : null;

      const upper =
        typeof constraint === "string"
          ? constraint.toUpperCase()
          : "";

      remote = {
        attempted: true,
        httpOk: res.ok,
        status: res.status,
        deployedStatusConstraint: constraint,
        failedAllowed:
          constraint
            ? upper.includes("FAILED")
            : null,
        riskApprovedAllowed:
          constraint
            ? upper.includes("RISK_APPROVED")
            : null,
        filledAllowed:
          constraint
            ? upper.includes("FILLED")
            : null,
        probeStatus:
          body && typeof body === "object"
            ? (body.status ?? null)
            : null,
        error:
          res.ok ? null : body,
      };
    } catch (error) {
      remote.error =
        error instanceof Error
          ? error.message
          : String(error);
    }
  }

  const contractMismatch =
    sourceFacts.failedWritePathPresent === true &&
    sourceFacts.terminalReleaseMentionsFailed === true &&
    remote.failedAllowed === false;

  let classification = "REVIEW_REQUIRED";

  if (
    contractMismatch &&
    sourceFacts.stateMachineSourceFound &&
    sourceFacts.stateMachineMentionsFailed === false
  ) {
    classification =
      "FAILED_STATUS_MISSING_FROM_DB_CONSTRAINT_AND_STATE_MACHINE_CONTRACT";
  } else if (
    contractMismatch &&
    sourceFacts.stateMachineMentionsFailed === true
  ) {
    classification =
      "FAILED_STATUS_SUPPORTED_BY_STATE_MACHINE_BUT_MISSING_FROM_DB_CONSTRAINT";
  } else if (
    sourceFacts.failedWritePathPresent &&
    remote.failedAllowed === true
  ) {
    classification =
      "FAILED_STATUS_DB_CONSTRAINT_ALREADY_ALIGNED";
  }

  const checks = {
    migrationsScanned:
      all.length > 0,

    failedWritePathFound:
      sourceFacts.failedWritePathPresent,

    terminalReleaseFailedFound:
      sourceFacts.terminalReleaseMentionsFailed,

    deployedConstraintProbed:
      remote.attempted && remote.httpOk,

    deployedRiskApprovedAllowed:
      remote.riskApprovedAllowed === true,

    deployedFilledAllowed:
      remote.filledAllowed === true,

    mismatchReproduced:
      contractMismatch,
  };

  const failedChecks =
    Object.entries(checks)
      .filter(([key, value]) => {
        if (key === "mismatchReproduced") return false;
        return value !== true;
      })
      .map(([key]) => key);

  console.log(JSON.stringify({
    status:
      failedChecks.length === 0
        ? "AI_STOCK_LAB_PAPER_ORDER_FAILED_STATE_CONTRACT_AUDIT_V1_COMPLETE"
        : "AI_STOCK_LAB_PAPER_ORDER_FAILED_STATE_CONTRACT_AUDIT_V1_INCOMPLETE",

    classification,

    checks,
    failedChecks,

    sourceFacts,

    remote,

    evidence: {
      latestConstraintSource:
        latestConstraintSource
          ? latestConstraintSource.rel
          : null,

      latestBuyV2:
        latestBuyV2
          ? latestBuyV2.rel
          : null,

      latestBuyV5:
        latestBuyV5
          ? latestBuyV5.rel
          : null,

      latestStateMachine:
        latestStateMachine
          ? latestStateMachine.rel
          : null,

      failedWriteFiles:
        failedWriteFiles.map((f) => f.rel),

      terminalReleaseFiles:
        terminalReleaseFiles.map((f) => f.rel),

      statusConstraintFiles:
        statusConstraintFiles.map((f) => f.rel),

      failedWriteSnippets:
        failedWriteFiles.slice(-3).map((f) => ({
          file: f.rel,
          snippets: compact(
            f.src,
            [
              /status\s*=\s*'FAILED'/i,
              /execution_block_reason/i,
              /ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK/i,
              /STOP_DISTANCE_TOO_FAR_AT_EXECUTION/i,
            ]
          ),
        })),

      stateMachineSnippets:
        latestStateMachine
          ? compact(
              latestStateMachine.src,
              [
                /RISK_APPROVED/i,
                /FILLED/i,
                /EXPIRED/i,
                /FAILED/i,
                /CREATE_ALLOWED/i,
                /TRANSITION_ALLOWED/i,
                /TERMINAL_STATE_CANNOT_TRANSITION/i,
              ],
              20
            )
          : [],
    },

    safety: {
      localSourceReadOnly: true,
      remoteRegressionFixtureTransactionLocal: true,
      remoteFixtureRollbackProtected: true,
      schemaModified: false,
      productionTradingFunctionsModified: false,
      ordersPersisted: false,
      positionsPersisted: false,
      shadowFilesModified: false,
      realBrokerApiInvoked: false,
      realTradingEnabled: false,
    },

    nextGate:
      classification ===
        "FAILED_STATUS_MISSING_FROM_DB_CONSTRAINT_AND_STATE_MACHINE_CONTRACT"
        ? "DESIGN_ATOMIC_FAILED_STATE_CONTRACT_REPAIR_FOR_VALIDATOR_AND_DB_CHECK"
        : classification ===
          "FAILED_STATUS_SUPPORTED_BY_STATE_MACHINE_BUT_MISSING_FROM_DB_CONSTRAINT"
          ? "DESIGN_DB_CHECK_ONLY_FAILED_STATUS_REPAIR"
          : "REVIEW_FAILED_STATE_CONTRACT_AUDIT",
  }, null, 2));

  process.exitCode =
    failedChecks.length === 0
      ? 0
      : 1;
})();
`;

  fs.writeFileSync(OUTPUT, audit, "utf8");

  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ORDER_FAILED_STATE_CONTRACT_AUDIT_V1_INSTALLED",

    generatedFile:
      "scripts/paper-order-failed-state-contract-audit-v1.cjs",

    audits: [
      "production BUY paths that write paper_order_requests.status=FAILED",
      "terminal reserved-risk release semantics for FAILED",
      "ALPHA_V3 order-state-machine FAILED support",
      "deployed paper_order_requests_status_check via rollback-protected regression probe",
      "whether repair must change DB CHECK only or DB CHECK + state machine together",
    ],

    safety: {
      sourceOnlyInstall: true,
      databaseWritesDuringInstall: 0,
      runtimeProbeUsesRollbackProtectedSyntheticFixture: true,
      schemaModified: false,
      shadowFilesModified: false,
      realTradingEnabled: false,
    },

    nextAction:
      "RUN_FAILED_STATE_CONTRACT_AUDIT_AND_SEND_JSON",
  }, null, 2));
}
