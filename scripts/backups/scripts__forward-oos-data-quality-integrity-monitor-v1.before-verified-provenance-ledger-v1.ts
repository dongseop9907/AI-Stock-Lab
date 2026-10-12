import fs from "node:fs";
import path from "node:path";

import {
  isKrxTradingDate,
} from "../lib/trading/krx-trading-calendar";

const ROOT = process.cwd();

const SESSION_FILES = [
  "logs/alpha-v3-true-forward-oos.json",
  "logs/alpha-v3-true-forward-oos-v1.json",
  "logs/alpha-v3-true-forward-top1-sessions-v1.json",
] as const;

const OBSERVATIONS_FILE =
  "logs/alpha-v3-entry-v3-forward-oos-observations.json";

const EVALUATOR_FILE =
  "logs/alpha-v3-entry-v3-forward-shadow-oos.json";

const SUMMARY_FILE =
  "logs/alpha-v3-true-forward-oos-summary.json";

const PRODUCER_EVIDENCE_FILE =
  "logs/true-forward-oos-controlled-producer-evidence-run-v1.json";

type JsonRecord =
  Record<string, unknown>;

function asRecord(
  value: unknown,
): JsonRecord | null {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as JsonRecord
    : null;
}

function str(
  value: unknown,
) {
  return typeof value === "string"
    ? value
    : null;
}

function num(
  value: unknown,
) {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  )
    ? value
    : null;
}

function readJson(
  rel: string,
) {
  const file =
    path.join(
      ROOT,
      rel,
    );

  if (
    !fs.existsSync(file)
  ) {
    return {
      exists: false,
      file: rel,
      parsed: null as unknown,
      mtime: null as string | null,
    };
  }

  const text =
    fs.readFileSync(
      file,
      "utf8",
    );

  const stat =
    fs.statSync(file);

  let parsed: unknown =
    null;

  try {
    parsed =
      JSON.parse(text);
  }
  catch {
    parsed =
      null;
  }

  return {
    exists: true,
    file: rel,
    parsed,
    mtime:
      stat.mtime.toISOString(),
  };
}

function firstExisting(
  candidates:
    readonly string[],
) {
  for (
    const candidate of
    candidates
  ) {
    const loaded =
      readJson(candidate);

    if (loaded.exists) {
      return loaded;
    }
  }

  return null;
}

function rowsFrom(
  parsed: unknown,
  preferredKeys:
    readonly string[],
) {
  if (
    Array.isArray(parsed)
  ) {
    return parsed;
  }

  const record =
    asRecord(parsed);

  if (!record) {
    return [];
  }

  for (
    const key of
    preferredKeys
  ) {
    if (
      Array.isArray(
        record[key],
      )
    ) {
      return record[key] as unknown[];
    }
  }

  return [];
}

function stockCodeOf(
  row: JsonRecord,
) {
  const top1 =
    asRecord(
      row.top1,
    );

  return (
    str(
      row.stockCode,
    ) ??
    str(
      row.stock_code,
    ) ??
    str(
      top1?.stockCode,
    ) ??
    str(
      top1?.stock_code,
    )
  );
}

function sessionKey(
  row: JsonRecord,
) {
  return [
    str(
      row.sourceTradingDate,
    ) ?? "",
    str(
      row.targetSessionDate,
    ) ?? "",
    stockCodeOf(row) ?? "",
  ].join("|");
}

function observationKey(
  row: JsonRecord,
) {
  return [
    str(
      row.sourceTradingDate,
    ) ?? "",
    str(
      row.targetSessionDate,
    ) ?? "",
    stockCodeOf(row) ?? "",
  ].join("|");
}

function extractPriceCandidates(
  row: JsonRecord,
) {
  const values: Array<{
    key: string;
    value: number;
  }> = [];

  function visit(
    value: unknown,
    prefix = "",
    depth = 0,
  ) {
    if (
      depth > 4
    ) {
      return;
    }

    if (
      Array.isArray(value)
    ) {
      return;
    }

    const record =
      asRecord(value);

    if (!record) {
      return;
    }

    for (
      const [
        key,
        raw
      ] of Object.entries(
        record,
      )
    ) {
      const full =
        prefix
          ? prefix + "." + key
          : key;

      if (
        typeof raw === "number" &&
        Number.isFinite(raw) &&
        /price/i.test(key)
      ) {
        values.push({
          key: full,
          value: raw,
        });
      }

      if (
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw)
      ) {
        visit(
          raw,
          full,
          depth + 1,
        );
      }
    }
  }

  visit(row);

  return values;
}

function extractDirectReturns(
  row: JsonRecord,
) {
  const corrected =
    asRecord(
      row.correctedEntry,
    );

  const direct =
    asRecord(
      corrected?.directReturns,
    );

  return {
    r1:
      num(
        direct?.r1,
      ),
    r3:
      num(
        direct?.r3,
      ),
    r5:
      num(
        direct?.r5,
      ),
  };
}

function countFrom(
  parsed: unknown,
  keys:
    readonly string[],
) {
  const record =
    asRecord(parsed);

  if (!record) {
    return null;
  }

  for (
    const key of
    keys
  ) {
    const value =
      num(
        record[key],
      );

    if (
      value !== null
    ) {
      return value;
    }
  }

  return null;
}

function nestedCount(
  parsed: unknown,
  pathParts:
    readonly string[],
) {
  let current: unknown =
    parsed;

  for (
    const part of
    pathParts
  ) {
    const record =
      asRecord(current);

    if (!record) {
      return null;
    }

    current =
      record[part];
  }

  return num(current);
}

function main() {
  const sessionFile =
    firstExisting(
      SESSION_FILES,
    );

  const sessionRows =
    sessionFile
      ? rowsFrom(
          sessionFile.parsed,
          [
            "sessions",
            "rows",
          ],
        )
      : [];

  const observationsFile =
    readJson(
      OBSERVATIONS_FILE,
    );

  const observations =
    rowsFrom(
      observationsFile.parsed,
      [
        "observations",
        "rows",
      ],
    );

  const evaluator =
    readJson(
      EVALUATOR_FILE,
    );

  const summary =
    readJson(
      SUMMARY_FILE,
    );

  const producerEvidence =
    readJson(
      PRODUCER_EVIDENCE_FILE,
    );

  const normalizedSessions =
    sessionRows
      .map(
        raw =>
          asRecord(raw),
      )
      .filter(
        (
          row,
        ): row is JsonRecord =>
          Boolean(row),
      );

  const normalizedObservations =
    observations
      .map(
        raw =>
          asRecord(raw),
      )
      .filter(
        (
          row,
        ): row is JsonRecord =>
          Boolean(row),
      );

  const sessionKeys =
    normalizedSessions.map(
      sessionKey,
    );

  const observationKeys =
    normalizedObservations.map(
      observationKey,
    );

  const duplicateSessionKeys =
    sessionKeys.filter(
      (
        key,
        index,
      ) =>
        key &&
        sessionKeys.indexOf(key) !==
        index,
    );

  const duplicateObservationKeys =
    observationKeys.filter(
      (
        key,
        index,
      ) =>
        key &&
        observationKeys.indexOf(key) !==
        index,
    );

  const badSessionDates: unknown[] =
    [];

  const badObservationDates: unknown[] =
    [];

  const badPrices: unknown[] =
    [];

  const futureLeakage: unknown[] =
    [];

  const maturityIssues: unknown[] =
    [];

  for (
    const row of
    normalizedSessions
  ) {
    const source =
      str(
        row.sourceTradingDate,
      );

    const target =
      str(
        row.targetSessionDate,
      );

    if (
      !source ||
      !target ||
      target <= source ||
      !isKrxTradingDate(source) ||
      !isKrxTradingDate(target)
    ) {
      badSessionDates.push({
        key:
          sessionKey(row),
        sourceTradingDate:
          source,
        targetSessionDate:
          target,
        sourceKrx:
          source
            ? isKrxTradingDate(source)
            : false,
        targetKrx:
          target
            ? isKrxTradingDate(target)
            : false,
      });
    }

    const cutoff =
      str(
        row.sourceDataCutoffAtCollection,
      );

    if (
      cutoff &&
      source &&
      cutoff > source
    ) {
      futureLeakage.push({
        key:
          sessionKey(row),
        sourceTradingDate:
          source,
        sourceDataCutoffAtCollection:
          cutoff,
      });
    }

    const prices =
      extractPriceCandidates(row);

    const invalid =
      prices.filter(
        item =>
          item.value <= 0,
      );

    if (
      invalid.length > 0
    ) {
      badPrices.push({
        key:
          sessionKey(row),
        invalid,
      });
    }
  }

  for (
    const row of
    normalizedObservations
  ) {
    const source =
      str(
        row.sourceTradingDate,
      );

    const target =
      str(
        row.targetSessionDate,
      );

    if (
      !source ||
      !target ||
      target <= source ||
      !isKrxTradingDate(source) ||
      !isKrxTradingDate(target)
    ) {
      badObservationDates.push({
        key:
          observationKey(row),
        sourceTradingDate:
          source,
        targetSessionDate:
          target,
      });
    }

    const returns =
      extractDirectReturns(row);

    const present = [
      returns.r1 !== null,
      returns.r3 !== null,
      returns.r5 !== null,
    ];

    if (
      present[2] &&
      (
        !present[0] ||
        !present[1]
      )
    ) {
      maturityIssues.push({
        key:
          observationKey(row),
        issue:
          "R5_PRESENT_BEFORE_R1_OR_R3",
        returns,
      });
    }

    if (
      present[1] &&
      !present[0]
    ) {
      maturityIssues.push({
        key:
          observationKey(row),
        issue:
          "R3_PRESENT_BEFORE_R1",
        returns,
      });
    }

    const prices =
      extractPriceCandidates(row);

    const invalid =
      prices.filter(
        item =>
          item.value <= 0,
      );

    if (
      invalid.length > 0
    ) {
      badPrices.push({
        key:
          observationKey(row),
        invalid,
      });
    }
  }

  const sessionKeySet =
    new Set(
      sessionKeys,
    );

  const observationWithoutSession =
    observationKeys.filter(
      key =>
        key &&
        !sessionKeySet.has(key),
    );

  const observationCount =
    normalizedObservations.length;

  const evaluatorObservationCount =
    countFrom(
      evaluator.parsed,
      [
        "observationCount",
        "observations",
        "qualified",
        "totalObservations",
      ],
    ) ??
    nestedCount(
      evaluator.parsed,
      [
        "counts",
        "observations",
      ],
    );

  const summaryObservationCount =
    countFrom(
      summary.parsed,
      [
        "observationCount",
        "observations",
        "qualified",
        "totalObservations",
      ],
    ) ??
    nestedCount(
      summary.parsed,
      [
        "evidence",
        "observations",
      ],
    );

  const evaluatorCountMismatch =
    evaluatorObservationCount !== null &&
    evaluatorObservationCount !==
      observationCount;

  const summaryCountMismatch =
    summaryObservationCount !== null &&
    summaryObservationCount !==
      observationCount;

  const evidenceRoot =
    asRecord(
      producerEvidence.parsed,
    );

  const evidenceMode =
    str(
      evidenceRoot?.mode,
    );

  const evidenceDelta =
    asRecord(
      evidenceRoot?.delta,
    );

  const controlledNewSessionCount =
    num(
      evidenceDelta?.sessionCount,
    ) ??
    0;

  const hasControlledSession =
    normalizedSessions.length >
    0;

  const hardIssues = {
    duplicateSessionKeys:
      [...new Set(
        duplicateSessionKeys,
      )],

    duplicateObservationKeys:
      [...new Set(
        duplicateObservationKeys,
      )],

    badSessionDates,
    badObservationDates,
    badPrices,
    futureLeakage,
    maturityIssues,
    observationWithoutSession,
    evaluatorCountMismatch,
    summaryCountMismatch,
  };

  const hardIssueCount =
    Object.entries(
      hardIssues,
    ).reduce(
      (
        total,
        [
          ,
          value,
        ],
      ) => {
        if (
          Array.isArray(value)
        ) {
          return (
            total +
            value.length
          );
        }

        return (
          total +
          (
            value === true
              ? 1
              : 0
          )
        );
      },
      0,
    );

  let status =
    "AI_STOCK_LAB_FORWARD_OOS_DATA_QUALITY_INTEGRITY_V1_PASS";

  let nextAction =
    "CONTINUE_CONTROLLED_FORWARD_OOS_COLLECTION";

  if (
    !hasControlledSession
  ) {
    status =
      "AI_STOCK_LAB_FORWARD_OOS_DATA_QUALITY_INTEGRITY_V1_WAITING_FOR_FIRST_CONTROLLED_SESSION";

    nextAction =
      "WAIT_FOR_CONTROLLED_NORMAL_PRODUCER_SESSION";
  }
  else if (
    hardIssueCount >
    0
  ) {
    status =
      "AI_STOCK_LAB_FORWARD_OOS_DATA_QUALITY_INTEGRITY_V1_BLOCKED";

    nextAction =
      "REPAIR_FORWARD_OOS_DATA_QUALITY_BEFORE_COUNTING_EVIDENCE";
  }

  const report = {
    status,

    sourceSelection: {
      controlledSessionCandidates:
        SESSION_FILES,

      selectedSessionFile:
        sessionFile
          ? {
              file:
                sessionFile.file,
              mtime:
                sessionFile.mtime,
            }
          : null,

      observationsFile: {
        file:
          OBSERVATIONS_FILE,
        exists:
          observationsFile.exists,
        mtime:
          observationsFile.mtime,
      },

      evaluatorFile: {
        file:
          EVALUATOR_FILE,
        exists:
          evaluator.exists,
        mtime:
          evaluator.mtime,
      },

      summaryFile: {
        file:
          SUMMARY_FILE,
        exists:
          summary.exists,
        mtime:
          summary.mtime,
      },

      producerEvidenceFile: {
        file:
          PRODUCER_EVIDENCE_FILE,
        exists:
          producerEvidence.exists,
        mtime:
          producerEvidence.mtime,
        mode:
          evidenceMode,
        deltaSessionCount:
          controlledNewSessionCount,
      },
    },

    counts: {
      sessions:
        normalizedSessions.length,

      observations:
        observationCount,

      evaluatorObservationCount,
      summaryObservationCount,
      hardIssueCount,
    },

    integrity: {
      duplicateSessionKeys:
        hardIssues
          .duplicateSessionKeys,

      duplicateObservationKeys:
        hardIssues
          .duplicateObservationKeys,

      badSessionDates,
      badObservationDates,
      badPrices,
      futureLeakage,
      maturityIssues,
      observationWithoutSession,
      evaluatorCountMismatch,
      summaryCountMismatch,
    },

    gates: {
      controlledSessionExists:
        hasControlledSession,

      noDuplicateSessions:
        hardIssues
          .duplicateSessionKeys
          .length === 0,

      noDuplicateObservations:
        hardIssues
          .duplicateObservationKeys
          .length === 0,

      validSessionDates:
        badSessionDates.length === 0,

      validObservationDates:
        badObservationDates.length === 0,

      noBadPrices:
        badPrices.length === 0,

      noFutureLeakage:
        futureLeakage.length === 0,

      maturityOrderValid:
        maturityIssues.length === 0,

      observationsBoundToSessions:
        observationWithoutSession.length === 0,

      evaluatorCountConsistent:
        !evaluatorCountMismatch,

      summaryCountConsistent:
        !summaryCountMismatch,
    },

    interpretation: {
      waitIsNormal:
        !hasControlledSession,

      controlledEvidenceCountable:
        hasControlledSession &&
        hardIssueCount === 0,

      producerEvidenceMode:
        evidenceMode,

      note:
        !hasControlledSession
          ? "No verified Controlled Forward session exists yet. WAIT is expected before the first controlled producer run."
          : (
              hardIssueCount === 0
                ? "Current Controlled Forward evidence passes the monitored integrity checks."
                : "One or more data-quality issues must be repaired before evidence is counted."
            ),
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
      nextAction,
  };

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    hardIssueCount > 0
      ? 2
      : 0;
}

main();
