const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "forward-oos-session-provenance-integrity-probe-v1.ts"
  );

const source = String.raw`import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  isKrxTradingDate,
} from "../lib/trading/krx-trading-calendar";

const ROOT =
  process.cwd();

const PLANNED_FIRST_REAL_SESSION_DATE =
  "2026-10-12";

const DASHBOARD_CANDIDATES = [
  "logs/alpha-v3-true-forward-oos.json",
  "logs/alpha-v3-true-forward-oos-v1.json",
  "logs/alpha-v3-true-forward-top1-sessions-v1.json",
  "logs/alpha-v3-forward-top1-sessions.json",
] as const;

const READINESS_CANDIDATES = [
  "logs/alpha-v3-true-forward-oos-sessions.json",
  "logs/alpha-v3-entry-v3-forward-oos-sessions.json",
  "logs/alpha-v3-true-forward-top1-sessions.json",
  "logs/true-forward-oos-sessions.json",
] as const;

const EVIDENCE_WRAPPER_CANDIDATES = [
  "logs/alpha-v3-true-forward-oos.json",
  "logs/alpha-v3-true-forward-oos-v1.json",
  "logs/alpha-v3-true-forward-top1-sessions-v1.json",
] as const;

const PRODUCER_EVIDENCE =
  "logs/true-forward-oos-controlled-producer-evidence-run-v1.json";

type JsonRecord =
  Record<string, unknown>;

function sha256(
  text: string,
) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

function rel(
  absolute: string,
) {
  return path
    .relative(
      ROOT,
      absolute,
    )
    .replaceAll(
      "\\",
      "/",
    );
}

function safeJson(
  text: string,
): unknown {
  try {
    return JSON.parse(
      text,
    );
  } catch {
    return null;
  }
}

function asRecord(
  value: unknown,
): JsonRecord | null {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as JsonRecord;
  }

  return null;
}

function stringOrNull(
  value: unknown,
) {
  return typeof value ===
    "string"
    ? value
    : null;
}

function numberOrNull(
  value: unknown,
) {
  return typeof value ===
    "number" &&
    Number.isFinite(value)
    ? value
    : null;
}

function loadFile(
  relative: string,
) {
  const absolute =
    path.join(
      ROOT,
      relative,
    );

  if (
    !fs.existsSync(
      absolute,
    )
  ) {
    return {
      exists: false,
      relative,
      absolute,
      text: null,
      parsed: null,
      hash: null,
      size: null,
      mtime: null,
    };
  }

  const text =
    fs.readFileSync(
      absolute,
      "utf8",
    );

  const stat =
    fs.statSync(
      absolute,
    );

  return {
    exists: true,
    relative,
    absolute,
    text,
    parsed:
      safeJson(text),
    hash:
      sha256(text),
    size:
      stat.size,
    mtime:
      stat.mtime.toISOString(),
  };
}

function sessionsFrom(
  parsed: unknown,
): unknown[] {
  if (
    Array.isArray(
      parsed,
    )
  ) {
    return parsed;
  }

  const record =
    asRecord(
      parsed,
    );

  if (
    record &&
    Array.isArray(
      record.sessions,
    )
  ) {
    return record.sessions;
  }

  return [];
}

function selectFirstExisting(
  candidates:
    readonly string[],
) {
  for (
    const candidate of
    candidates
  ) {
    const loaded =
      loadFile(
        candidate,
      );

    if (
      loaded.exists
    ) {
      return loaded;
    }
  }

  return null;
}

function scanAdditionalForwardSessionFiles() {
  const logs =
    path.join(
      ROOT,
      "logs",
    );

  if (
    !fs.existsSync(
      logs,
    )
  ) {
    return [];
  }

  return fs
    .readdirSync(
      logs,
      {
        withFileTypes:
          true,
      },
    )
    .filter(
      entry =>
        entry.isFile(),
    )
    .map(
      entry =>
        entry.name,
    )
    .filter(
      name => {
        const lower =
          name.toLowerCase();

        return (
          lower.endsWith(
            ".json",
          ) &&
          lower.includes(
            "forward",
          ) &&
          lower.includes(
            "session",
          )
        );
      },
    )
    .sort()
    .map(
      name =>
        loadFile(
          "logs/" +
          name,
        ),
    );
}

function nestedString(
  row: JsonRecord,
  paths:
    string[][],
) {
  for (
    const parts of paths
  ) {
    let current:
      unknown =
      row;

    for (
      const part of
      parts
    ) {
      const rec =
        asRecord(
          current,
        );

      if (
        !rec
      ) {
        current =
          null;

        break;
      }

      current =
        rec[
          part
        ];
    }

    if (
      typeof current ===
      "string" &&
      current.trim()
    ) {
      return current;
    }
  }

  return null;
}

function stockCodeOf(
  row: JsonRecord,
) {
  return nestedString(
    row,
    [
      ["stockCode"],
      ["stock_code"],
      ["top1", "stockCode"],
      ["top1", "stock_code"],
      ["candidate", "stockCode"],
      ["candidate", "stock_code"],
    ],
  );
}

function collectProvenanceStrings(
  value: unknown,
  depth = 0,
  prefix = "",
): Array<{
  key: string;
  value: string;
}> {
  if (
    depth >
    3
  ) {
    return [];
  }

  const record =
    asRecord(
      value,
    );

  if (
    !record
  ) {
    return [];
  }

  const output:
    Array<{
      key: string;
      value: string;
    }> =
    [];

  for (
    const [
      key,
      raw
    ] of
    Object.entries(
      record,
    )
  ) {
    const full =
      prefix
        ? prefix +
          "." +
          key
        : key;

    const lower =
      key.toLowerCase();

    if (
      typeof raw ===
        "string" &&
      (
        lower.includes(
          "mode",
        ) ||
        lower.includes(
          "status",
        ) ||
        lower.includes(
          "source",
        ) ||
        lower.includes(
          "provenance",
        ) ||
        lower.includes(
          "origin",
        ) ||
        lower.includes(
          "reason",
        ) ||
        lower.includes(
          "kind",
        ) ||
        lower.includes(
          "type",
        )
      )
    ) {
      output.push({
        key:
          full,

        value:
          raw,
      });
    }

    if (
      raw &&
      typeof raw ===
        "object" &&
      !Array.isArray(
        raw,
      )
    ) {
      output.push(
        ...collectProvenanceStrings(
          raw,
          depth + 1,
          full,
        ),
      );
    }
  }

  return output;
}

function evidenceDeltaSessions(
  evidence: unknown,
) {
  const root =
    asRecord(
      evidence,
    );

  const delta =
    asRecord(
      root
        ?.delta,
    );

  return Array.isArray(
    delta
      ?.newSessions,
  )
    ? delta
        ?.newSessions as unknown[]
    : [];
}

function evidenceMode(
  evidence: unknown,
) {
  const root =
    asRecord(
      evidence,
    );

  return stringOrNull(
    root
      ?.mode,
  );
}

function evidenceDeltaCount(
  evidence: unknown,
) {
  const root =
    asRecord(
      evidence,
    );

  const delta =
    asRecord(
      root
        ?.delta,
    );

  return numberOrNull(
    delta
      ?.sessionCount,
  );
}

function evidenceControlledExecuted(
  evidence: unknown,
) {
  const root =
    asRecord(
      evidence,
    );

  const controlled =
    asRecord(
      root
        ?.controlledResult,
    );

  return (
    controlled
      ?.executed ===
      true &&
    stringOrNull(
      controlled
        ?.status,
    ) ===
      "CONTROLLED_NORMAL_PRODUCER_EXECUTED"
  );
}

function keyOf(
  source:
    string | null,
  target:
    string | null,
) {
  return [
    source ??
      "",
    target ??
      "",
  ].join("|");
}

function evidenceMatch(
  source:
    string | null,
  target:
    string | null,
  evidence: unknown,
) {
  const wanted =
    keyOf(
      source,
      target,
    );

  return evidenceDeltaSessions(
    evidence,
  ).some(
    raw => {
      const row =
        asRecord(
          raw,
        );

      if (
        !row
      ) {
        return false;
      }

      return (
        keyOf(
          stringOrNull(
            row
              .sourceTradingDate,
          ),
          stringOrNull(
            row
              .targetSessionDate,
          ),
        ) ===
        wanted
      );
    },
  );
}

function containsSuspiciousMarker(
  values:
    Array<{
      key: string;
      value: string;
    }>,
) {
  const text =
    values
      .map(
        item =>
          item.value,
      )
      .join(
        " ",
      )
      .toLowerCase();

  return [
    "test",
    "synthetic",
    "mock",
    "fixture",
    "probe",
    "dry_run",
    "dry-run",
    "historical replay",
    "historical_replay",
  ].some(
    marker =>
      text.includes(
        marker,
      ),
  );
}

function classify(
  input: {
    source:
      string | null;
    target:
      string | null;
    capturedAt:
      string | null;
    provenance:
      Array<{
        key: string;
        value: string;
      }>;
    evidence:
      unknown;
  },
) {
  const mode =
    evidenceMode(
      input.evidence,
    );

  const matched =
    evidenceMatch(
      input.source,
      input.target,
      input.evidence,
    );

  const deltaCount =
    evidenceDeltaCount(
      input.evidence,
    );

  const controlledExecuted =
    evidenceControlledExecuted(
      input.evidence,
    );

  if (
    containsSuspiciousMarker(
      input.provenance,
    ) ||
    (
      mode ===
        "DRY_RUN" &&
      matched
    )
  ) {
    return {
      classification:
        "TEST_OR_SYNTHETIC",

      shouldCountTowardRealForwardEvidence:
        false,

      reason:
        "Session carries test/synthetic/probe/dry-run provenance or matches dry-run producer evidence.",
    };
  }

  if (
    mode ===
      "CONTROLLED_NORMAL" &&
    matched &&
    deltaCount !==
      null &&
    deltaCount >
      0 &&
    controlledExecuted
  ) {
    return {
      classification:
        "REAL_CONTROLLED",

      shouldCountTowardRealForwardEvidence:
        true,

      reason:
        "Session exactly matches controlled-normal producer evidence with a positive session delta.",
    };
  }

  if (
    input.target &&
    input.target <
      PLANNED_FIRST_REAL_SESSION_DATE
  ) {
    return {
      classification:
        "STALE_OR_HISTORICAL",

      shouldCountTowardRealForwardEvidence:
        false,

      reason:
        "Target session predates the planned first real controlled Forward OOS session.",
    };
  }

  if (
    input.target ===
      PLANNED_FIRST_REAL_SESSION_DATE &&
    !matched
  ) {
    return {
      classification:
        "INCONCLUSIVE",

      shouldCountTowardRealForwardEvidence:
        null,

      reason:
        "Session targets the planned first real date but has no matching controlled-normal producer evidence.",
    };
  }

  return {
    classification:
      "INCONCLUSIVE",

    shouldCountTowardRealForwardEvidence:
      null,

    reason:
      "Available file/session metadata is insufficient to prove real controlled provenance.",
  };
}

function analyzeSession(
  raw: unknown,
  index: number,
  sourceFile: string,
  evidence: unknown,
) {
  const row =
    asRecord(
      raw,
    ) ??
    {};

  const sourceTradingDate =
    stringOrNull(
      row
        .sourceTradingDate,
    );

  const targetSessionDate =
    stringOrNull(
      row
        .targetSessionDate,
    );

  const capturedAt =
    stringOrNull(
      row
        .capturedAt,
    );

  const stockCode =
    stockCodeOf(
      row,
    );

  const sourceKrxValid =
    sourceTradingDate
      ? isKrxTradingDate(
          sourceTradingDate,
        )
      : false;

  const targetKrxValid =
    targetSessionDate
      ? isKrxTradingDate(
          targetSessionDate,
        )
      : false;

  const chronological =
    Boolean(
      sourceTradingDate &&
      targetSessionDate &&
      targetSessionDate >
        sourceTradingDate,
    );

  const provenance =
    collectProvenanceStrings(
      row,
    );

  const classification =
    classify({
      source:
        sourceTradingDate,

      target:
        targetSessionDate,

      capturedAt,

      provenance,

      evidence,
    });

  return {
    index,
    sourceFile,

    key:
      [
        sourceTradingDate ??
          "",
        targetSessionDate ??
          "",
        stockCode ??
          "",
      ].join("|"),

    sourceTradingDate,
    targetSessionDate,
    stockCode,
    capturedAt,

    krx: {
      sourceTradingDateValid:
        sourceKrxValid,

      targetSessionDateValid:
        targetKrxValid,

      chronological,
    },

    sessionHash:
      sha256(
        JSON.stringify(
          row,
        ),
      ),

    provenance,

    producerEvidenceMatch:
      evidenceMatch(
        sourceTradingDate,
        targetSessionDate,
        evidence,
      ),

    ...classification,

    raw:
      row,
  };
}

function fileSummary(
  loaded:
    ReturnType<
      typeof loadFile
    >,
) {
  const sessions =
    sessionsFrom(
      loaded.parsed,
    );

  return {
    file:
      loaded.relative,

    exists:
      loaded.exists,

    mtime:
      loaded.mtime,

    size:
      loaded.size,

    hash:
      loaded.hash,

    sessionCount:
      sessions.length,
  };
}

function main() {
  const dashboardSelected =
    selectFirstExisting(
      DASHBOARD_CANDIDATES,
    );

  const readinessSelected =
    selectFirstExisting(
      READINESS_CANDIDATES,
    );

  const evidenceWrapperSelected =
    selectFirstExisting(
      EVIDENCE_WRAPPER_CANDIDATES,
    );

  const evidenceFile =
    loadFile(
      PRODUCER_EVIDENCE,
    );

  const dashboardSessions =
    dashboardSelected
      ? sessionsFrom(
          dashboardSelected
            .parsed,
        )
      : [];

  const analyzed =
    dashboardSessions.map(
      (
        row,
        index,
      ) =>
        analyzeSession(
          row,
          index,
          dashboardSelected
            ?.relative ??
            "",
          evidenceFile
            .parsed,
        ),
    );

  const classificationCounts =
    analyzed.reduce(
      (
        acc,
        row,
      ) => {
        acc[
          row.classification
        ] =
          (
            acc[
              row.classification
            ] ??
            0
          ) +
          1;

        return acc;
      },
      {} as
        Record<
          string,
          number
        >,
    );

  const realCount =
    analyzed.filter(
      row =>
        row
          .shouldCountTowardRealForwardEvidence ===
        true,
    ).length;

  const inconclusiveCount =
    analyzed.filter(
      row =>
        row
          .shouldCountTowardRealForwardEvidence ===
        null,
    ).length;

  const dashboardAndReadinessMismatch =
    (
      dashboardSelected
        ?.relative ??
      null
    ) !==
    (
      readinessSelected
        ?.relative ??
      null
    );

  const report = {
    status:
      "AI_STOCK_LAB_FORWARD_OOS_SESSION_PROVENANCE_INTEGRITY_PROBE_V1_COMPLETE",

    plannedFirstRealSessionDate:
      PLANNED_FIRST_REAL_SESSION_DATE,

    selection: {
      dashboard: {
        candidates:
          DASHBOARD_CANDIDATES,

        selected:
          dashboardSelected
            ? fileSummary(
                dashboardSelected,
              )
            : null,
      },

      firstRealSessionReadiness: {
        candidates:
          READINESS_CANDIDATES,

        selected:
          readinessSelected
            ? fileSummary(
                readinessSelected,
              )
            : null,
      },

      controlledEvidenceWrapper: {
        candidates:
          EVIDENCE_WRAPPER_CANDIDATES,

        selected:
          evidenceWrapperSelected
            ? fileSummary(
                evidenceWrapperSelected,
              )
            : null,
      },

      dashboardAndReadinessSelectedDifferentFiles:
        dashboardAndReadinessMismatch,
    },

    producerEvidence: {
      file:
        PRODUCER_EVIDENCE,

      exists:
        evidenceFile
          .exists,

      mtime:
        evidenceFile
          .mtime,

      hash:
        evidenceFile
          .hash,

      mode:
        evidenceMode(
          evidenceFile
            .parsed,
        ),

      deltaSessionCount:
        evidenceDeltaCount(
          evidenceFile
            .parsed,
        ),

      controlledNormalExecuted:
        evidenceControlledExecuted(
          evidenceFile
            .parsed,
        ),

      newSessions:
        evidenceDeltaSessions(
          evidenceFile
            .parsed,
        ),
    },

    dashboardSessions: {
      count:
        analyzed.length,

      classificationCounts,

      countableRealEvidence:
        realCount,

      inconclusive:
        inconclusiveCount,

      rows:
        analyzed,
    },

    otherForwardSessionFiles:
      scanAdditionalForwardSessionFiles()
        .map(
          file =>
            fileSummary(
              file,
            ),
        ),

    integrity: {
      allDashboardSessionsHaveValidKrxDates:
        analyzed.every(
          row =>
            row.krx
              .sourceTradingDateValid &&
            row.krx
              .targetSessionDateValid,
        ),

      allDashboardSessionsChronological:
        analyzed.every(
          row =>
            row.krx
              .chronological,
        ),

      noDuplicateDashboardSessionKeys:
        new Set(
          analyzed.map(
            row =>
              row.key,
          ),
        ).size ===
        analyzed.length,

      provenanceFullyResolved:
        analyzed.every(
          row =>
            row.classification !==
            "INCONCLUSIVE",
        ),

      safeToCountCurrentDashboardSessionsAsRealEvidence:
        analyzed.length >
          0 &&
        analyzed.every(
          row =>
            row
              .shouldCountTowardRealForwardEvidence ===
            true,
        ),
    },

    interpretation: {
      dashboardSessionCount:
        analyzed.length,

      provenRealControlledCount:
        realCount,

      action:
        analyzed.length ===
          0
          ? "NO_SESSION_TO_CLASSIFY"
          : (
              realCount ===
                analyzed.length
                ? "CURRENT_DASHBOARD_SESSIONS_CAN_COUNT_AS_REAL_FORWARD_EVIDENCE"
                : (
                    inconclusiveCount >
                      0
                      ? "DO_NOT_COUNT_INCONCLUSIVE_SESSION_AS_REAL_EVIDENCE_UNTIL_PROVEN"
                      : "EXCLUDE_NON_REAL_SESSION_FROM_REAL_FORWARD_EVIDENCE"
                  )
            ),

      firstRealSessionProtection:
        "Do not create, delete, mutate, promote, or synthesize any session from this probe.",
    },

    safety: {
      readOnly:
        true,

      filesWritten:
        0,

      networkRequests:
        0,

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
        false,
    },

    nextGate:
      "REVIEW_SESSION_PROVENANCE_BEFORE_2026_10_12_CONTROLLED_ONE_SHOT",
  };

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode = 0;
}

main();
`;

fs.writeFileSync(
  TARGET,
  source,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_FORWARD_OOS_SESSION_PROVENANCE_INTEGRITY_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/forward-oos-session-provenance-integrity-probe-v1.ts",

      probe: {
        dashboardCandidatePrecedence:
          true,

        readinessCandidatePrecedence:
          true,

        controlledEvidenceCandidatePrecedence:
          true,

        fileHashAndMtime:
          true,

        rawSessionInspection:
          true,

        krxValidity:
          true,

        producerEvidenceMatching:
          true,

        classification: [
          "REAL_CONTROLLED",
          "TEST_OR_SYNTHETIC",
          "STALE_OR_HISTORICAL",
          "INCONCLUSIVE"
        ],

        mutation:
          "NONE"
      },

      safety: {
        probeExecution:
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

      nextAction:
        "RUN_READ_ONLY_PROVENANCE_PROBE"
    },
    null,
    2
  )
);

process.exitCode = 0;
