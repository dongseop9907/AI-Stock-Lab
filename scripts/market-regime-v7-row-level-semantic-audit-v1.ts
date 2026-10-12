import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

type AnyRow = Record<string, any>;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function decisionScore(
  wouldBlock: boolean,
  forwardReturn: number,
): number {
  return wouldBlock
    ? -forwardReturn
    : forwardReturn;
}

function agreementState(
  v6WouldBlock: boolean,
  v7WouldBlock: boolean,
): string {
  if (v6WouldBlock && v7WouldBlock) {
    return "BOTH_BLOCK";
  }

  if (!v6WouldBlock && !v7WouldBlock) {
    return "BOTH_ALLOW";
  }

  if (v6WouldBlock && !v7WouldBlock) {
    return "V6_BLOCK_V7_ALLOW";
  }

  return "V6_ALLOW_V7_BLOCK";
}

function rate(
  positive: number,
  total: number,
): number | null {
  return total > 0
    ? positive / total
    : null;
}

function summarize(
  rows: AnyRow[],
  mode: "BASELINE" | "FLIP_V7" | "FLIP_RETURN" | "FLIP_V6",
) {
  let eligible = 0;
  let v6Positive = 0;
  let v7Positive = 0;
  let disagreements = 0;
  let v6Wins = 0;
  let v7Wins = 0;
  let ties = 0;

  for (const row of rows) {
    const ret = num(row.return_5d);

    if (ret === null) {
      continue;
    }

    let v6Block = Boolean(row.v6_would_block);
    let v7Block = Boolean(row.v7_would_block);
    let effectiveReturn = ret;

    if (mode === "FLIP_V7") {
      v7Block = !v7Block;
    }

    if (mode === "FLIP_V6") {
      v6Block = !v6Block;
    }

    if (mode === "FLIP_RETURN") {
      effectiveReturn = -effectiveReturn;
    }

    const v6Score =
      decisionScore(
        v6Block,
        effectiveReturn,
      );

    const v7Score =
      decisionScore(
        v7Block,
        effectiveReturn,
      );

    eligible += 1;

    if (v6Score > 0) {
      v6Positive += 1;
    }

    if (v7Score > 0) {
      v7Positive += 1;
    }

    if (v6Block !== v7Block) {
      disagreements += 1;

      if (v6Score > v7Score) {
        v6Wins += 1;
      } else if (v7Score > v6Score) {
        v7Wins += 1;
      } else {
        ties += 1;
      }
    }
  }

  return {
    eligible,
    disagreements,
    v6CorrectRate:
      rate(
        v6Positive,
        eligible,
      ),
    v7CorrectRate:
      rate(
        v7Positive,
        eligible,
      ),
    v6Wins,
    v7Wins,
    ties,
    v7HeadToHeadWinRate:
      rate(
        v7Wins,
        v6Wins + v7Wins,
      ),
  };
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_regime_shadow_outcomes",
      )
      .select("*")
      .eq(
        "evaluation_status",
        "COMPLETED",
      )
      .limit(1000);

  if (error) {
    throw new Error(
      `OUTCOME_READ_FAILED:${error.message}`,
    );
  }

  const loaded =
    (data ?? []) as AnyRow[];

  const rows =
    loaded.filter(
      (row) =>
        row.is_validation !== true,
    );

  let agreementMismatch = 0;
  let v6StoredScoreMismatch = 0;
  let v7StoredScoreMismatch = 0;
  let storedWinnerMismatch = 0;
  let storedWinnerComparable = 0;

  const winnerDistribution:
    Record<string, number> = {};

  for (const row of rows) {
    const ret = num(row.return_5d);

    if (ret === null) {
      continue;
    }

    const v6Block =
      Boolean(row.v6_would_block);

    const v7Block =
      Boolean(row.v7_would_block);

    const expectedAgreement =
      agreementState(
        v6Block,
        v7Block,
      );

    if (
      typeof row.agreement_state === "string" &&
      row.agreement_state !== expectedAgreement
    ) {
      agreementMismatch += 1;
    }

    const v6Score =
      decisionScore(
        v6Block,
        ret,
      );

    const v7Score =
      decisionScore(
        v7Block,
        ret,
      );

    const storedV6 =
      num(
        row.v6_decision_score_5d,
      );

    const storedV7 =
      num(
        row.v7_decision_score_5d,
      );

    if (
      storedV6 !== null &&
      Math.abs(
        storedV6 - v6Score,
      ) > 1e-10
    ) {
      v6StoredScoreMismatch += 1;
    }

    if (
      storedV7 !== null &&
      Math.abs(
        storedV7 - v7Score,
      ) > 1e-10
    ) {
      v7StoredScoreMismatch += 1;
    }

    const storedWinner =
      row.disagreement_winner;

    if (
      typeof storedWinner === "string" &&
      storedWinner.length > 0
    ) {
      winnerDistribution[
        storedWinner
      ] =
        (
          winnerDistribution[
            storedWinner
          ] ?? 0
        ) + 1;
    }

    if (
      v6Block !== v7Block &&
      typeof storedWinner === "string" &&
      storedWinner.length > 0
    ) {
      storedWinnerComparable += 1;

      const normalized =
        storedWinner
          .toUpperCase();

      const expectedWinner =
        v6Score > v7Score
          ? "V6"
          : v7Score > v6Score
            ? "V7"
            : "TIE";

      const normalizedExpectedMatches =
        normalized === expectedWinner ||
        normalized.includes(
          expectedWinner,
        );

      if (!normalizedExpectedMatches) {
        storedWinnerMismatch += 1;
      }
    }
  }

  const baseline =
    summarize(
      rows,
      "BASELINE",
    );

  const flipV7 =
    summarize(
      rows,
      "FLIP_V7",
    );

  const flipReturn =
    summarize(
      rows,
      "FLIP_RETURN",
    );

  const flipV6 =
    summarize(
      rows,
      "FLIP_V6",
    );

  const diagnosis =
    flipV7.v7CorrectRate !== null &&
    baseline.v7CorrectRate !== null &&
    flipV7.v7CorrectRate >
      baseline.v7CorrectRate + 0.8
      ? "V7_BOOLEAN_SEMANTICS_OR_POLICY_DIRECTION_STRONGLY_INVERTED"
      : (
          flipReturn.v7CorrectRate !== null &&
          baseline.v7CorrectRate !== null &&
          flipReturn.v7CorrectRate >
            baseline.v7CorrectRate + 0.8
        )
        ? "RETURN_SIGN_SEMANTICS_STRONGLY_INVERTED"
        : "NO_SINGLE_STRONG_INVERSION_IDENTIFIED";

  const output = {
    status:
      "MARKET_REGIME_V7_ROW_LEVEL_SEMANTIC_AUDIT_V1_COMPLETE",

    sample: {
      loadedCompletedRows:
        loaded.length,
      nonValidationRows:
        rows.length,
    },

    scenarios: {
      baseline,
      flipV7,
      flipReturn,
      flipV6,
    },

    consistency: {
      agreementMismatch,
      v6StoredScoreMismatch,
      v7StoredScoreMismatch,
      storedWinnerComparable,
      storedWinnerMismatch,
      winnerDistribution,
    },

    diagnosis,

    safety: {
      databaseReads: true,
      databaseWrites: 0,
      sourceFilesModified: 0,
      regimePolicyChanged: false,
      forwardEvidenceChanged: false,
      ordersCreated: 0,
      positionsChanged: 0,
      realTradingChanged: false,
    },

    fullDetails:
      "logs/market-regime-v7-row-level-semantic-audit-v1.json",

    nextGate:
      diagnosis ===
        "V7_BOOLEAN_SEMANTICS_OR_POLICY_DIRECTION_STRONGLY_INVERTED"
        ? "AUDIT_V7_POLICY_BLOCKED_BOOLEAN_SOURCE"
        : diagnosis ===
          "RETURN_SIGN_SEMANTICS_STRONGLY_INVERTED"
          ? "AUDIT_FORWARD_RETURN_SIGN_SOURCE"
          : "AUDIT_ROW_LEVEL_OUTLIERS_AND_POLICY_LOGIC",
  };

  fs.mkdirSync(
    path.resolve(
      process.cwd(),
      "logs",
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    path.resolve(
      process.cwd(),
      output.fullDetails,
    ),
    JSON.stringify(
      output,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  /*
   * Deliberately tiny console payload.
   */
  console.log(
    JSON.stringify(
      {
        status:
          output.status,
        rows:
          output.sample
            .nonValidationRows,
        baseline: {
          v6:
            baseline.v6CorrectRate,
          v7:
            baseline.v7CorrectRate,
          v7H2H:
            baseline
              .v7HeadToHeadWinRate,
        },
        flipV7: {
          v7:
            flipV7.v7CorrectRate,
          v7H2H:
            flipV7
              .v7HeadToHeadWinRate,
        },
        flipReturn: {
          v6:
            flipReturn
              .v6CorrectRate,
          v7:
            flipReturn
              .v7CorrectRate,
        },
        consistency: {
          agreementMismatch,
          v6ScoreMismatch:
            v6StoredScoreMismatch,
          v7ScoreMismatch:
            v7StoredScoreMismatch,
          winnerMismatch:
            storedWinnerMismatch,
        },
        diagnosis:
          output.diagnosis,
        nextGate:
          output.nextGate,
        details:
          output.fullDetails,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "MARKET_REGIME_V7_ROW_LEVEL_SEMANTIC_AUDIT_V1_ERROR",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            databaseWrites: 0,
            sourceFilesModified: 0,
            ordersCreated: 0,
            positionsChanged: 0,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
