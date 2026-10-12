import fs from "node:fs";
import path from "node:path";

import {
  nextKrxTradingDate,
} from "../trading/krx-trading-calendar";

export interface ForwardOosObservabilityDashboardV1 {
  status: string;
  generatedAt: string;
  currentGate: string;
  nextAction: string | null;
  sourceFiles: {
    forwardSessions: string | null;
    observations: string | null;
    evaluator: string | null;
    summary: string | null;
    producerEvidence: string | null;
  };
  sessions: {
    total: number;
    valid: number;
    invalid: number;
    nextMaturityDate: string | null;
  };
  maturity: {
    "1D": number;
    "3D": number;
    "5D": number;
  };
  evidence: {
    observations: number;
    qualified: number;
    filled: number;
    fillRate: number | null;
    pairedPositiveRate: {
      "1D": number | null;
      "3D": number | null;
      "5D": number | null;
    };
  };
  thresholds: {
    minQualified: number | null;
    minCalendarDays: number | null;
    minFillRate: number | null;
    minPairedPositiveRate: number | null;
  };
  finalGate: {
    qualifiedAtLeast80: boolean;
    calendarDaysAtLeast60: boolean;
    fillRateAtLeast90Pct: boolean;
    pairedPositiveR1: boolean;
    pairedPositiveR3: boolean;
    pairedPositiveR5: boolean;
    trueForwardReady: boolean;
  };
  producerEvidence: {
    status: string | null;
    mode: string | null;
    sessionDelta: number;
    normalProducerExecuted: boolean;
  };
  warnings: string[];
  safety: {
    readOnly: true;
    databaseWrites: 0;
    ordersCreated: 0;
    positionsChanged: 0;
    promotionExecuted: false;
    realTradingEnabled: false;
  };
}

const LOGS =
  path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "logs",
  );

const FORWARD_FILES = [
  path.join(
    LOGS,
    "alpha-v3-true-forward-oos.json",
  ),
  path.join(
    LOGS,
    "alpha-v3-true-forward-oos-v1.json",
  ),
  path.join(
    LOGS,
    "alpha-v3-true-forward-top1-sessions-v1.json",
  ),
  path.join(
    LOGS,
    "alpha-v3-forward-top1-sessions.json",
  ),
];

const OBSERVATION_FILE =
  path.join(
    LOGS,
    "alpha-v3-entry-v3-forward-oos-observations.json",
  );

const EVALUATOR_FILE =
  path.join(
    LOGS,
    "alpha-v3-entry-v3-forward-shadow-oos.json",
  );

const SUMMARY_FILE =
  path.join(
    LOGS,
    "alpha-v3-true-forward-oos-summary.json",
  );

const PRODUCER_EVIDENCE_FILE =
  path.join(
    LOGS,
    "true-forward-oos-controlled-producer-evidence-run-v1.json",
  );

function displayPath(
  absolute: string | null,
) {
  if (!absolute) {
    return null;
  }

  return (
    "logs/" +
    path.basename(
      absolute,
    )
  );
}

function firstExisting(
  candidates: string[],
) {
  for (
    const absolute of candidates
  ) {
    if (
      fs.existsSync(
        absolute,
      )
    ) {
      return absolute;
    }
  }

  return null;
}

function existingOrNull(
  absolute: string,
) {
  return fs.existsSync(
    absolute,
  )
    ? absolute
    : null;
}

function readJson(
  absolute: string | null,
): any | null {
  if (!absolute) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        absolute,
        "utf8",
      ),
    );
  } catch {
    return null;
  }
}

function arrayOf(
  value: any,
) {
  return Array.isArray(
    value,
  )
    ? value
    : [];
}

function finiteOrNull(
  value: any,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    Number(
      value,
    );

  return Number.isFinite(
    n,
  )
    ? n
    : null;
}

function bool(
  value: any,
) {
  return value ===
    true;
}

function addKrxSessions(
  date: string,
  count: number,
) {
  let cursor =
    date;

  for (
    let i = 0;
    i < count;
    i += 1
  ) {
    cursor =
      nextKrxTradingDate(
        cursor,
      );
  }

  return cursor;
}

function todayKst() {
  return new Date(
    Date.now() +
    9 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(
      0,
      10,
    );
}

function sessionIntegrity(
  row: any,
) {
  const source =
    String(
      row?.sourceTradingDate ??
      "",
    );

  const target =
    String(
      row?.targetSessionDate ??
      "",
    );

  return (
    /^\d{4}-\d{2}-\d{2}$/.test(
      source,
    ) &&
    /^\d{4}-\d{2}-\d{2}$/.test(
      target,
    ) &&
    target >
      source
  );
}

function buildMaturity(
  sessions: any[],
) {
  const today =
    todayKst();

  const counts = {
    "1D": 0,
    "3D": 0,
    "5D": 0,
  };

  const futureDates:
    string[] = [];

  for (
    const row of sessions
  ) {
    if (
      !sessionIntegrity(
        row,
      )
    ) {
      continue;
    }

    const target =
      String(
        row.targetSessionDate,
      );

    const dates = {
      "1D":
        addKrxSessions(
          target,
          1,
        ),

      "3D":
        addKrxSessions(
          target,
          3,
        ),

      "5D":
        addKrxSessions(
          target,
          5,
        ),
    };

    for (
      const horizon of [
        "1D",
        "3D",
        "5D",
      ] as const
    ) {
      if (
        today >=
        dates[horizon]
      ) {
        counts[horizon] +=
          1;
      } else {
        futureDates.push(
          dates[horizon],
        );
      }
    }
  }

  futureDates.sort();

  return {
    counts,
    nextMaturityDate:
      futureDates[0] ??
      null,
  };
}

function observationCount(
  observations: any,
) {
  if (
    Array.isArray(
      observations,
    )
  ) {
    return observations.length;
  }

  if (
    Array.isArray(
      observations?.observations,
    )
  ) {
    return observations
      .observations
      .length;
  }

  return finiteOrNull(
    observations
      ?.counts
      ?.observations,
  ) ?? 0;
}

function pairedRate(
  evaluator: any,
  horizon: string,
) {
  const row =
    arrayOf(
      evaluator?.horizons,
    )
      .find(
        (item: any) =>
          String(
            item?.horizon ??
            "",
          ) ===
          horizon,
      );

  return finiteOrNull(
    row?.pairedPositiveRate,
  );
}

function determineGate(
  input: {
    sessionCount: number;
    invalidCount: number;
    maturity1d: number;
    observations: number;
    evaluator: any;
    summary: any;
  },
) {
  if (
    input.sessionCount ===
    0
  ) {
    return {
      currentGate:
        "WAITING_FOR_FORWARD_SESSION",

      nextAction:
        "WAIT_FOR_CONTROLLED_NORMAL_PRODUCER_SESSION",
    };
  }

  if (
    input.invalidCount >
    0
  ) {
    return {
      currentGate:
        "FORWARD_SESSION_INTEGRITY_FAILED",

      nextAction:
        "REPAIR_FORWARD_SESSION_INTEGRITY",
    };
  }

  if (
    input.maturity1d ===
    0
  ) {
    return {
      currentGate:
        "WAITING_FOR_1D_MATURITY",

      nextAction:
        "WAIT_FOR_1D_MATURITY",
    };
  }

  if (
    input.observations ===
    0
  ) {
    return {
      currentGate:
        "WAITING_FOR_FORWARD_OBSERVATIONS",

      nextAction:
        "RUN_MATURE_OUTCOME_COLLECTION",
    };
  }

  if (
    bool(
      input
        .summary
        ?.decision
        ?.trueForwardReady,
    )
  ) {
    return {
      currentGate:
        "TRUE_FORWARD_OOS_READY_FOR_MANUAL_REVIEW",

      nextAction:
        String(
          input
            .summary
            ?.decision
            ?.nextUse ??
          "MANUAL_FORWARD_OOS_REVIEW",
        ),
    };
  }

  if (
    bool(
      input
        .evaluator
        ?.decision
        ?.forwardOosGatePassed,
    )
  ) {
    return {
      currentGate:
        "FORWARD_OOS_GATE_PASSED",

      nextAction:
        String(
          input
            .evaluator
            ?.decision
            ?.nextUse ??
          "READY_FOR_MANUAL_FORWARD_OOS_REVIEW",
        ),
    };
  }

  return {
    currentGate:
      "FORWARD_OOS_EVIDENCE_ACCUMULATING",

    nextAction:
      String(
        input
          .evaluator
          ?.decision
          ?.nextUse ??
        "CONTINUE_TRUE_FORWARD_OOS_COLLECTION",
      ),
  };
}

export function getForwardOosObservabilityDashboardV1():
  ForwardOosObservabilityDashboardV1 {
  const forwardFile =
    firstExisting(
      FORWARD_FILES,
    );

  const observationsFile =
    existingOrNull(
      OBSERVATION_FILE,
    );

  const evaluatorFile =
    existingOrNull(
      EVALUATOR_FILE,
    );

  const summaryFile =
    existingOrNull(
      SUMMARY_FILE,
    );

  const producerEvidenceFile =
    existingOrNull(
      PRODUCER_EVIDENCE_FILE,
    );

  const forward =
    readJson(
      forwardFile,
    );

  const sessions =
    arrayOf(
      forward?.sessions,
    );

  const observations =
    readJson(
      observationsFile,
    );

  const evaluator =
    readJson(
      evaluatorFile,
    );

  const summary =
    readJson(
      summaryFile,
    );

  const producerEvidence =
    readJson(
      producerEvidenceFile,
    );

  const observationsCount =
    observationCount(
      observations,
    );

  const hasRealObservations =
    observationsCount >
    0;

  const valid =
    sessions.filter(
      sessionIntegrity,
    );

  const invalid =
    sessions.length -
    valid.length;

  const maturity =
    buildMaturity(
      sessions,
    );

  const gate =
    determineGate({
      sessionCount:
        sessions.length,

      invalidCount:
        invalid,

      maturity1d:
        maturity
          .counts["1D"],

      observations:
        observationsCount,

      evaluator,
      summary,
    });

  const warnings:
    string[] = [];

  if (
    sessions.length ===
    0
  ) {
    warnings.push(
      "No real Forward OOS session has been captured yet.",
    );
  }

  if (
    invalid >
    0
  ) {
    warnings.push(
      `${invalid} Forward session(s) failed integrity checks.`,
    );
  }

  if (
    !observationsFile ||
    observationsCount ===
      0
  ) {
    warnings.push(
      "No real Forward OOS observation is available yet.",
    );
  }

  if (
    !hasRealObservations
  ) {
    warnings.push(
      "Stale evaluator/summary readiness is suppressed until real observations exist.",
    );
  }

  const rawFillRate =
    hasRealObservations
      ? (
          finiteOrNull(
            evaluator
              ?.fillRate,
          ) ??
          finiteOrNull(
            summary
              ?.performance
              ?.fillRate,
          )
        )
      : null;

  if (
    rawFillRate ===
    null
  ) {
    warnings.push(
      "Fill rate is not available from real observations yet.",
    );
  }

  const thresholds = {
    minQualified:
      finiteOrNull(
        evaluator
          ?.contract
          ?.minQualifiedObservations,
      ),

    minCalendarDays:
      finiteOrNull(
        evaluator
          ?.contract
          ?.minCalendarDays,
      ),

    minFillRate:
      finiteOrNull(
        evaluator
          ?.contract
          ?.minFillRate,
      ),

    minPairedPositiveRate:
      finiteOrNull(
        evaluator
          ?.contract
          ?.minPairedPositiveRate,
      ),
  };

  const qualified =
    hasRealObservations
      ? (
          finiteOrNull(
            evaluator
              ?.counts
              ?.qualifiedObservations,
          ) ??
          finiteOrNull(
            summary
              ?.counts
              ?.qualifiedSessions,
          ) ??
          0
        )
      : 0;

  const filled =
    hasRealObservations
      ? (
          finiteOrNull(
            evaluator
              ?.counts
              ?.filledObservations,
          ) ??
          finiteOrNull(
            summary
              ?.counts
              ?.filledSessions,
          ) ??
          0
        )
      : 0;

  const finalGate = {
    qualifiedAtLeast80:
      hasRealObservations &&
      bool(
        summary
          ?.finalGate
          ?.qualifiedAtLeast80,
      ),

    calendarDaysAtLeast60:
      hasRealObservations &&
      bool(
        summary
          ?.finalGate
          ?.calendarDaysAtLeast60,
      ),

    fillRateAtLeast90Pct:
      hasRealObservations &&
      bool(
        summary
          ?.finalGate
          ?.fillRateAtLeast90Pct,
      ),

    pairedPositiveR1:
      hasRealObservations &&
      bool(
        summary
          ?.finalGate
          ?.pairedPositiveR1,
      ),

    pairedPositiveR3:
      hasRealObservations &&
      bool(
        summary
          ?.finalGate
          ?.pairedPositiveR3,
      ),

    pairedPositiveR5:
      hasRealObservations &&
      bool(
        summary
          ?.finalGate
          ?.pairedPositiveR5,
      ),

    trueForwardReady:
      hasRealObservations &&
      bool(
        summary
          ?.decision
          ?.trueForwardReady,
      ),
  };

  if (
    !finalGate
      .trueForwardReady
  ) {
    warnings.push(
      "True Forward OOS final gate is not READY on current real evidence.",
    );
  }

  return {
    status:
      "AI_STOCK_LAB_FORWARD_OOS_OBSERVABILITY_DASHBOARD_V1",

    generatedAt:
      new Date()
        .toISOString(),

    currentGate:
      gate.currentGate,

    nextAction:
      gate.nextAction,

    sourceFiles: {
      forwardSessions:
        displayPath(
          forwardFile,
        ),

      observations:
        displayPath(
          observationsFile,
        ),

      evaluator:
        displayPath(
          evaluatorFile,
        ),

      summary:
        displayPath(
          summaryFile,
        ),

      producerEvidence:
        displayPath(
          producerEvidenceFile,
        ),
    },

    sessions: {
      total:
        sessions.length,

      valid:
        valid.length,

      invalid,

      nextMaturityDate:
        maturity
          .nextMaturityDate,
    },

    maturity:
      maturity.counts,

    evidence: {
      observations:
        observationsCount,

      qualified,

      filled,

      fillRate:
        rawFillRate,

      pairedPositiveRate: {
        "1D":
          hasRealObservations
            ? (
                pairedRate(
                  evaluator,
                  "1D",
                ) ??
                finiteOrNull(
                  summary
                    ?.performance
                    ?.pairedVsDirect
                    ?.r1
                    ?.positiveRate,
                )
              )
            : null,

        "3D":
          hasRealObservations
            ? (
                pairedRate(
                  evaluator,
                  "3D",
                ) ??
                finiteOrNull(
                  summary
                    ?.performance
                    ?.pairedVsDirect
                    ?.r3
                    ?.positiveRate,
                )
              )
            : null,

        "5D":
          hasRealObservations
            ? (
                pairedRate(
                  evaluator,
                  "5D",
                ) ??
                finiteOrNull(
                  summary
                    ?.performance
                    ?.pairedVsDirect
                    ?.r5
                    ?.positiveRate,
                )
              )
            : null,
      },
    },

    thresholds,

    finalGate,

    producerEvidence: {
      status:
        producerEvidence
          ?.status ??
        null,

      mode:
        producerEvidence
          ?.mode ??
        null,

      sessionDelta:
        finiteOrNull(
          producerEvidence
            ?.delta
            ?.sessionCount,
        ) ?? 0,

      normalProducerExecuted:
        bool(
          producerEvidence
            ?.controlledResult
            ?.safety
            ?.normalProducerExecuted,
        ),
    },

    warnings,

    safety: {
      readOnly:
        true,

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
  };
}
