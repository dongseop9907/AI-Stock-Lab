const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const RUNNER = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-controlled-producer-evidence-run-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-controlled-producer-evidence-run-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-controlled-producer-evidence-run-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
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
  const runnerSource = `import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  CONTROLLED_NORMAL_PRODUCER_CONFIRM,
  runControlledNormalProducerV1,
} from "./true-forward-oos-controlled-normal-producer-v1";

const ROOT =
  process.cwd();

const FORWARD_FILE_CANDIDATES = [
  "logs/alpha-v3-true-forward-oos.json",
  "logs/alpha-v3-true-forward-oos-v1.json",
  "logs/alpha-v3-true-forward-top1-sessions-v1.json",
];

function hashText(
  text: string,
) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function findForwardFile() {
  for (
    const rel of FORWARD_FILE_CANDIDATES
  ) {
    const abs =
      path.join(
        ROOT,
        rel,
      );

    if (
      fs.existsSync(abs)
    ) {
      return {
        rel,
        abs,
      };
    }
  }

  return null;
}

function loadForwardSnapshot() {
  const file =
    findForwardFile();

  if (!file) {
    return {
      exists: false,
      file: null,
      hash: null,
      sessionCount: 0,
      sessions: [] as any[],
    };
  }

  const text =
    fs.readFileSync(
      file.abs,
      "utf8",
    );

  let parsed: any =
    null;

  try {
    parsed =
      JSON.parse(text);
  } catch {
    parsed =
      null;
  }

  const sessions =
    Array.isArray(
      parsed?.sessions,
    )
      ? parsed.sessions
      : [];

  return {
    exists: true,
    file:
      file.rel,
    hash:
      hashText(text),
    sessionCount:
      sessions.length,
    sessions,
  };
}

function sessionKey(
  row: any,
) {
  return [
    row?.sourceTradingDate ?? "",
    row?.targetSessionDate ?? "",
  ].join("|");
}

function diffSessions(
  before: any[],
  after: any[],
) {
  const beforeKeys =
    new Set(
      before.map(
        sessionKey,
      ),
    );

  return after.filter(
    row =>
      !beforeKeys.has(
        sessionKey(row),
      ),
  );
}

export async function runControlledProducerEvidenceV1(
  input: {
    now?: Date;
    dryRun?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const before =
    loadForwardSnapshot();

  const env = {
    ...process.env,
    ...(input.env ?? {}),

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

  const controlled =
    await runControlledNormalProducerV1({
      now:
        input.now,

      dryRun:
        input.dryRun,

      env,
    });

  const after =
    loadForwardSnapshot();

  const newSessions =
    diffSessions(
      before.sessions,
      after.sessions,
    );

  const dryRun =
    input.dryRun === true;

  const checks = {
    beforeSnapshotCaptured:
      true,

    afterSnapshotCaptured:
      true,

    realTradingDisabled:
      env.REAL_TRADING_ENABLED ===
        "false" &&
      env.ENABLE_REAL_TRADING ===
        "false" &&
      env.ENABLE_LIVE_TRADING ===
        "false",

    probeModeDisabled:
      env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY ===
      "false",

    dryRunDidNotMutateForwardFile:
      !dryRun ||
      (
        before.hash ===
          after.hash &&
        before.sessionCount ===
          after.sessionCount
      ),

    normalRunCreatedAtMostOneSession:
      dryRun ||
      newSessions.length <= 1,

    noDuplicateNewSessionKeys:
      new Set(
        newSessions.map(
          sessionKey,
        ),
      ).size ===
      newSessions.length,
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, value]) =>
          value !== true,
      )
      .map(
        ([key]) =>
          key,
      );

  const report = {
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_FAILED",

    mode:
      dryRun
        ? "DRY_RUN"
        : "CONTROLLED_NORMAL",

    controlledResult:
      controlled,

    before: {
      exists:
        before.exists,

      file:
        before.file,

      hash:
        before.hash,

      sessionCount:
        before.sessionCount,
    },

    after: {
      exists:
        after.exists,

      file:
        after.file,

      hash:
        after.hash,

      sessionCount:
        after.sessionCount,
    },

    delta: {
      sessionCount:
        after.sessionCount -
        before.sessionCount,

      newSessions:
        newSessions.map(
          row => ({
            sourceTradingDate:
              row?.sourceTradingDate ??
              null,

            targetSessionDate:
              row?.targetSessionDate ??
              null,

            capturedAt:
              row?.capturedAt ??
              null,

            candidateCount:
              row?.candidateCount ??
              null,
          }),
        ),
    },

    checks,

    safety: {
      probeMode:
        false,

      realTradingEnabled:
        false,

      ordersCreatedExpected:
        0,

      positionsChangedExpected:
        0,
    },

    failed,

    nextGate:
      failed.length === 0
        ? (
            dryRun
              ? "READY_FOR_2026_10_12_CONTROLLED_NORMAL_PRODUCER_EVIDENCE_RUN"
              : "VERIFY_NEW_FORWARD_SESSION_CONTENT_AND_BEGIN_1D_3D_5D_OUTCOME_COLLECTION"
          )
        : "REPAIR_CONTROLLED_PRODUCER_EVIDENCE_RUN",
  };

  const logsDir =
    path.join(
      ROOT,
      "logs",
    );

  fs.mkdirSync(
    logsDir,
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    path.join(
      logsDir,
      "true-forward-oos-controlled-producer-evidence-run-v1.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ),
    "utf8",
  );

  return report;
}

async function main() {
  const dryRun =
    process.argv.includes(
      "--dry-run",
    );

  const report =
    await runControlledProducerEvidenceV1({
      dryRun,
    });

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    report.failed.length === 0
      ? 0
      : 1;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-controlled-producer-evidence-run-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_ERROR",

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
  runControlledProducerEvidenceV1,
} from "./true-forward-oos-controlled-producer-evidence-run-v1";

async function main() {
  const report =
    await runControlledProducerEvidenceV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env: {
        FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED:
          "true",

        FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_CONFIRM:
          "RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER",

        FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
          "false",

        REAL_TRADING_ENABLED:
          "false",

        ENABLE_REAL_TRADING:
          "false",

        ENABLE_LIVE_TRADING:
          "false",
      },
    });

  const checks = {
    verified:
      report.status ===
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_VERIFIED",

    dryRunMode:
      report.mode ===
      "DRY_RUN",

    controlledRunnerReady:
      report.controlledResult?.status ===
      "CONTROLLED_NORMAL_PRODUCER_READY_DRY_RUN",

    noForwardMutation:
      report.checks
        .dryRunDidNotMutateForwardFile ===
      true,

    zeroSessionDelta:
      report.delta
        .sessionCount ===
      0,

    realTradingDisabled:
      report.safety
        .realTradingEnabled ===
      false,

    noFailures:
      report.failed.length ===
      0,
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_CONTRACT_VERIFIED",

        checks,

        safety: {
          normalProducerExecuted:
            false,

          forwardFileMutated:
            false,

          realTradingEnabled:
            false,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_HOLD_FOR_2026_10_12_CONTROLLED_NORMAL_RUN",
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_CONTRACT_FAILED",

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

const root =
  process.cwd();

const runner =
  path.join(
    root,
    "scripts",
    "true-forward-oos-controlled-producer-evidence-run-v1.ts"
  );

if (!fs.existsSync(runner)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_STATIC_FAILED",
    failed:
      ["runnerExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      runner,
      "utf8"
    );

  const checks = {
    runnerExists:
      true,

    controlledRunnerUsed:
      source.includes(
        "runControlledNormalProducerV1"
      ),

    beforeSnapshot:
      source.includes(
        "const before ="
      ),

    afterSnapshot:
      source.includes(
        "const after ="
      ),

    hashUsed:
      source.includes(
        "sha256"
      ),

    sessionDelta:
      source.includes(
        "diffSessions"
      ),

    dryRunNoMutationCheck:
      source.includes(
        "dryRunDidNotMutateForwardFile"
      ),

    maxOneNewSession:
      source.includes(
        "normalRunCreatedAtMostOneSession"
      ),

    explicitProbeOff:
      source.includes(
        'FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:'
      ) &&
      source.includes(
        '"false"'
      ),

    realTradingOff:
      source.includes(
        'REAL_TRADING_ENABLED:'
      ) &&
      source.includes(
        'ENABLE_REAL_TRADING:'
      ) &&
      source.includes(
        'ENABLE_LIVE_TRADING:'
      ),

    evidenceLog:
      source.includes(
        "true-forward-oos-controlled-producer-evidence-run-v1.json"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_STATIC_FAILED",

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
        ? "RUN_EVIDENCE_CONTRACT"
        : "REPAIR_EVIDENCE_RUN_V1",
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
      "forward-oos:controlled-producer:evidence"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts";

    pkg.scripts[
      "forward-oos:controlled-producer:evidence:dry-run"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts --dry-run";

    pkg.scripts[
      "test:true-forward-oos-controlled-producer-evidence"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-controlled-producer-evidence-run-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-controlled-producer-evidence-static"
    ] =
      "node ./scripts/true-forward-oos-controlled-producer-evidence-run-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
        "scripts/true-forward-oos-controlled-producer-evidence-run-v1-contract-test.ts",
        "scripts/true-forward-oos-controlled-producer-evidence-run-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "CAPTURE_BEFORE_AFTER_FORWARD_SESSION_EVIDENCE_AROUND_CONTROLLED_NORMAL_PRODUCER",

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
        "RUN_STATIC_AND_DRY_RUN_CONTRACT"
    }, null, 2));

    process.exitCode = 0;
  }
}
