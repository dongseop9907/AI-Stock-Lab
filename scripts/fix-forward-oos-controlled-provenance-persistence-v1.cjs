const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const FILES = {
  producer:
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  controlled:
    "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
  evidence:
    "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  automation:
    "lib/research/run-true-forward-oos-automation-binding-v1.ts",
};

const STATIC =
  path.join(
    ROOT,
    "scripts",
    "forward-oos-controlled-provenance-persistence-v1-static-verify.cjs"
  );

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_PROVENANCE_PERSISTENCE_V1_FAILED",
        reason,
        ...extra,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

function readRequired(rel) {
  const abs =
    path.join(
      ROOT,
      rel
    );

  if (!fs.existsSync(abs)) {
    throw new Error(
      "REQUIRED_FILE_NOT_FOUND:" +
      rel
    );
  }

  return fs.readFileSync(
    abs,
    "utf8"
  );
}

function backup(rel) {
  const src =
    path.join(
      ROOT,
      rel
    );

  const backupDir =
    path.join(
      ROOT,
      "scripts",
      "backups"
    );

  fs.mkdirSync(
    backupDir,
    {
      recursive: true
    }
  );

  const safe =
    rel
      .replaceAll("/", "__")
      .replaceAll("\\", "__")
      .replace(
        /\.ts$/,
        ""
      );

  const dst =
    path.join(
      backupDir,
      safe +
      ".before-controlled-provenance-persistence-v1.ts"
    );

  if (!fs.existsSync(dst)) {
    fs.copyFileSync(
      src,
      dst
    );
  }

  return path
    .relative(
      ROOT,
      dst
    )
    .replaceAll("\\", "/");
}

function replaceOnce(
  text,
  from,
  to,
  label
) {
  if (text.includes(to)) {
    return text;
  }

  const count =
    text.split(from).length -
    1;

  if (count !== 1) {
    throw new Error(
      label +
      "_EXPECTED_ONCE_ACTUAL_" +
      count
    );
  }

  return text.replace(
    from,
    to
  );
}

let producer;
let controlled;
let evidence;
let automation;

try {
  producer =
    readRequired(
      FILES.producer
    );

  controlled =
    readRequired(
      FILES.controlled
    );

  evidence =
    readRequired(
      FILES.evidence
    );

  automation =
    readRequired(
      FILES.automation
    );
}
catch (error) {
  fail(
    "SOURCE_READ_FAILED",
    {
      error:
        String(
          error instanceof Error
            ? error.message
            : error
        )
    }
  );
  return;
}

const backups = [
  backup(FILES.producer),
  backup(FILES.controlled),
  backup(FILES.evidence),
  backup(FILES.automation),
];

try {
  if (
    !producer.includes(
      'import crypto from "node:crypto";'
    )
  ) {
    producer =
      replaceOnce(
        producer,
        'import fs from "node:fs";',
        'import fs from "node:fs";\nimport crypto from "node:crypto";',
        "PRODUCER_CRYPTO_IMPORT"
      );
  }

  if (
    !producer.includes(
      "FORWARD_OOS_CONTROLLED_PROVENANCE_V1"
    )
  ) {
    producer =
      replaceOnce(
        producer,
        'export const FROZEN_PREMIUM_CAP =\n  0.01;',
        `export const FROZEN_PREMIUM_CAP =
  0.01;

const CONTROLLED_PROVENANCE_SCHEMA_VERSION =
  "FORWARD_OOS_CONTROLLED_PROVENANCE_V1" as const;

const CANONICAL_SESSION_FILE =
  "logs/alpha-v3-true-forward-top1-sessions-v1.json";

const CONTROLLED_EVIDENCE_FILE =
  "logs/true-forward-oos-controlled-producer-evidence-run-v1.json";

function hashJson(
  value: unknown,
) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(value),
    )
    .digest("hex");
}

function controlledProvenance() {
  const rawMode =
    process.env
      .FORWARD_OOS_PROVENANCE_MODE;

  const mode =
    rawMode ===
      "CONTROLLED_NORMAL"
      ? "CONTROLLED_NORMAL"
      : "UNCONTROLLED";

  const runId =
    process.env
      .FORWARD_OOS_PROVENANCE_RUN_ID
      ?.trim() ||
    null;

  return {
    schemaVersion:
      CONTROLLED_PROVENANCE_SCHEMA_VERSION,

    mode,

    runId,

    evidenceFile:
      process.env
        .FORWARD_OOS_PROVENANCE_EVIDENCE_FILE
        ?.trim() ||
      CONTROLLED_EVIDENCE_FILE,

    canonicalSessionFile:
      CANONICAL_SESSION_FILE,

    producer:
      "alpha-v3-true-forward-top1-producer-v1",
  };
}`,
        "PRODUCER_PROVENANCE_HELPERS"
      );
  }

  if (
    !producer.includes(
      "const candidateFingerprint ="
    )
  ) {
    producer =
      replaceOnce(
        producer,
        `  const capturedAt =
    now.toISOString();

  const session = {`,
        `  const capturedAt =
    now.toISOString();

  const provenance =
    controlledProvenance();

  const candidateFingerprint =
    hashJson({
      sourceTradingDate,
      targetSessionDate,
      top1,
      top5:
        ranking.slice(
          0,
          5,
        ),
      frozenContract: {
        historicalCutoff:
          HISTORICAL_CUTOFF,
        entryScoreThreshold:
          FROZEN_ENTRY_THRESHOLD,
        selectedCap:
          FROZEN_PREMIUM_CAP,
        retuningAllowed:
          false,
      },
    });

  const integrityPayload = {
    version:
      TRUE_FORWARD_TOP1_VERSION,
    sourceTradingDate,
    targetSessionDate,
    capturedAt,
    candidateFingerprint,
    provenance,
  };

  const session = {`,
        "PRODUCER_SESSION_FINGERPRINT_INSERT"
      );
  }

  if (
    !producer.includes(
      `    provenance,

    candidateFingerprint,

    integrity: {`
    )
  ) {
    producer =
      replaceOnce(
        producer,
        `    capturedAt,

    sourceDataCutoffAtCollection:`,
        `    capturedAt,

    provenance,

    candidateFingerprint,

    integrity: {
      algorithm:
        "sha256",
      payloadHash:
        hashJson(
          integrityPayload,
        ),
    },

    sourceDataCutoffAtCollection:`,
        "PRODUCER_SESSION_PROVENANCE_FIELDS"
      );
  }

  if (
    !automation.includes(
      "env: NodeJS.ProcessEnv = process.env"
    )
  ) {
    automation =
      replaceOnce(
        automation,
        `function defaultRunStep(
  step: ForwardOosAutomationStep,
): Promise<{`,
        `function defaultRunStep(
  step: ForwardOosAutomationStep,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{`,
        "AUTOMATION_DEFAULT_RUN_STEP_ENV_PARAM"
      );
  }

  const defaultRunStepStart =
    automation.indexOf(
      "function defaultRunStep("
    );

  const newStateStart =
    automation.indexOf(
      "\nfunction newState(",
      defaultRunStepStart
    );

  if (
    defaultRunStepStart < 0 ||
    newStateStart < 0
  ) {
    throw new Error(
      "AUTOMATION_DEFAULT_RUN_STEP_BLOCK_NOT_FOUND"
    );
  }

  let defaultRunStepBlock =
    automation.slice(
      defaultRunStepStart,
      newStateStart
    );

  defaultRunStepBlock =
    defaultRunStepBlock
      .replace(
        "process.env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY",
        "env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY"
      )
      .replace(
        "...process.env,",
        "...env,"
      );

  automation =
    automation.slice(
      0,
      defaultRunStepStart
    ) +
    defaultRunStepBlock +
    automation.slice(
      newStateStart
    );

  if (
    !automation.includes(
      "defaultRunStep(\n        step,\n        env,"
    )
  ) {
    automation =
      replaceOnce(
        automation,
        `  const runStep =
    deps.runStep ??
    defaultRunStep;`,
        `  const runStep =
    deps.runStep ??
    (
      (step) =>
        defaultRunStep(
          step,
          env,
        )
    );`,
        "AUTOMATION_RUN_STEP_ENV_BINDING"
      );
  }

  if (
    !evidence.includes(
      "const evidenceRunId ="
    )
  ) {
    evidence =
      replaceOnce(
        evidence,
        `  const before =
    loadForwardSnapshot();

  const env = {`,
        `  const before =
    loadForwardSnapshot();

  const dryRun =
    input.dryRun === true;

  const evidenceRunId =
    dryRun
      ? null
      : crypto.randomUUID();

  const env = {`,
        "EVIDENCE_RUN_ID_INSERT"
      );
  }

  if (
    evidence.includes(
      `  const dryRun =
    input.dryRun === true;

  const checks = {`
    )
  ) {
    evidence =
      evidence.replace(
        `  const dryRun =
    input.dryRun === true;

  const checks = {`,
        `  const checks = {`
      );
  }

  if (
    !evidence.includes(
      "FORWARD_OOS_PROVENANCE_RUN_ID:"
    )
  ) {
    evidence =
      replaceOnce(
        evidence,
        `    FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
      "false",

    REAL_TRADING_ENABLED:`,
        `    FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
      "false",

    FORWARD_OOS_PROVENANCE_MODE:
      dryRun
        ? "DRY_RUN"
        : "CONTROLLED_NORMAL",

    FORWARD_OOS_PROVENANCE_RUN_ID:
      evidenceRunId ??
      "",

    FORWARD_OOS_PROVENANCE_EVIDENCE_FILE:
      "logs/true-forward-oos-controlled-producer-evidence-run-v1.json",

    REAL_TRADING_ENABLED:`,
        "EVIDENCE_PROVENANCE_ENV_INSERT"
      );
  }

  if (
    !evidence.includes(
      "newSessionsCarryEvidenceRunId:"
    )
  ) {
    evidence =
      replaceOnce(
        evidence,
        `    noDuplicateNewSessionKeys:
      new Set(
        newSessions.map(
          sessionKey,
        ),
      ).size ===
      newSessions.length,
  };`,
        `    noDuplicateNewSessionKeys:
      new Set(
        newSessions.map(
          sessionKey,
        ),
      ).size ===
      newSessions.length,

    newSessionsCarryEvidenceRunId:
      dryRun ||
      newSessions.every(
        row =>
          row?.provenance?.runId ===
          evidenceRunId,
      ),

    newSessionsCarryControlledMode:
      dryRun ||
      newSessions.every(
        row =>
          row?.provenance?.mode ===
          "CONTROLLED_NORMAL",
      ),

    newSessionsCarryFingerprintAndIntegrity:
      dryRun ||
      newSessions.every(
        row =>
          typeof row?.candidateFingerprint ===
            "string" &&
          row.candidateFingerprint.length >
            0 &&
          row?.integrity?.algorithm ===
            "sha256" &&
          typeof row?.integrity?.payloadHash ===
            "string" &&
          row.integrity.payloadHash.length >
            0,
      ),
  };`,
        "EVIDENCE_NEW_SESSION_PROVENANCE_CHECKS"
      );
  }

  if (
    !evidence.includes(
      `    evidenceRunId,

    controlledResult:`
    )
  ) {
    evidence =
      replaceOnce(
        evidence,
        `    mode:
      dryRun
        ? "DRY_RUN"
        : "CONTROLLED_NORMAL",

    controlledResult:`,
        `    mode:
      dryRun
        ? "DRY_RUN"
        : "CONTROLLED_NORMAL",

    evidenceRunId,

    controlledResult:`,
        "EVIDENCE_REPORT_RUN_ID"
      );
  }

  if (
    !evidence.includes(
      `            provenance:
              row?.provenance ??`
    )
  ) {
    evidence =
      replaceOnce(
        evidence,
        `            candidateCount:
              row?.candidateCount ??
              null,
          }),`,
        `            candidateCount:
              row?.candidateCount ??
              null,

            provenance:
              row?.provenance ??
              null,

            candidateFingerprint:
              row?.candidateFingerprint ??
              null,

            integrity:
              row?.integrity ??
              null,
          }),`,
        "EVIDENCE_DELTA_PROVENANCE_FIELDS"
      );
  }
}
catch (error) {
  fail(
    "SOURCE_PATCH_FAILED",
    {
      error:
        String(
          error instanceof Error
            ? error.message
            : error
        )
    }
  );
  return;
}

fs.writeFileSync(
  path.join(
    ROOT,
    FILES.producer
  ),
  producer,
  "utf8"
);

fs.writeFileSync(
  path.join(
    ROOT,
    FILES.controlled
  ),
  controlled,
  "utf8"
);

fs.writeFileSync(
  path.join(
    ROOT,
    FILES.evidence
  ),
  evidence,
  "utf8"
);

fs.writeFileSync(
  path.join(
    ROOT,
    FILES.automation
  ),
  automation,
  "utf8"
);

const STATIC_SOURCE =
  Buffer.from(
    "Y29uc3QgZnMgPSByZXF1aXJlKCJmcyIpOwpjb25zdCBwYXRoID0gcmVxdWlyZSgicGF0aCIpOwoKY29uc3QgUk9PVCA9IHByb2Nlc3MuY3dkKCk7Cgpjb25zdCBGSUxFUyA9IHsKICBwcm9kdWNlcjoKICAgICJzY3JpcHRzL2FscGhhLXYzLXRydWUtZm9yd2FyZC10b3AxLXByb2R1Y2VyLXYxLnRzIiwKICBjb250cm9sbGVkOgogICAgInNjcmlwdHMvdHJ1ZS1mb3J3YXJkLW9vcy1jb250cm9sbGVkLW5vcm1hbC1wcm9kdWNlci12MS50cyIsCiAgZXZpZGVuY2U6CiAgICAic2NyaXB0cy90cnVlLWZvcndhcmQtb29zLWNvbnRyb2xsZWQtcHJvZHVjZXItZXZpZGVuY2UtcnVuLXYxLnRzIiwKICBhdXRvbWF0aW9uOgogICAgImxpYi9yZXNlYXJjaC9ydW4tdHJ1ZS1mb3J3YXJkLW9vcy1hdXRvbWF0aW9uLWJpbmRpbmctdjEudHMiLAp9OwoKZnVuY3Rpb24gcmVhZChyZWwpIHsKICBjb25zdCBhYnMgPSBwYXRoLmpvaW4oUk9PVCwgcmVsKTsKCiAgcmV0dXJuIGZzLmV4aXN0c1N5bmMoYWJzKQogICAgPyBmcy5yZWFkRmlsZVN5bmMoYWJzLCAidXRmOCIpCiAgICA6ICIiOwp9Cgpjb25zdCBwcm9kdWNlciA9IHJlYWQoRklMRVMucHJvZHVjZXIpOwpjb25zdCBjb250cm9sbGVkID0gcmVhZChGSUxFUy5jb250cm9sbGVkKTsKY29uc3QgZXZpZGVuY2UgPSByZWFkKEZJTEVTLmV2aWRlbmNlKTsKY29uc3QgYXV0b21hdGlvbiA9IHJlYWQoRklMRVMuYXV0b21hdGlvbik7Cgpjb25zdCBjaGVja3MgPSB7CiAgcHJvZHVjZXJFeGlzdHM6CiAgICBCb29sZWFuKHByb2R1Y2VyKSwKICBjb250cm9sbGVkUHJvZHVjZXJFeGlzdHM6CiAgICBCb29sZWFuKGNvbnRyb2xsZWQpLAogIGV2aWRlbmNlV3JhcHBlckV4aXN0czoKICAgIEJvb2xlYW4oZXZpZGVuY2UpLAogIGF1dG9tYXRpb25CaW5kaW5nRXhpc3RzOgogICAgQm9vbGVhbihhdXRvbWF0aW9uKSwKCiAgcHJvZHVjZXJIYXNDcnlwdG86CiAgICBwcm9kdWNlci5pbmNsdWRlcygKICAgICAgJ2ltcG9ydCBjcnlwdG8gZnJvbSAibm9kZTpjcnlwdG8iOycKICAgICksCgogIHByb2R1Y2VySGFzUHJvdmVuYW5jZVNjaGVtYToKICAgIHByb2R1Y2VyLmluY2x1ZGVzKAogICAgICAiRk9SV0FSRF9PT1NfQ09OVFJPTExFRF9QUk9WRU5BTkNFX1YxIgogICAgKSwKCiAgcHJvZHVjZXJIYXNDb250cm9sbGVkTW9kZToKICAgIHByb2R1Y2VyLmluY2x1ZGVzKAogICAgICAiRk9SV0FSRF9PT1NfUFJPVkVOQU5DRV9NT0RFIgogICAgKSwKCiAgcHJvZHVjZXJIYXNSdW5JZDoKICAgIHByb2R1Y2VyLmluY2x1ZGVzKAogICAgICAiRk9SV0FSRF9PT1NfUFJPVkVOQU5DRV9SVU5fSUQiCiAgICApLAoKICBwcm9kdWNlckhhc0NhbmRpZGF0ZUZpbmdlcnByaW50OgogICAgcHJvZHVjZXIuaW5jbHVkZXMoCiAgICAgICJjYW5kaWRhdGVGaW5nZXJwcmludCIKICAgICksCgogIHByb2R1Y2VySGFzSW50ZWdyaXR5SGFzaDoKICAgIHByb2R1Y2VyLmluY2x1ZGVzKAogICAgICAicGF5bG9hZEhhc2giCiAgICApICYmCiAgICAvYWxnb3JpdGhtOlxzKltcclxuIF0qInNoYTI1NiIvLnRlc3QoCiAgICAgIHByb2R1Y2VyCiAgICApLAoKICBjYW5vbmljYWxTZXNzaW9uRmlsZVByZXNlcnZlZDoKICAgIHByb2R1Y2VyLmluY2x1ZGVzKAogICAgICAiYWxwaGEtdjMtdHJ1ZS1mb3J3YXJkLXRvcDEtc2Vzc2lvbnMtdjEuanNvbiIKICAgICksCgogIGV2aWRlbmNlR2VuZXJhdGVzUnVuSWQ6CiAgICBldmlkZW5jZS5pbmNsdWRlcygKICAgICAgImNyeXB0by5yYW5kb21VVUlEKCkiCiAgICApLAoKICBldmlkZW5jZVBhc3Nlc0NvbnRyb2xsZWRNb2RlOgogICAgZXZpZGVuY2UuaW5jbHVkZXMoCiAgICAgICdGT1JXQVJEX09PU19QUk9WRU5BTkNFX01PREU6JwogICAgKSAmJgogICAgZXZpZGVuY2UuaW5jbHVkZXMoCiAgICAgICciQ09OVFJPTExFRF9OT1JNQUwiJwogICAgKSwKCiAgZXZpZGVuY2VQYXNzZXNSdW5JZDoKICAgIGV2aWRlbmNlLmluY2x1ZGVzKAogICAgICAiRk9SV0FSRF9PT1NfUFJPVkVOQU5DRV9SVU5fSUQ6IgogICAgKSwKCiAgZXZpZGVuY2VSZXBvcnRTdG9yZXNSdW5JZDoKICAgIGV2aWRlbmNlLmluY2x1ZGVzKAogICAgICAiZXZpZGVuY2VSdW5JZCwiCiAgICApLAoKICBldmlkZW5jZUNoZWNrc1Nlc3Npb25SdW5JZDoKICAgIGV2aWRlbmNlLmluY2x1ZGVzKAogICAgICAibmV3U2Vzc2lvbnNDYXJyeUV2aWRlbmNlUnVuSWQiCiAgICApLAoKICBldmlkZW5jZUNoZWNrc0NvbnRyb2xsZWRNb2RlOgogICAgZXZpZGVuY2UuaW5jbHVkZXMoCiAgICAgICJuZXdTZXNzaW9uc0NhcnJ5Q29udHJvbGxlZE1vZGUiCiAgICApLAoKICBhdXRvbWF0aW9uRGVmYXVsdFJ1blN0ZXBBY2NlcHRzRW52OgogICAgYXV0b21hdGlvbi5pbmNsdWRlcygKICAgICAgImVudjogTm9kZUpTLlByb2Nlc3NFbnYgPSBwcm9jZXNzLmVudiIKICAgICksCgogIGF1dG9tYXRpb25DaGlsZFVzZXNQcm92aWRlZEVudjoKICAgIGF1dG9tYXRpb24uaW5jbHVkZXMoCiAgICAgICIuLi5lbnYsIgogICAgKSAmJgogICAgYXV0b21hdGlvbi5pbmNsdWRlcygKICAgICAgImRlZmF1bHRSdW5TdGVwKCIKICAgICksCgogIGNvbnRyb2xsZWRQcm9kdWNlclN0aWxsRm9yY2VzUmVhbFRyYWRpbmdPZmY6CiAgICBjb250cm9sbGVkLmluY2x1ZGVzKAogICAgICAnUkVBTF9UUkFESU5HX0VOQUJMRUQ6XG4gICAgICAgICAgICAiZmFsc2UiJwogICAgKSAmJgogICAgY29udHJvbGxlZC5pbmNsdWRlcygKICAgICAgJ0VOQUJMRV9SRUFMX1RSQURJTkc6XG4gICAgICAgICAgICAiZmFsc2UiJwogICAgKSAmJgogICAgY29udHJvbGxlZC5pbmNsdWRlcygKICAgICAgJ0VOQUJMRV9MSVZFX1RSQURJTkc6XG4gICAgICAgICAgICAiZmFsc2UiJwogICAgKSwKCiAgbm9UcmFkaW5nRW5hYmxlSW50cm9kdWNlZDoKICAgICFwcm9kdWNlci5pbmNsdWRlcygKICAgICAgJ1JFQUxfVFJBRElOR19FTkFCTEVEID0gInRydWUiJwogICAgKSAmJgogICAgIWV2aWRlbmNlLmluY2x1ZGVzKAogICAgICAnUkVBTF9UUkFESU5HX0VOQUJMRUQ6ICJ0cnVlIicKICAgICksCgogIG5vT3JkZXJNdXRhdGlvbkFkZGVkVG9Qcm9kdWNlcjoKICAgICFwcm9kdWNlci5pbmNsdWRlcygKICAgICAgImNyZWF0ZVBhcGVyQnV5T3JkZXIoIgogICAgKSAmJgogICAgIXByb2R1Y2VyLmluY2x1ZGVzKAogICAgICAiZXhlY3V0ZVBhcGVyQnV5T3JkZXIoIgogICAgKSwKfTsKCmNvbnN0IGZhaWxlZCA9CiAgT2JqZWN0LmVudHJpZXMoY2hlY2tzKQogICAgLmZpbHRlcigoWywgdmFsdWVdKSA9PiB2YWx1ZSAhPT0gdHJ1ZSkKICAgIC5tYXAoKFtrZXldKSA9PiBrZXkpOwoKY29uc29sZS5sb2coCiAgSlNPTi5zdHJpbmdpZnkoCiAgICB7CiAgICAgIHN0YXR1czoKICAgICAgICBmYWlsZWQubGVuZ3RoID09PSAwCiAgICAgICAgICA/ICJBSV9TVE9DS19MQUJfRk9SV0FSRF9PT1NfQ09OVFJPTExFRF9QUk9WRU5BTkNFX1BFUlNJU1RFTkNFX1YxX1NUQVRJQ19WRVJJRklFRCIKICAgICAgICAgIDogIkFJX1NUT0NLX0xBQl9GT1JXQVJEX09PU19DT05UUk9MTEVEX1BST1ZFTkFOQ0VfUEVSU0lTVEVOQ0VfVjFfU1RBVElDX0ZBSUxFRCIsCgogICAgICBjaGVja3MsCgogICAgICBjb250cmFjdDogewogICAgICAgIHNjaGVtYVZlcnNpb246CiAgICAgICAgICAiRk9SV0FSRF9PT1NfQ09OVFJPTExFRF9QUk9WRU5BTkNFX1YxIiwKCiAgICAgICAgc2Vzc2lvbkZpZWxkczogWwogICAgICAgICAgInByb3ZlbmFuY2UubW9kZSIsCiAgICAgICAgICAicHJvdmVuYW5jZS5ydW5JZCIsCiAgICAgICAgICAicHJvdmVuYW5jZS5ldmlkZW5jZUZpbGUiLAogICAgICAgICAgInByb3ZlbmFuY2UuY2Fub25pY2FsU2Vzc2lvbkZpbGUiLAogICAgICAgICAgImNhbmRpZGF0ZUZpbmdlcnByaW50IiwKICAgICAgICAgICJpbnRlZ3JpdHkuYWxnb3JpdGhtIiwKICAgICAgICAgICJpbnRlZ3JpdHkucGF5bG9hZEhhc2giCiAgICAgICAgXSwKCiAgICAgICAgY29udHJvbGxlZE1vZGU6CiAgICAgICAgICAiQ09OVFJPTExFRF9OT1JNQUwiLAoKICAgICAgICBldmlkZW5jZUpvaW5LZXk6CiAgICAgICAgICAiZXZpZGVuY2VSdW5JZCA8LT4gc2Vzc2lvbi5wcm92ZW5hbmNlLnJ1bklkIiwKCiAgICAgICAgY2Fub25pY2FsU2Vzc2lvbkZpbGU6CiAgICAgICAgICAibG9ncy9hbHBoYS12My10cnVlLWZvcndhcmQtdG9wMS1zZXNzaW9ucy12MS5qc29uIgogICAgICB9LAoKICAgICAgc2FmZXR5OiB7CiAgICAgICAgc291cmNlT25seToKICAgICAgICAgIHRydWUsCiAgICAgICAgcHJvZHVjZXJFeGVjdXRlZDoKICAgICAgICAgIGZhbHNlLAogICAgICAgIGNvbGxlY3RvckV4ZWN1dGVkOgogICAgICAgICAgZmFsc2UsCiAgICAgICAgZGF0YWJhc2VSZWFkczoKICAgICAgICAgIDAsCiAgICAgICAgZGF0YWJhc2VXcml0ZXM6CiAgICAgICAgICAwLAogICAgICAgIG9yZGVyc0NyZWF0ZWQ6CiAgICAgICAgICAwLAogICAgICAgIHBvc2l0aW9uc0NoYW5nZWQ6CiAgICAgICAgICAwLAogICAgICAgIHByb21vdGlvbkV4ZWN1dGVkOgogICAgICAgICAgZmFsc2UsCiAgICAgICAgcmVhbFRyYWRpbmdFbmFibGVkOgogICAgICAgICAgZmFsc2UKICAgICAgfSwKCiAgICAgIGZhaWxlZCwKCiAgICAgIG5leHRHYXRlOgogICAgICAgIGZhaWxlZC5sZW5ndGggPT09IDAKICAgICAgICAgID8gIlJVTl9GT1JXQVJEX1BJUEVMSU5FX1RZUEVDSEVDS19EQVNIQk9BUkRfQ09OVFJBQ1RfQVBQX1RTQ19CVUlMRCIKICAgICAgICAgIDogIlJFUEFJUl9DT05UUk9MTEVEX1BST1ZFTkFOQ0VfUEVSU0lTVEVOQ0UiCiAgICB9LAogICAgbnVsbCwKICAgIDIKICApCik7Cgpwcm9jZXNzLmV4aXRDb2RlID0KICBmYWlsZWQubGVuZ3RoID09PSAwCiAgICA/IDAKICAgIDogMTsK",
    "base64"
  ).toString(
    "utf8"
  );

fs.writeFileSync(
  STATIC,
  STATIC_SOURCE,
  "utf8"
);

const checks = {
  producerHasProvenance:
    producer.includes(
      "FORWARD_OOS_CONTROLLED_PROVENANCE_V1"
    ) &&
    producer.includes(
      "candidateFingerprint"
    ) &&
    producer.includes(
      "payloadHash"
    ),

  evidenceHasRunId:
    evidence.includes(
      "crypto.randomUUID()"
    ) &&
    evidence.includes(
      "evidenceRunId,"
    ),

  evidenceValidatesNewSession:
    evidence.includes(
      "newSessionsCarryEvidenceRunId"
    ) &&
    evidence.includes(
      "newSessionsCarryControlledMode"
    ) &&
    evidence.includes(
      "newSessionsCarryFingerprintAndIntegrity"
    ),

  automationPropagatesDepsEnv:
    automation.includes(
      "env: NodeJS.ProcessEnv = process.env"
    ) &&
    automation.includes(
      "...env,"
    ) &&
    automation.includes(
      "defaultRunStep(\n          step,\n          env,"
    ),

  controlledProducerPreserved:
    controlled.includes(
      "CONTROLLED_NORMAL_PRODUCER_CONFIRM"
    ) &&
    controlled.includes(
      'REAL_TRADING_ENABLED:\n            "false"'
    ),

  canonicalSessionPathPreserved:
    producer.includes(
      "alpha-v3-true-forward-top1-sessions-v1.json"
    ),
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

if (
  failed.length > 0
) {
  fail(
    "POST_REPAIR_CHECK_FAILED",
    {
      checks,
      failed
    }
  );
  return;
}

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_PROVENANCE_PERSISTENCE_V1_REPAIRED",

      changedFiles: [
        FILES.producer,
        FILES.evidence,
        FILES.automation
      ],

      inspectedUnchangedFile:
        FILES.controlled,

      generatedFile:
        "scripts/forward-oos-controlled-provenance-persistence-v1-static-verify.cjs",

      backups,

      contract: {
        schemaVersion:
          "FORWARD_OOS_CONTROLLED_PROVENANCE_V1",

        controlledMode:
          "CONTROLLED_NORMAL",

        evidenceJoin:
          "evidenceRunId <-> session.provenance.runId",

        candidateFingerprint:
          "sha256",

        sessionIntegrity:
          "sha256",

        canonicalSessionFile:
          "logs/alpha-v3-true-forward-top1-sessions-v1.json"
      },

      checks,

      safety: {
        runtimeExecution:
          false,
        producerExecuted:
          false,
        collectorExecuted:
          false,
        databaseReads:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        promotionExecuted:
          false,
        realTradingEnabled:
          false
      },

      failed: [],

      nextAction:
        "RUN_STATIC_FORWARD_PIPELINE_TSC_DASHBOARD_CONTRACT_APP_TSC_BUILD"
    },
    null,
    2
  )
);

process.exitCode = 0;
