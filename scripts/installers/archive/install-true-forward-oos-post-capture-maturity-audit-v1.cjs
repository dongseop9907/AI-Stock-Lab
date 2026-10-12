const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const AUDIT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(PACKAGE)) {
  fail("PACKAGE_JSON_NOT_FOUND");
} else {
  const auditSource = `import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

export type Horizon =
  | "1D"
  | "3D"
  | "5D";

export interface ForwardSessionLike {
  sourceTradingDate?: string | null;
  targetSessionDate?: string | null;
  capturedAt?: string | null;
  candidateCount?: number | null;
  candidates?: unknown[];
  outcomes?: Record<string, unknown> | null;
}

export interface AuditInput {
  now?: Date;
  sessions?: ForwardSessionLike[];
}

const FORWARD_FILES = [
  "logs/alpha-v3-true-forward-oos.json",
  "logs/alpha-v3-true-forward-oos-v1.json",
  "logs/alpha-v3-true-forward-top1-sessions-v1.json",
];

function addCalendarDays(
  date: string,
  days: number,
) {
  const d =
    new Date(
      date + "T00:00:00.000Z",
    );

  d.setUTCDate(
    d.getUTCDate() + days,
  );

  return d
    .toISOString()
    .slice(0, 10);
}

function firstExistingForwardFile() {
  for (
    const rel of FORWARD_FILES
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

function loadSessionsFromDisk() {
  const file =
    firstExistingForwardFile();

  if (!file) {
    return {
      file: null,
      sessions: [] as ForwardSessionLike[],
    };
  }

  let parsed: any;

  try {
    parsed =
      JSON.parse(
        fs.readFileSync(
          file.abs,
          "utf8",
        ),
      );
  } catch {
    parsed = null;
  }

  return {
    file:
      file.rel,

    sessions:
      Array.isArray(
        parsed?.sessions,
      )
        ? parsed.sessions
        : [],
  };
}

export function buildSessionIntegrity(
  session: ForwardSessionLike,
) {
  const sourceTradingDate =
    String(
      session.sourceTradingDate ??
      "",
    );

  const targetSessionDate =
    String(
      session.targetSessionDate ??
      "",
    );

  const capturedAt =
    String(
      session.capturedAt ??
      "",
    );

  const candidateCount =
    Number(
      session.candidateCount ??
      (
        Array.isArray(
          session.candidates,
        )
          ? session.candidates.length
          : 0
      ),
    );

  const checks = {
    sourceTradingDatePresent:
      /^\\d{4}-\\d{2}-\\d{2}$/.test(
        sourceTradingDate,
      ),

    targetSessionDatePresent:
      /^\\d{4}-\\d{2}-\\d{2}$/.test(
        targetSessionDate,
      ),

    targetAfterSource:
      sourceTradingDate.length === 10 &&
      targetSessionDate.length === 10 &&
      targetSessionDate >
        sourceTradingDate,

    capturedAtPresent:
      capturedAt.length > 0,

    candidateCountNonNegative:
      Number.isFinite(
        candidateCount,
      ) &&
      candidateCount >= 0,
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

  return {
    sourceTradingDate,
    targetSessionDate,
    capturedAt,
    candidateCount,
    checks,
    failed,
    valid:
      failed.length === 0,
  };
}

export function buildMaturitySchedule(
  session: ForwardSessionLike,
  now: Date,
) {
  const target =
    String(
      session.targetSessionDate ??
      "",
    );

  const today =
    new Date(
      now.getTime() +
      9 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);

  const maturityDates:
    Record<Horizon, string | null> = {
      "1D":
        target
          ? addCalendarDays(
              target,
              1,
            )
          : null,

      "3D":
        target
          ? addCalendarDays(
              target,
              3,
            )
          : null,

      "5D":
        target
          ? addCalendarDays(
              target,
              5,
            )
          : null,
    };

  const ready:
    Record<Horizon, boolean> = {
      "1D":
        Boolean(
          maturityDates["1D"] &&
          today >=
            maturityDates["1D"]!,
        ),

      "3D":
        Boolean(
          maturityDates["3D"] &&
          today >=
            maturityDates["3D"]!,
        ),

      "5D":
        Boolean(
          maturityDates["5D"] &&
          today >=
            maturityDates["5D"]!,
        ),
    };

  return {
    todayKst:
      today,

    targetSessionDate:
      target || null,

    maturityDates,

    ready,
  };
}

export function auditForwardSessions(
  input: AuditInput = {},
) {
  const now =
    input.now ??
    new Date();

  const disk =
    input.sessions
      ? {
          file: null,
          sessions:
            input.sessions,
        }
      : loadSessionsFromDisk();

  const sessions =
    disk.sessions;

  const audited =
    sessions.map(
      (session, index) => {
        const integrity =
          buildSessionIntegrity(
            session,
          );

        const maturity =
          buildMaturitySchedule(
            session,
            now,
          );

        return {
          index,
          integrity,
          maturity,
        };
      },
    );

  const validSessions =
    audited.filter(
      row =>
        row.integrity.valid,
    );

  const invalidSessions =
    audited.filter(
      row =>
        !row.integrity.valid,
    );

  const maturityCounts = {
    "1D":
      validSessions.filter(
        row =>
          row.maturity.ready["1D"],
      ).length,

    "3D":
      validSessions.filter(
        row =>
          row.maturity.ready["3D"],
      ).length,

    "5D":
      validSessions.filter(
        row =>
          row.maturity.ready["5D"],
      ).length,
  };

  const status =
    sessions.length === 0
      ? "WAITING_FOR_FORWARD_SESSION"
      : invalidSessions.length > 0
        ? "FORWARD_SESSION_INTEGRITY_FAILED"
        : "FORWARD_SESSION_INTEGRITY_VERIFIED";

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1",

    auditStatus:
      status,

    sourceFile:
      disk.file,

    counts: {
      sessions:
        sessions.length,

      valid:
        validSessions.length,

      invalid:
        invalidSessions.length,

      maturityReady:
        maturityCounts,
    },

    sessions:
      audited,

    safety: {
      readOnly:
        true,

      databaseReads:
        0,

      databaseWrites:
        0,

      fileWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    nextGate:
      sessions.length === 0
        ? "WAIT_FOR_CONTROLLED_NORMAL_PRODUCER_SESSION"
        : invalidSessions.length > 0
          ? "REPAIR_FORWARD_SESSION_INTEGRITY"
          : maturityCounts["1D"] > 0
            ? "RUN_1D_OUTCOME_COLLECTION_FOR_MATURE_SESSIONS"
            : "WAIT_FOR_1D_MATURITY",
  };
}

async function main() {
  const report =
    auditForwardSessions();

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    report.auditStatus ===
      "FORWARD_SESSION_INTEGRITY_FAILED"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-post-capture-maturity-audit-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_ERROR",

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
  auditForwardSessions,
} from "./true-forward-oos-post-capture-maturity-audit-v1";

function main() {
  const waiting =
    auditForwardSessions({
      now:
        new Date(
          "2026-10-12T00:00:00.000Z",
        ),

      sessions:
        [],
    });

  const valid =
    auditForwardSessions({
      now:
        new Date(
          "2026-10-16T00:00:00.000Z",
        ),

      sessions: [
        {
          sourceTradingDate:
            "2026-10-08",

          targetSessionDate:
            "2026-10-12",

          capturedAt:
            "2026-10-08T23:50:00.000Z",

          candidateCount:
            1,
        },
      ],
    });

  const invalid =
    auditForwardSessions({
      now:
        new Date(
          "2026-10-16T00:00:00.000Z",
        ),

      sessions: [
        {
          sourceTradingDate:
            "2026-10-12",

          targetSessionDate:
            "2026-10-12",

          capturedAt:
            "",

          candidateCount:
            -1,
        },
      ],
    });

  const checks = {
    waitingStatus:
      waiting.auditStatus ===
      "WAITING_FOR_FORWARD_SESSION",

    waitingExitSafe:
      waiting.nextGate ===
      "WAIT_FOR_CONTROLLED_NORMAL_PRODUCER_SESSION",

    validIntegrity:
      valid.auditStatus ===
      "FORWARD_SESSION_INTEGRITY_VERIFIED",

    validCount:
      valid.counts.valid ===
      1,

    oneDayMature:
      valid.counts.maturityReady["1D"] ===
      1,

    threeDayMature:
      valid.counts.maturityReady["3D"] ===
      1,

    fiveDayNotYetMature:
      valid.counts.maturityReady["5D"] ===
      0,

    invalidRejected:
      invalid.auditStatus ===
      "FORWARD_SESSION_INTEGRITY_FAILED",

    readOnly:
      valid.safety.readOnly ===
      true,

    noTradingSideEffects:
      valid.safety.ordersCreated ===
        0 &&
      valid.safety.positionsChanged ===
        0 &&
      valid.safety.realTradingEnabled ===
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.auditStatus,

          valid:
            valid.counts,

          invalid:
            invalid.counts,
        },

        safety: {
          syntheticOnly:
            true,

          databaseReads:
            0,

          databaseWrites:
            0,

          fileWrites:
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
          "STATIC_VERIFY_THEN_RUN_READ_ONLY_CURRENT_FORWARD_SESSION_AUDIT",
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_CONTRACT_FAILED",

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
}
`;

  const staticSource = `const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_STATIC_FAILED",

    failed:
      ["auditExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    auditExists:
      true,

    readOnlyDiskSurface:
      source.includes(
        "readFileSync"
      ) &&
      !source.includes(
        "writeFileSync"
      ),

    forwardSessionIntegrity:
      source.includes(
        "buildSessionIntegrity"
      ),

    maturitySchedule:
      source.includes(
        "buildMaturitySchedule"
      ),

    horizonsPresent:
      source.includes(
        '"1D"'
      ) &&
      source.includes(
        '"3D"'
      ) &&
      source.includes(
        '"5D"'
      ),

    waitingGate:
      source.includes(
        "WAIT_FOR_CONTROLLED_NORMAL_PRODUCER_SESSION"
      ),

    oneDayGate:
      source.includes(
        "RUN_1D_OUTCOME_COLLECTION_FOR_MATURE_SESSIONS"
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source
      ),

    noRealTradingEnable:
      !/(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\\s*[:=]\\s*["']true["']/i.test(
        source
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      producerExecuted:
        false,

      collectorExecuted:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_POST_CAPTURE_MATURITY_CONTRACT"
        : "REPAIR_POST_CAPTURE_MATURITY_AUDIT_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

  fs.writeFileSync(
    AUDIT,
    auditSource,
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
      "forward-oos:post-capture-audit"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-post-capture-maturity-audit-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-post-capture-audit"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-post-capture-maturity-audit-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-post-capture-audit-static"
    ] =
      "node ./scripts/true-forward-oos-post-capture-maturity-audit-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
        "scripts/true-forward-oos-post-capture-maturity-audit-v1-contract-test.ts",
        "scripts/true-forward-oos-post-capture-maturity-audit-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "VERIFY_FORWARD_SESSION_INTEGRITY_AND_1D_3D_5D_MATURITY_READINESS",

      safety: {
        readOnlyAudit:
          true,

        normalProducerExecuted:
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

        realTradingEnabled:
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_READ_ONLY_AUDIT"
    }, null, 2));

    process.exitCode = 0;
  }
}
