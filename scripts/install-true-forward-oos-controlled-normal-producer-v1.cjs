const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const RUNNER = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-controlled-normal-producer-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-controlled-normal-producer-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-controlled-normal-producer-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
  "lib/trading/krx-trading-calendar.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(ROOT, rel)
      )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    { missing }
  );
} else {
  const runnerSource = `import {
  runTrueForwardOosAutomationBindingV1,
} from "../lib/research/run-true-forward-oos-automation-binding-v1";

import {
  isKrxTradingDate,
} from "../lib/trading/krx-trading-calendar";

export const CONTROLLED_NORMAL_PRODUCER_CONFIRM =
  "RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER";

export interface ControlledNormalProducerInput {
  now?: Date;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
}

function kstParts(
  now: Date,
) {
  const shifted =
    new Date(
      now.getTime() +
      9 * 60 * 60 * 1000,
    );

  const iso =
    shifted.toISOString();

  return {
    date:
      iso.slice(0, 10),

    hhmm:
      iso.slice(11, 16),

    isoKst:
      iso.replace(
        "Z",
        "+09:00",
      ),
  };
}

function inControlledWindow(
  hhmm: string,
) {
  return (
    hhmm >= "08:45" &&
    hhmm <= "08:59"
  );
}

function anyRealTradingFlagTrue(
  env: NodeJS.ProcessEnv,
) {
  return [
    env.REAL_TRADING_ENABLED,
    env.ENABLE_REAL_TRADING,
    env.ENABLE_LIVE_TRADING,
  ].some(
    value =>
      String(value ?? "")
        .toLowerCase() ===
      "true",
  );
}

export async function runControlledNormalProducerV1(
  input: ControlledNormalProducerInput = {},
) {
  const now =
    input.now ??
    new Date();

  const env = {
    ...process.env,
    ...(input.env ?? {}),
  };

  const kst =
    kstParts(now);

  if (
    env.FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED !==
    "true"
  ) {
    return {
      status:
        "CONTROLLED_NORMAL_PRODUCER_DISABLED",

      executed:
        false,

      reason:
        "ENABLE_FLAG_REQUIRED",

      kst,
    };
  }

  if (
    env.FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_CONFIRM !==
    CONTROLLED_NORMAL_PRODUCER_CONFIRM
  ) {
    return {
      status:
        "CONTROLLED_NORMAL_PRODUCER_BLOCKED",

      executed:
        false,

      reason:
        "EXACT_CONFIRMATION_REQUIRED",

      kst,
    };
  }

  if (
    anyRealTradingFlagTrue(env)
  ) {
    return {
      status:
        "CONTROLLED_NORMAL_PRODUCER_BLOCKED",

      executed:
        false,

      reason:
        "REAL_TRADING_MUST_REMAIN_DISABLED",

      kst,
    };
  }

  if (
    env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY ===
    "true"
  ) {
    return {
      status:
        "CONTROLLED_NORMAL_PRODUCER_BLOCKED",

      executed:
        false,

      reason:
        "PROBE_MODE_MUST_BE_DISABLED_FOR_NORMAL_PRODUCER",

      kst,
    };
  }

  if (
    !isKrxTradingDate(
      kst.date,
      [],
    )
  ) {
    return {
      status:
        "CONTROLLED_NORMAL_PRODUCER_SKIPPED",

      executed:
        false,

      reason:
        "NON_KRX_TRADING_DAY",

      kst,
    };
  }

  if (
    !inControlledWindow(
      kst.hhmm,
    )
  ) {
    return {
      status:
        "CONTROLLED_NORMAL_PRODUCER_BLOCKED",

      executed:
        false,

      reason:
        "OUTSIDE_0845_0859_KST_WINDOW",

      kst,
    };
  }

  if (
    input.dryRun === true
  ) {
    return {
      status:
        "CONTROLLED_NORMAL_PRODUCER_READY_DRY_RUN",

      executed:
        false,

      reason:
        null,

      kst,

      safety: {
        normalProducerExecuted:
          false,

        realTradingEnabled:
          false,
      },
    };
  }

  let state: any =
    null;

  const result =
    await runTrueForwardOosAutomationBindingV1(
      {
        now,
      },
      {
        env: {
          ...env,

          FORWARD_OOS_AUTOMATION_ENABLED:
            "true",

          FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
            "false",

          REAL_TRADING_ENABLED:
            "false",

          ENABLE_REAL_TRADING:
            "false",

          ENABLE_LIVE_TRADING:
            "false",
        },

        loadState:
          () =>
            state,

        saveState:
          nextState => {
            state =
              JSON.parse(
                JSON.stringify(
                  nextState,
                ),
              );
          },
      },
    );

  return {
    status:
      "CONTROLLED_NORMAL_PRODUCER_EXECUTED",

    executed:
      true,

    kst,

    automationResult:
      result,

    safety: {
      realTradingEnabled:
        false,
    },
  };
}

async function main() {
  const dryRun =
    process.argv.includes(
      "--dry-run",
    );

  const result =
    await runControlledNormalProducerV1({
      dryRun,
    });

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  const status =
    String(
      (result as any).status ??
      "",
    );

  process.exitCode =
    status ===
      "CONTROLLED_NORMAL_PRODUCER_EXECUTED" ||
    status ===
      "CONTROLLED_NORMAL_PRODUCER_READY_DRY_RUN" ||
    status ===
      "CONTROLLED_NORMAL_PRODUCER_SKIPPED" ||
    status ===
      "CONTROLLED_NORMAL_PRODUCER_DISABLED"
      ? 0
      : 1;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-controlled-normal-producer-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "CONTROLLED_NORMAL_PRODUCER_ERROR",

            error:
              String(
                error instanceof Error
                  ? error.stack ??
                    error.message
                  : error
              ),
          },
          null,
          2,
        ),
      );

      process.exitCode = 1;
    },
  );
}
`;

  const contractSource = `import assert from "node:assert/strict";

import {
  CONTROLLED_NORMAL_PRODUCER_CONFIRM,
  runControlledNormalProducerV1,
} from "./true-forward-oos-controlled-normal-producer-v1";

async function main() {
  const baseEnv = {
    FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED:
      "true",

    FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_CONFIRM:
      CONTROLLED_NORMAL_PRODUCER_CONFIRM,

    FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
      "false",

    REAL_TRADING_ENABLED:
      "false",

    ENABLE_REAL_TRADING:
      "false",

    ENABLE_LIVE_TRADING:
      "false",
  };

  const disabled =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env: {
        ...baseEnv,

        FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED:
          "false",
      },
    });

  const wrongConfirm =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env: {
        ...baseEnv,

        FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_CONFIRM:
          "WRONG",
      },
    });

  const realTradingBlocked =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env: {
        ...baseEnv,

        REAL_TRADING_ENABLED:
          "true",
      },
    });

  const probeBlocked =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env: {
        ...baseEnv,

        FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
          "true",
      },
    });

  const holiday =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-08T23:50:00.000Z",
        ),

      dryRun:
        true,

      env:
        baseEnv,
    });

  const tooEarly =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:40:00.000Z",
        ),

      dryRun:
        true,

      env:
        baseEnv,
    });

  const tooLate =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-12T00:01:00.000Z",
        ),

      dryRun:
        true,

      env:
        baseEnv,
    });

  const ready =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env:
        baseEnv,
    });

  const checks = {
    disabledByDefaultGate:
      disabled.status ===
      "CONTROLLED_NORMAL_PRODUCER_DISABLED",

    wrongConfirmationBlocked:
      wrongConfirm.reason ===
      "EXACT_CONFIRMATION_REQUIRED",

    realTradingBlocked:
      realTradingBlocked.reason ===
      "REAL_TRADING_MUST_REMAIN_DISABLED",

    probeModeBlocked:
      probeBlocked.reason ===
      "PROBE_MODE_MUST_BE_DISABLED_FOR_NORMAL_PRODUCER",

    hangeulDaySkipped:
      holiday.reason ===
      "NON_KRX_TRADING_DAY",

    tooEarlyBlocked:
      tooEarly.reason ===
      "OUTSIDE_0845_0859_KST_WINDOW",

    tooLateBlocked:
      tooLate.reason ===
      "OUTSIDE_0845_0859_KST_WINDOW",

    oct12ReadyDryRun:
      ready.status ===
      "CONTROLLED_NORMAL_PRODUCER_READY_DRY_RUN",

    dryRunNeverExecutesNormalProducer:
      ready.executed ===
      false,
  };

  for (
    const [
      key,
      value,
    ] of Object.entries(
      checks,
    )
  ) {
    assert.equal(
      value,
      true,
      key,
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          disabled,
          wrongConfirm,
          realTradingBlocked,
          probeBlocked,
          holiday,
          tooEarly,
          tooLate,
          ready,
        },

        safety: {
          normalProducerExecuted:
            false,

          databaseReadsExpected:
            0,

          databaseWritesExpected:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          realTradingEnabled:
            false,
        },

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_PREPARE_2026_10_12_CONTROLLED_NORMAL_PRODUCER_RUN",
      },
      null,
      2,
    ),
  );
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_CONTRACT_FAILED",

          error:
            String(
              error instanceof Error
                ? error.stack ??
                  error.message
                : error
            ),
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
`;

  const staticSource = `const fs = require("fs");
const path = require("path");

const root = process.cwd();

const target = path.join(
  root,
  "scripts",
  "true-forward-oos-controlled-normal-producer-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_STATIC_FAILED",
    failed:
      ["runnerExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    runnerExists:
      true,

    exactEnableFlag:
      /FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED[\\s\\S]{0,120}!==[\\s\\S]{0,40}"true"/.test(
        source
      ),

    exactConfirmPhrase:
      source.includes(
        "RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER"
      ),

    realTradingBlock:
      source.includes(
        "REAL_TRADING_MUST_REMAIN_DISABLED"
      ),

    probeModeBlock:
      source.includes(
        "PROBE_MODE_MUST_BE_DISABLED_FOR_NORMAL_PRODUCER"
      ),

    krxGuard:
      source.includes(
        "isKrxTradingDate"
      ),

    controlledTimeWindow:
      source.includes(
        '"08:45"'
      ) &&
      source.includes(
        '"08:59"'
      ),

    dryRunSurface:
      source.includes(
        "CONTROLLED_NORMAL_PRODUCER_READY_DRY_RUN"
      ),

    automationBindingUsed:
      source.includes(
        "runTrueForwardOosAutomationBindingV1"
      ),

    automationExplicitlyEnabledOnlyInsideRunner:
      source.includes(
        'FORWARD_OOS_AUTOMATION_ENABLED:'
      ) &&
      source.includes(
        '"true"'
      ),

    producerProbeForcedOffForNormalRun:
      source.includes(
        'FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:'
      ) &&
      source.includes(
        '"false"'
      ),

    realTradingForcedFalse:
      source.includes(
        'REAL_TRADING_ENABLED:'
      ) &&
      source.includes(
        'ENABLE_REAL_TRADING:'
      ) &&
      source.includes(
        'ENABLE_LIVE_TRADING:'
      ),

    inMemoryState:
      source.includes(
        "let state: any"
      ) &&
      source.includes(
        "loadState:"
      ) &&
      source.includes(
        "saveState:"
      ),
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, value]) =>
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      normalProducerExecuted:
        false,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_CONTROLLED_NORMAL_PRODUCER_CONTRACT"
        : "REPAIR_CONTROLLED_NORMAL_PRODUCER_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

  fs.writeFileSync(
    RUNNER,
    runnerSource,
    "utf8"
  );

  fs.writeFileSync(
    CONTRACT,
    contractSource,
    "utf8"
  );

  fs.writeFileSync(
    STATIC,
    staticSource,
    "utf8"
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8"
        )
      );
  } catch (error) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error
          ),
      }
    );
  }

  if (pkg) {
    pkg.scripts ||= {};

    pkg.scripts[
      "forward-oos:controlled-producer"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-controlled-normal-producer-v1.ts";

    pkg.scripts[
      "forward-oos:controlled-producer:dry-run"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-controlled-normal-producer-v1.ts --dry-run";

    pkg.scripts[
      "test:true-forward-oos-controlled-producer"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-controlled-normal-producer-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-controlled-producer-static"
    ] =
      "node ./scripts/true-forward-oos-controlled-normal-producer-v1-static-verify.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
        "scripts/true-forward-oos-controlled-normal-producer-v1-contract-test.ts",
        "scripts/true-forward-oos-controlled-normal-producer-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      behavior: {
        default:
          "BLOCKED",

        explicitEnable:
          "FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED=true",

        exactConfirmation:
          "RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER",

        validWindow:
          "08:45-08:59 KST",

        krxTradingDateRequired:
          true,

        probeModeRequiredOff:
          true,

        realTradingRequiredOff:
          true,

        dryRunAvailable:
          true
      },

      safety: {
        installerExecutedNormalProducer:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        realTradingEnabled:
          false
      },

      nextAction:
        "RUN_STATIC_AND_CONTRACT"
    }, null, 2));

    process.exitCode = 0;
  }
}
