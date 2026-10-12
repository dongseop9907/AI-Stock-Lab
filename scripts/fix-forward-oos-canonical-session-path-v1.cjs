const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const CANONICAL =
  "alpha-v3-true-forward-top1-sessions-v1.json";

const CANONICAL_WITH_LOGS =
  "logs/alpha-v3-true-forward-top1-sessions-v1.json";

const LEGACY =
  "alpha-v3-forward-top1-sessions.json";

const LEGACY_WITH_LOGS =
  "logs/alpha-v3-forward-top1-sessions.json";

const READINESS_OLD =
  "logs/alpha-v3-true-forward-top1-sessions.json";

const FILES = {
  producer:
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  collector:
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  summary:
    "scripts/alpha-v3-true-forward-oos-summary.ts",
  readiness:
    "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
};

const STATIC =
  path.join(
    ROOT,
    "scripts",
    "forward-oos-canonical-session-path-v1-static-verify.cjs"
  );

const PIPELINE_TSCONFIG =
  path.join(
    ROOT,
    "tsconfig.forward-oos-canonical-pipeline.json"
  );

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_FORWARD_OOS_CANONICAL_SESSION_PATH_V1_FAILED",
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
      recursive:
        true
    }
  );

  const name =
    path.basename(rel)
      .replace(
        /\.ts$/,
        ""
      ) +
    ".before-forward-oos-canonical-session-path-v1.ts";

  const dst =
    path.join(
      backupDir,
      name
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
    .replaceAll(
      "\\",
      "/"
    );
}

function replaceAllExact(
  text,
  from,
  to
) {
  if (
    text.includes(from)
  ) {
    return text
      .split(from)
      .join(to);
  }

  return text;
}

let producer;
let collector;
let summary;
let readiness;

try {
  producer =
    readRequired(
      FILES.producer
    );

  collector =
    readRequired(
      FILES.collector
    );

  summary =
    readRequired(
      FILES.summary
    );

  readiness =
    readRequired(
      FILES.readiness
    );
}
catch (error) {
  fail(
    "REQUIRED_SOURCE_READ_FAILED",
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
  backup(FILES.collector),
  backup(FILES.summary),
  backup(FILES.readiness),
];

producer =
  replaceAllExact(
    producer,
    LEGACY_WITH_LOGS,
    CANONICAL_WITH_LOGS
  );

producer =
  replaceAllExact(
    producer,
    LEGACY,
    CANONICAL
  );

collector =
  replaceAllExact(
    collector,
    LEGACY_WITH_LOGS,
    CANONICAL_WITH_LOGS
  );

collector =
  replaceAllExact(
    collector,
    LEGACY,
    CANONICAL
  );

summary =
  replaceAllExact(
    summary,
    LEGACY_WITH_LOGS,
    CANONICAL_WITH_LOGS
  );

summary =
  replaceAllExact(
    summary,
    LEGACY,
    CANONICAL
  );

readiness =
  replaceAllExact(
    readiness,
    READINESS_OLD,
    CANONICAL_WITH_LOGS
  );

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
    FILES.collector
  ),
  collector,
  "utf8"
);

fs.writeFileSync(
  path.join(
    ROOT,
    FILES.summary
  ),
  summary,
  "utf8"
);

fs.writeFileSync(
  path.join(
    ROOT,
    FILES.readiness
  ),
  readiness,
  "utf8"
);

const pipelineConfig = {
  extends:
    "./tsconfig.forward-oos-operational.json",

  compilerOptions: {
    noEmit:
      true
  },

  include: [
    "next-env.d.ts",
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
    "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
    "scripts/alpha-v3-true-forward-oos-summary.ts",
    "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
    "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
    "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
    "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
    "scripts/forward-oos-data-quality-integrity-monitor-v1.ts",
    "lib/research/run-true-forward-oos-automation-binding-v1.ts"
  ],

  exclude: [
    "node_modules",
    "scripts/backups/**"
  ]
};

fs.writeFileSync(
  PIPELINE_TSCONFIG,
  JSON.stringify(
    pipelineConfig,
    null,
    2
  ) + "\n",
  "utf8"
);

const staticSource =
  Buffer.from(
    "Y29uc3QgZnMgPSByZXF1aXJlKCJmcyIpOwpjb25zdCBwYXRoID0gcmVxdWlyZSgicGF0aCIpOwoKY29uc3QgUk9PVCA9IHByb2Nlc3MuY3dkKCk7Cgpjb25zdCBDQU5PTklDQUwgPQogICJhbHBoYS12My10cnVlLWZvcndhcmQtdG9wMS1zZXNzaW9ucy12MS5qc29uIjsKCmNvbnN0IENBTk9OSUNBTF9XSVRIX0xPR1MgPQogICJsb2dzL2FscGhhLXYzLXRydWUtZm9yd2FyZC10b3AxLXNlc3Npb25zLXYxLmpzb24iOwoKY29uc3QgTEVHQUNZID0KICAiYWxwaGEtdjMtZm9yd2FyZC10b3AxLXNlc3Npb25zLmpzb24iOwoKY29uc3QgUkVBRElORVNTX09MRCA9CiAgImxvZ3MvYWxwaGEtdjMtdHJ1ZS1mb3J3YXJkLXRvcDEtc2Vzc2lvbnMuanNvbiI7Cgpjb25zdCBGSUxFUyA9IHsKICBwcm9kdWNlcjoKICAgICJzY3JpcHRzL2FscGhhLXYzLXRydWUtZm9yd2FyZC10b3AxLXByb2R1Y2VyLXYxLnRzIiwKICBjb2xsZWN0b3I6CiAgICAic2NyaXB0cy9hbHBoYS12My10cnVlLWVudHJ5LWZvcndhcmQtb29zLWNvbGxlY3Rvci12MS50cyIsCiAgc3VtbWFyeToKICAgICJzY3JpcHRzL2FscGhhLXYzLXRydWUtZm9yd2FyZC1vb3Mtc3VtbWFyeS50cyIsCiAgcmVhZGluZXNzOgogICAgInNjcmlwdHMvdHJ1ZS1mb3J3YXJkLW9vcy1maXJzdC1yZWFsLXNlc3Npb24tcmVhZGluZXNzLXYxLnRzIiwKICBldmlkZW5jZToKICAgICJzY3JpcHRzL3RydWUtZm9yd2FyZC1vb3MtY29udHJvbGxlZC1wcm9kdWNlci1ldmlkZW5jZS1ydW4tdjEudHMiLAogIG1hdHVyaXR5QXVkaXQ6CiAgICAic2NyaXB0cy90cnVlLWZvcndhcmQtb29zLXBvc3QtY2FwdHVyZS1tYXR1cml0eS1hdWRpdC12MS50cyIsCiAgZGFzaGJvYXJkOgogICAgImxpYi9yZXNlYXJjaC9nZXQtZm9yd2FyZC1vb3Mtb2JzZXJ2YWJpbGl0eS1kYXNoYm9hcmQtdjEudHMiLAp9OwoKZnVuY3Rpb24gcmVhZChyZWwpIHsKICBjb25zdCBhYnMgPSBwYXRoLmpvaW4oUk9PVCwgcmVsKTsKCiAgaWYgKCFmcy5leGlzdHNTeW5jKGFicykpIHsKICAgIHJldHVybiBudWxsOwogIH0KCiAgcmV0dXJuIGZzLnJlYWRGaWxlU3luYyhhYnMsICJ1dGY4Iik7Cn0KCmNvbnN0IHNvdXJjZSA9IE9iamVjdC5mcm9tRW50cmllcygKICBPYmplY3QuZW50cmllcyhGSUxFUykubWFwKAogICAgKFtrZXksIHJlbF0pID0+IFsKICAgICAga2V5LAogICAgICByZWFkKHJlbCksCiAgICBdLAogICksCik7Cgpjb25zdCBjaGVja3MgPSB7CiAgcHJvZHVjZXJFeGlzdHM6CiAgICBCb29sZWFuKHNvdXJjZS5wcm9kdWNlciksCiAgY29sbGVjdG9yRXhpc3RzOgogICAgQm9vbGVhbihzb3VyY2UuY29sbGVjdG9yKSwKICBzdW1tYXJ5RXhpc3RzOgogICAgQm9vbGVhbihzb3VyY2Uuc3VtbWFyeSksCiAgcmVhZGluZXNzRXhpc3RzOgogICAgQm9vbGVhbihzb3VyY2UucmVhZGluZXNzKSwKICBldmlkZW5jZUV4aXN0czoKICAgIEJvb2xlYW4oc291cmNlLmV2aWRlbmNlKSwKICBtYXR1cml0eUF1ZGl0RXhpc3RzOgogICAgQm9vbGVhbihzb3VyY2UubWF0dXJpdHlBdWRpdCksCiAgZGFzaGJvYXJkRXhpc3RzOgogICAgQm9vbGVhbihzb3VyY2UuZGFzaGJvYXJkKSwKCiAgcHJvZHVjZXJVc2VzQ2Fub25pY2FsOgogICAgQm9vbGVhbihzb3VyY2UucHJvZHVjZXIpICYmCiAgICBzb3VyY2UucHJvZHVjZXIuaW5jbHVkZXMoQ0FOT05JQ0FMKSwKICBjb2xsZWN0b3JVc2VzQ2Fub25pY2FsOgogICAgQm9vbGVhbihzb3VyY2UuY29sbGVjdG9yKSAmJgogICAgc291cmNlLmNvbGxlY3Rvci5pbmNsdWRlcyhDQU5PTklDQUwpLAogIHN1bW1hcnlVc2VzQ2Fub25pY2FsOgogICAgQm9vbGVhbihzb3VyY2Uuc3VtbWFyeSkgJiYKICAgIHNvdXJjZS5zdW1tYXJ5LmluY2x1ZGVzKENBTk9OSUNBTCksCiAgcmVhZGluZXNzVXNlc0Nhbm9uaWNhbDoKICAgIEJvb2xlYW4oc291cmNlLnJlYWRpbmVzcykgJiYKICAgIHNvdXJjZS5yZWFkaW5lc3MuaW5jbHVkZXMoQ0FOT05JQ0FMX1dJVEhfTE9HUyksCiAgZXZpZGVuY2VVc2VzQ2Fub25pY2FsOgogICAgQm9vbGVhbihzb3VyY2UuZXZpZGVuY2UpICYmCiAgICBzb3VyY2UuZXZpZGVuY2UuaW5jbHVkZXMoQ0FOT05JQ0FMX1dJVEhfTE9HUyksCiAgbWF0dXJpdHlBdWRpdFVzZXNDYW5vbmljYWw6CiAgICBCb29sZWFuKHNvdXJjZS5tYXR1cml0eUF1ZGl0KSAmJgogICAgc291cmNlLm1hdHVyaXR5QXVkaXQuaW5jbHVkZXMoQ0FOT05JQ0FMX1dJVEhfTE9HUyksCiAgZGFzaGJvYXJkVXNlc0Nhbm9uaWNhbDoKICAgIEJvb2xlYW4oc291cmNlLmRhc2hib2FyZCkgJiYKICAgIHNvdXJjZS5kYXNoYm9hcmQuaW5jbHVkZXMoQ0FOT05JQ0FMKSwKCiAgcHJvZHVjZXJMZWdhY3lFeGNsdWRlZDoKICAgIEJvb2xlYW4oc291cmNlLnByb2R1Y2VyKSAmJgogICAgIXNvdXJjZS5wcm9kdWNlci5pbmNsdWRlcyhMRUdBQ1kpLAogIGNvbGxlY3RvckxlZ2FjeUV4Y2x1ZGVkOgogICAgQm9vbGVhbihzb3VyY2UuY29sbGVjdG9yKSAmJgogICAgIXNvdXJjZS5jb2xsZWN0b3IuaW5jbHVkZXMoTEVHQUNZKSwKICBzdW1tYXJ5TGVnYWN5RXhjbHVkZWQ6CiAgICBCb29sZWFuKHNvdXJjZS5zdW1tYXJ5KSAmJgogICAgIXNvdXJjZS5zdW1tYXJ5LmluY2x1ZGVzKExFR0FDWSksCiAgcmVhZGluZXNzT2xkQ2FuZGlkYXRlRXhjbHVkZWQ6CiAgICBCb29sZWFuKHNvdXJjZS5yZWFkaW5lc3MpICYmCiAgICAhc291cmNlLnJlYWRpbmVzcy5pbmNsdWRlcyhSRUFESU5FU1NfT0xEKSwKCiAgcHJvZHVjZXJWZXJzaW9uTWF0Y2hlc0Nhbm9uaWNhbDoKICAgIEJvb2xlYW4oc291cmNlLnByb2R1Y2VyKSAmJgogICAgc291cmNlLnByb2R1Y2VyLmluY2x1ZGVzKAogICAgICAnQUxQSEFfVjNfVFJVRV9GT1JXQVJEX1RPUDFfU0VTU0lPTlNfVjEnCiAgICApLAoKICBkYXNoYm9hcmRTdGlsbFJlYWRPbmx5OgogICAgQm9vbGVhbihzb3VyY2UuZGFzaGJvYXJkKSAmJgogICAgIXNvdXJjZS5kYXNoYm9hcmQuaW5jbHVkZXMoIndyaXRlRmlsZVN5bmMoIikgJiYKICAgICFzb3VyY2UuZGFzaGJvYXJkLmluY2x1ZGVzKCIuaW5zZXJ0KCIpICYmCiAgICAhc291cmNlLmRhc2hib2FyZC5pbmNsdWRlcygiLnVwc2VydCgiKSAmJgogICAgIXNvdXJjZS5kYXNoYm9hcmQuaW5jbHVkZXMoIi51cGRhdGUoIikgJiYKICAgICFzb3VyY2UuZGFzaGJvYXJkLmluY2x1ZGVzKCIuZGVsZXRlKCIpLAp9OwoKY29uc3QgZmFpbGVkID0KICBPYmplY3QuZW50cmllcyhjaGVja3MpCiAgICAuZmlsdGVyKChbLCB2YWx1ZV0pID0+IHZhbHVlICE9PSB0cnVlKQogICAgLm1hcCgoW2tleV0pID0+IGtleSk7Cgpjb25zb2xlLmxvZygKICBKU09OLnN0cmluZ2lmeSgKICAgIHsKICAgICAgc3RhdHVzOgogICAgICAgIGZhaWxlZC5sZW5ndGggPT09IDAKICAgICAgICAgID8gIkFJX1NUT0NLX0xBQl9GT1JXQVJEX09PU19DQU5PTklDQUxfU0VTU0lPTl9QQVRIX1YxX1NUQVRJQ19WRVJJRklFRCIKICAgICAgICAgIDogIkFJX1NUT0NLX0xBQl9GT1JXQVJEX09PU19DQU5PTklDQUxfU0VTU0lPTl9QQVRIX1YxX1NUQVRJQ19GQUlMRUQiLAoKICAgICAgY2Fub25pY2FsU2Vzc2lvbkZpbGU6CiAgICAgICAgQ0FOT05JQ0FMX1dJVEhfTE9HUywKCiAgICAgIGNoZWNrcywKCiAgICAgIHBvbGljeTogewogICAgICAgIGN1cnJlbnRUcnVlRm9yd2FyZFBpcGVsaW5lOgogICAgICAgICAgIkNBTk9OSUNBTF9DT05UUk9MTEVEX1NFU1NJT05fRklMRV9PTkxZIiwKCiAgICAgICAgbGVnYWN5UGlwZWxpbmVQcmVzZXJ2ZWQ6CiAgICAgICAgICB0cnVlLAoKICAgICAgICBsZWdhY3lTZXNzaW9uRmlsZURlbGV0ZWQ6CiAgICAgICAgICBmYWxzZSwKCiAgICAgICAgcHJvZHVjZXJDb2xsZWN0b3JTdW1tYXJ5QWxpZ25lZDoKICAgICAgICAgIHRydWUsCgogICAgICAgIHJlYWRpbmVzc0V2aWRlbmNlQXVkaXREYXNoYm9hcmRBbGlnbmVkOgogICAgICAgICAgZmFpbGVkLmxlbmd0aCA9PT0gMCwKICAgICAgfSwKCiAgICAgIHNhZmV0eTogewogICAgICAgIHNvdXJjZU9ubHk6CiAgICAgICAgICB0cnVlLAogICAgICAgIGRhdGFiYXNlUmVhZHM6CiAgICAgICAgICAwLAogICAgICAgIGRhdGFiYXNlV3JpdGVzOgogICAgICAgICAgMCwKICAgICAgICBvcmRlcnNDcmVhdGVkOgogICAgICAgICAgMCwKICAgICAgICBwb3NpdGlvbnNDaGFuZ2VkOgogICAgICAgICAgMCwKICAgICAgICBwcm9tb3Rpb25FeGVjdXRlZDoKICAgICAgICAgIGZhbHNlLAogICAgICAgIHJlYWxUcmFkaW5nRW5hYmxlZDoKICAgICAgICAgIGZhbHNlLAogICAgICB9LAoKICAgICAgZmFpbGVkLAoKICAgICAgbmV4dEdhdGU6CiAgICAgICAgZmFpbGVkLmxlbmd0aCA9PT0gMAogICAgICAgICAgPyAiUlVOX0ZPUldBUkRfT09TX0NBTk9OSUNBTF9QSVBFTElORV9UWVBFQ0hFQ0tfQU5EX0RBU0hCT0FSRF9DT05UUkFDVCIKICAgICAgICAgIDogIlJFUEFJUl9DQU5PTklDQUxfU0VTU0lPTl9QQVRIIiwKICAgIH0sCiAgICBudWxsLAogICAgMiwKICApLAopOwoKcHJvY2Vzcy5leGl0Q29kZSA9CiAgZmFpbGVkLmxlbmd0aCA9PT0gMAogICAgPyAwCiAgICA6IDE7Cg==",
    "base64"
  ).toString(
    "utf8"
  );

fs.writeFileSync(
  STATIC,
  staticSource,
  "utf8"
);

const checks = {
  producerCanonical:
    producer.includes(
      CANONICAL
    ),

  producerLegacyExcluded:
    !producer.includes(
      LEGACY
    ),

  collectorCanonical:
    collector.includes(
      CANONICAL
    ),

  collectorLegacyExcluded:
    !collector.includes(
      LEGACY
    ),

  summaryCanonical:
    summary.includes(
      CANONICAL
    ),

  summaryLegacyExcluded:
    !summary.includes(
      LEGACY
    ),

  readinessCanonical:
    readiness.includes(
      CANONICAL_WITH_LOGS
    ),

  readinessOldCandidateExcluded:
    !readiness.includes(
      READINESS_OLD
    ),

  pipelineTsconfigGenerated:
    fs.existsSync(
      PIPELINE_TSCONFIG
    ),

  producerVersionPreserved:
    producer.includes(
      "ALPHA_V3_TRUE_FORWARD_TOP1_SESSIONS_V1"
    )
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
        "AI_STOCK_LAB_FORWARD_OOS_CANONICAL_SESSION_PATH_V1_REPAIRED",

      canonicalSessionFile:
        CANONICAL_WITH_LOGS,

      changedFiles: [
        FILES.producer,
        FILES.collector,
        FILES.summary,
        FILES.readiness
      ],

      generatedFiles: [
        "scripts/forward-oos-canonical-session-path-v1-static-verify.cjs",
        "tsconfig.forward-oos-canonical-pipeline.json"
      ],

      backups,

      repair: {
        producerOutput:
          CANONICAL_WITH_LOGS,

        collectorInput:
          CANONICAL_WITH_LOGS,

        summaryInput:
          CANONICAL_WITH_LOGS,

        readinessCandidate:
          CANONICAL_WITH_LOGS,

        controlledEvidenceWrapperAlreadyCompatible:
          true,

        postCaptureMaturityAuditAlreadyCompatible:
          true,

        dashboardAlreadyCompatibleAfterControlledFilterV2:
          true,

        oldLegacyPipelineFilesChanged:
          false,

        legacySessionFileDeleted:
          false,

        alphaLogicChanged:
          false,

        rankingLogicChanged:
          false,

        thresholdsChanged:
          false
      },

      checks,

      safety: {
        runtimeExecution:
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
        "RUN_STATIC_PIPELINE_TYPECHECK_DASHBOARD_CONTRACT_APP_TSC_BUILD"
    },
    null,
    2
  )
);

process.exitCode = 0;
