const fs = require("fs");
const path = require("path");
const {
  spawnSync,
} = require("child_process");

const ROOT = process.cwd();

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-true-forward-top1-producer-v1.ts"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_REAL_SUBPROCESS_V1_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail("PRODUCER_NOT_FOUND");
} else {
  const env = {
    ...process.env,

    FORWARD_OOS_AUTOMATION_ENABLED:
      "false",

    REAL_TRADING_ENABLED:
      "false",

    ENABLE_REAL_TRADING:
      "false",

    ENABLE_LIVE_TRADING:
      "false",
  };

  const args = [
    "--env-file=.env.local",
    "--import",
    "tsx",
    TARGET,
    "--probe-only",
  ];

  const result =
    spawnSync(
      process.execPath,
      args,
      {
        cwd:
          ROOT,

        env,

        encoding:
          "utf8",

        shell:
          false,

        timeout:
          15000,
      }
    );

  const stdout =
    String(
      result.stdout ??
      ""
    ).trim();

  const stderr =
    String(
      result.stderr ??
      ""
    ).trim();

  let payload = null;

  try {
    payload =
      stdout
        ? JSON.parse(
            stdout
          )
        : null;
  } catch {
    payload = null;
  }

  const checks = {
    spawnErrorAbsent:
      !result.error,

    exitedZero:
      result.status ===
      0,

    jsonPayloadParsed:
      payload !==
      null,

    probeOnlyAcknowledged:
      payload
        ?.probeOnly ===
      true,

    expectedStatus:
      payload
        ?.status ===
      "ALPHA_V3_TRUE_FORWARD_TOP1_PRODUCER_V1_PROBE_ONLY",

    producerRuntimeNotCalled:
      payload
        ?.safety
        ?.producerRuntimeCalled ===
      false,

    databaseReadsZero:
      payload
        ?.safety
        ?.databaseReads ===
      0,

    databaseWritesZero:
      payload
        ?.safety
        ?.databaseWrites ===
      0,

    fileWritesZero:
      payload
        ?.safety
        ?.fileWrites ===
      0,

    ordersCreatedZero:
      payload
        ?.safety
        ?.ordersCreated ===
      0,

    positionsChangedZero:
      payload
        ?.safety
        ?.positionsChanged ===
      0,

    realTradingDisabled:
      payload
        ?.safety
        ?.realTradingEnabled ===
      false,
  };

  const failed =
    Object.entries(
      checks
    )
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_REAL_SUBPROCESS_V1_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_REAL_SUBPROCESS_V1_FAILED",

    command: {
      executable:
        "process.execPath",

      args: [
        "--env-file=.env.local",
        "--import",
        "tsx",
        "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
        "--probe-only",
      ],
    },

    subprocess: {
      exitCode:
        result.status,

      signal:
        result.signal,

      spawnError:
        result.error
          ? String(
              result.error.message ??
              result.error
            )
          : null,

      stderrTail:
        stderr
          .split(/\r?\n/)
          .slice(
            -10
          ),
    },

    payload,

    checks,

    safety: {
      normalProducerExecution:
        false,

      probeOnlyExecution:
        true,

      databaseReads:
        payload
          ?.safety
          ?.databaseReads ??
        null,

      databaseWrites:
        payload
          ?.safety
          ?.databaseWrites ??
        null,

      fileWrites:
        payload
          ?.safety
          ?.fileWrites ??
        null,

      ordersCreated:
        payload
          ?.safety
          ?.ordersCreated ??
        null,

      positionsChanged:
        payload
          ?.safety
          ?.positionsChanged ??
        null,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RERUN_PRODUCER_IMPORT_AND_FORWARD_OOS_REGRESSION_THEN_VERIFY_AUTOMATION_PROBE_COMMAND"
        : "DO_NOT_RUN_NORMAL_PRODUCER_REPAIR_PROBE_ONLY_BOUNDARY",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
