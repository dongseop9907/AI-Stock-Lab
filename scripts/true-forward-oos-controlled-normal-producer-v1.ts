import {
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
