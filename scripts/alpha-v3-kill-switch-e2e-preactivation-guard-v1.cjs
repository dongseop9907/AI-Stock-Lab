const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();

function parseEnvFile(file) {
  const env = {};

  if (!fs.existsSync(file)) {
    return env;
  }

  for (
    const rawLine of
      fs.readFileSync(file, "utf8")
        .split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (
      !line ||
      line.startsWith("#")
    ) {
      continue;
    }

    const index =
      line.indexOf("=");

    if (index <= 0) {
      continue;
    }

    const key =
      line.slice(0, index).trim();

    let value =
      line.slice(index + 1).trim();

    if (
      (
        value.startsWith('"') &&
        value.endsWith('"')
      ) ||
      (
        value.startsWith("'") &&
        value.endsWith("'")
      )
    ) {
      value =
        value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

const env = {
  ...parseEnvFile(
    path.resolve(
      root,
      ".env.local"
    )
  ),
  ...process.env
};

const supabaseUrl =
  String(
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.SUPABASE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

const serviceRoleKey =
  String(
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_KEY ||
    ""
  ).trim();

function runStep(
  name,
  command,
  args
) {
  const result =
    spawnSync(
      command,
      args,
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        env: process.env
      }
    );

  const stdout =
    result.stdout ?? "";

  const stderr =
    result.stderr ?? "";

  let status = null;

  const statusCandidates =
    [...stdout.matchAll(
      /"status"\s*:\s*"([^"]+)"/g
    )].map(
      (item) => item[1]
    );

  if (
    statusCandidates.length > 0
  ) {
    status =
      statusCandidates[0];
  }

  return {
    name,
    exitCode:
      result.status,

    status,

    statusCandidates,

    ok:
      result.status === 0,

    stdout,
    stderr
  };
}

async function parseResponse(response) {
  const text =
    await response.text();

  try {
    return text
      ? JSON.parse(text)
      : null;
  } catch {
    return {
      raw: text
    };
  }
}

async function get(
  pathname,
  count = false
) {
  const headers = {
    apikey:
      serviceRoleKey,

    authorization:
      "Bearer " +
      serviceRoleKey
  };

  if (count) {
    headers.prefer =
      "count=exact";

    headers.range =
      "0-0";
  }

  const response =
    await fetch(
      supabaseUrl +
      pathname,
      {
        method: "GET",
        headers,
        cache: "no-store"
      }
    );

  const payload =
    await parseResponse(
      response
    );

  let exactCount = null;

  if (count) {
    const range =
      response.headers.get(
        "content-range"
      );

    const match =
      range?.match(
        /\/(\d+|\*)$/
      );

    if (
      match &&
      match[1] !== "*"
    ) {
      exactCount =
        Number(match[1]);
    }
  }

  return {
    ok:
      response.ok,

    status:
      response.status,

    payload,
    count:
      exactCount
  };
}

async function rpc(
  name,
  body = {}
) {
  const response =
    await fetch(
      supabaseUrl +
      "/rest/v1/rpc/" +
      name,
      {
        method: "POST",

        headers: {
          apikey:
            serviceRoleKey,

          authorization:
            "Bearer " +
            serviceRoleKey,

          "content-type":
            "application/json"
        },

        body:
          JSON.stringify(body),

        cache:
          "no-store"
      }
    );

  return {
    ok:
      response.ok,

    status:
      response.status,

    payload:
      await parseResponse(
        response
      )
  };
}

async function snapshot() {
  const [
    killSwitch,
    control,
    orders,
    approved,
    reservations,
    positions,
    events,
    invalidTransitions,
    automationRuns
  ] =
    await Promise.all([
      rpc(
        "get_trading_kill_switch_status_v1"
      ),

      get(
        "/rest/v1/trading_system_controls?select=control_key,automation_enabled,paper_order_enabled,real_order_enabled,emergency_stop,updated_at&control_key=eq.global&limit=1"
      ),

      get(
        "/rest/v1/paper_order_requests?select=id",
        true
      ),

      get(
        "/rest/v1/paper_order_requests?select=id&status=eq.RISK_APPROVED",
        true
      ),

      get(
        "/rest/v1/paper_order_requests?select=id&reserved_risk_amount=gt.0&reserved_risk_released_at=is.null",
        true
      ),

      get(
        "/rest/v1/paper_positions?select=id",
        true
      ),

      get(
        "/rest/v1/trading_kill_switch_events?select=id",
        true
      ),

      get(
        "/rest/v1/paper_order_state_transition_audit?select=id&allowed=eq.false",
        true
      ),

      get(
        "/rest/v1/trading_automation_runs?select=id",
        true
      )
    ]);

  return {
    killSwitch,

    control:
      Array.isArray(
        control.payload
      )
        ? control.payload[0]
        : null,

    orders:
      orders.count,

    approved:
      approved.count,

    reservations:
      reservations.count,

    positions:
      positions.count,

    events:
      events.count,

    invalidTransitions:
      invalidTransitions.count,

    automationRuns:
      automationRuns.count
  };
}

async function main() {
  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_CONFIG_MISSING"
    );
  }

  const before =
    await snapshot();

  const hardBlockers = [];

  if (
    before.killSwitch.ok !== true ||
    before.killSwitch.payload?.version !==
      "ALPHA_V3_KILL_SWITCH_V1"
  ) {
    hardBlockers.push(
      "KILL_SWITCH_STATUS_NOT_V1"
    );
  }

  if (
    before.control?.control_key !==
      "global"
  ) {
    hardBlockers.push(
      "GLOBAL_CONTROL_ROW_MISSING"
    );
  }

  if (
    before.control?.emergency_stop !==
      false
  ) {
    hardBlockers.push(
      "EMERGENCY_STOP_NOT_FALSE"
    );
  }

  if (
    before.orders !== 0 ||
    before.approved !== 0 ||
    before.reservations !== 0 ||
    before.positions !== 0
  ) {
    hardBlockers.push(
      "TRADING_STATE_NOT_EMPTY"
    );
  }

  if (
    before.events !== 0
  ) {
    hardBlockers.push(
      "KILL_SWITCH_EVENT_BASELINE_NOT_ZERO"
    );
  }

  if (
    before.invalidTransitions !== 0
  ) {
    hardBlockers.push(
      "INVALID_ORDER_TRANSITION_BASELINE_NOT_ZERO"
    );
  }

  if (
    hardBlockers.length > 0
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_KILL_SWITCH_E2E_PREACTIVATION_GUARD_V1_BLOCKED",

          hardBlockers,

          before,

          safety: {
            childStepsRun: 0,
            emergencyStopWrites: 0,
            ordersCreated: 0,
            positionsChanged: 0
          }
        },
        null,
        2
      )
    );

    process.exitCode = 2;
    return;
  }

  const steps = [];

  const node =
    process.execPath;

  const tscCli =
    path.resolve(
      root,
      "node_modules/typescript/bin/tsc"
    );

  if (!fs.existsSync(tscCli)) {
    throw new Error(
      "LOCAL_TYPESCRIPT_CLI_NOT_FOUND"
    );
  }

  steps.push(
    runStep(
      "APPLICATION_GUARDS_STATIC",
      node,
      [
        "scripts/alpha-v3-kill-switch-application-guards-v1-static-verify.cjs"
      ]
    )
  );

  steps.push(
    runStep(
      "APPLICATION_GUARDS_CONTRACT",
      node,
      [
        "scripts/alpha-v3-kill-switch-application-guards-v1-contract-test.cjs"
      ]
    )
  );

  steps.push(
    runStep(
      "CONTROL_RESET_STATIC",
      node,
      [
        "scripts/alpha-v3-kill-switch-control-reset-rpc-binding-v1-static-verify.cjs"
      ]
    )
  );

  steps.push(
    runStep(
      "TARGETED_TYPESCRIPT",
      node,
      [
        tscCli,
        "-p",
        "tsconfig.alpha-v3-production-cycle.json",
        "--noEmit"
      ]
    )
  );

  steps.push(
    runStep(
      "RESET_NEGATIVE_NO_WRITE",
      node,
      [
        "scripts/alpha-v3-kill-switch-control-reset-rpc-binding-v1-negative-test.cjs"
      ]
    )
  );

  steps.push(
    runStep(
      "NO_ORDER_OPERATIONAL_REGRESSION",
      node,
      [
        "scripts/alpha-v3-kill-switch-no-order-operational-regression-v1.cjs"
      ]
    )
  );

  const [
    validatorAllow,
    validatorEmergencyBlock,
    validatorPaperDisabledBlock,
    liveGuard
  ] =
    await Promise.all([
      rpc(
        "validate_paper_buy_new_risk_control_v1",
        {
          p_emergency_stop:
            false,

          p_paper_order_enabled:
            true
        }
      ),

      rpc(
        "validate_paper_buy_new_risk_control_v1",
        {
          p_emergency_stop:
            true,

          p_paper_order_enabled:
            true
        }
      ),

      rpc(
        "validate_paper_buy_new_risk_control_v1",
        {
          p_emergency_stop:
            false,

          p_paper_order_enabled:
            false
        }
      ),

      rpc(
        "assert_paper_buy_new_risk_allowed_v1",
        {}
      )
    ]);

  const after =
    await snapshot();

  const expectedStatuses = {
    APPLICATION_GUARDS_STATIC:
      "ALPHA_V3_KILL_SWITCH_APPLICATION_GUARDS_V1_STATIC_VERIFIED",

    APPLICATION_GUARDS_CONTRACT:
      "ALPHA_V3_KILL_SWITCH_APPLICATION_GUARDS_V1_CONTRACT_TEST_VERIFIED",

    CONTROL_RESET_STATIC:
      "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_STATIC_VERIFIED",

    RESET_NEGATIVE_NO_WRITE:
      "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_NEGATIVE_TEST_VERIFIED",

    NO_ORDER_OPERATIONAL_REGRESSION:
      "ALPHA_V3_KILL_SWITCH_NO_ORDER_OPERATIONAL_REGRESSION_VERIFIED"
  };

  const stepChecks = {};

  for (const step of steps) {
    if (
      step.name ===
      "TARGETED_TYPESCRIPT"
    ) {
      stepChecks[step.name] =
        step.ok === true;
      continue;
    }

    stepChecks[step.name] =
      step.ok === true &&
      step.stdout.includes(
        `"status": "${expectedStatuses[step.name]}"`
      );
  }

  const checks = {
    ...stepChecks,

    validatorAllowsNormalState:
      validatorAllow.ok === true &&
      validatorAllow.payload?.allowed ===
        true,

    validatorBlocksEmergency:
      validatorEmergencyBlock.ok === true &&
      validatorEmergencyBlock.payload?.allowed ===
        false &&
      validatorEmergencyBlock.payload?.reason ===
        "EMERGENCY_STOP_ACTIVE",

    validatorBlocksPaperDisabled:
      validatorPaperDisabledBlock.ok === true &&
      validatorPaperDisabledBlock.payload?.allowed ===
        false &&
      validatorPaperDisabledBlock.payload?.reason ===
        "PAPER_ORDER_DISABLED",

    dbGuardAllowsCurrentControl:
      liveGuard.ok === true,

    emergencyStopStillFalse:
      after.control?.emergency_stop ===
        false,

    controlIdentityUnchanged:
      after.control?.control_key ===
        "global",

    noOrdersCreated:
      before.orders === 0 &&
      after.orders === 0,

    noApprovedOrdersCreated:
      before.approved === 0 &&
      after.approved === 0,

    noReservationsCreated:
      before.reservations === 0 &&
      after.reservations === 0,

    noPositionsCreated:
      before.positions === 0 &&
      after.positions === 0,

    noKillSwitchEventsCreated:
      before.events === 0 &&
      after.events === 0,

    noInvalidTransitionsCreated:
      before.invalidTransitions === 0 &&
      after.invalidTransitions === 0,

    exactlyOneOperationalAutomationRunAdded:
      Number.isInteger(
        before.automationRuns
      ) &&
      Number.isInteger(
        after.automationRuns
      ) &&
      after.automationRuns -
      before.automationRuns === 1
  };

  const failed =
    Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key);

  const report = {
    status:
      failed.length === 0
        ? "ALPHA_V3_KILL_SWITCH_E2E_PREACTIVATION_GUARD_V1_VERIFIED"
        : "ALPHA_V3_KILL_SWITCH_E2E_PREACTIVATION_GUARD_V1_REVIEW",

    milestone: {
      killSwitchContract:
        "COMPLETE",

      dbLatchAuditFoundation:
        "COMPLETE",

      applicationGuards:
        "COMPLETE",

      dbCreateFillGuards:
        "COMPLETE",

      controlResetRpcBinding:
        "COMPLETE",

      e2ePreactivation:
        failed.length === 0
          ? "COMPLETE"
          : "REVIEW"
    },

    checks,
    failed,

    before,

    after,

    childSteps:
      steps.map(
        (step) => ({
          name:
            step.name,

          ok:
            step.ok,

          exitCode:
            step.exitCode,

          status:
            expectedStatuses[
              step.name
            ] &&
            step.stdout.includes(
              `"status": "${expectedStatuses[step.name]}"`
            )
              ? expectedStatuses[
                  step.name
                ]
              : step.status
        })
      ),

    dbValidator: {
      allow:
        validatorAllow.payload,

      emergencyBlock:
        validatorEmergencyBlock.payload,

      paperDisabledBlock:
        validatorPaperDisabledBlock.payload,

      liveGuardStatus:
        liveGuard.status
    },

    safety: {
      productionKillSwitchTripCalls:
        0,

      productionKillSwitchResetCalls:
        0,

      productionOrderCreateCalls:
        0,

      productionFillCalls:
        0,

      emergencyStopWrites:
        0,

      ordersChanged:
        after.orders -
        before.orders,

      positionsChanged:
        after.positions -
        before.positions,

      killSwitchEventsChanged:
        after.events -
        before.events
    },

    nextGate:
      failed.length === 0
        ? "KILL_SWITCH_V1_COMPLETE_MOVE_TO_DATA_FRESHNESS_PRODUCTION_HARDENING"
        : "REVIEW_KILL_SWITCH_E2E_PREACTIVATION"
  };

  const logFile =
    path.resolve(
      root,
      "logs/alpha-v3-kill-switch-e2e-preactivation-guard-v1.json"
    );

  fs.mkdirSync(
    path.dirname(logFile),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    logFile,
    JSON.stringify(
      {
        ...report,

        childStepDetails:
          steps
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        milestone:
          report.milestone,

        failed:
          report.failed,

        childSteps:
          report.childSteps,

        stateDelta: {
          orders:
            after.orders -
            before.orders,

          approved:
            after.approved -
            before.approved,

          reservations:
            after.reservations -
            before.reservations,

          positions:
            after.positions -
            before.positions,

          killSwitchEvents:
            after.events -
            before.events,

          invalidTransitions:
            after.invalidTransitions -
            before.invalidTransitions,

          automationRuns:
            after.automationRuns -
            before.automationRuns
        },

        safety:
          report.safety,

        logFile:
          "logs/alpha-v3-kill-switch-e2e-preactivation-guard-v1.json",

        nextGate:
          report.nextGate
      },
      null,
      2
    )
  );

  if (failed.length > 0) {
    process.exitCode = 2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_KILL_SWITCH_E2E_PREACTIVATION_GUARD_V1_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          nextGate:
            "REVIEW_KILL_SWITCH_E2E_PREACTIVATION_FATAL"
        },
        null,
        2
      )
    );

    process.exitCode = 2;
  }
);
