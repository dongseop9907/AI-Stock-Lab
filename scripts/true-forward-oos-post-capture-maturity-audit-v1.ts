import fs from "node:fs";
import path from "node:path";

import { nextKrxTradingDate } from "../lib/trading/krx-trading-calendar";

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

function addKrxTradingSessions(
  date: string,
  sessions: number,
) {
  if (
    !Number.isInteger(
      sessions,
    ) ||
    sessions < 0
  ) {
    throw new Error(
      "INVALID_KRX_MATURITY_SESSION_COUNT",
    );
  }

  let cursor =
    date;

  for (
    let i = 0;
    i < sessions;
    i += 1
  ) {
    cursor =
      nextKrxTradingDate(
        cursor,
      );
  }

  return cursor;
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

function loadSessionsFromDisk(): {
  file: string | null;
  sessions: ForwardSessionLike[];
} {
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
      /^\d{4}-\d{2}-\d{2}$/.test(
        sourceTradingDate,
      ),

    targetSessionDatePresent:
      /^\d{4}-\d{2}-\d{2}$/.test(
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
          ? addKrxTradingSessions(
              target,
              1,
            )
          : null,

      "3D":
        target
          ? addKrxTradingSessions(
              target,
              3,
            )
          : null,

      "5D":
        target
          ? addKrxTradingSessions(
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
