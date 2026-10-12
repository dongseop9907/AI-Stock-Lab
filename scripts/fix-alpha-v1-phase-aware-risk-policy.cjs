#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_PHASE_AWARE_RISK_POLICY_FIX';

function replaceOnce(text, needle, replacement, label) {
  const count = text.split(needle).length - 1;

  if (count !== 1) {
    throw new Error(
      `${label}_EXPECTED_ONCE_GOT_${count}`,
    );
  }

  return text.replace(
    needle,
    replacement,
  );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const scorerFile =
    path.join(
      root,
      'lib',
      'alpha',
      'candidate-scoring.ts',
    );

  const runnerFile =
    path.join(
      root,
      'scripts',
      'alpha-v1-real-runner-db-read-only.ts',
    );

  if (!fs.existsSync(scorerFile)) {
    throw new Error(
      `FILE_NOT_FOUND:${scorerFile}`,
    );
  }

  if (!fs.existsSync(runnerFile)) {
    throw new Error(
      `FILE_NOT_FOUND:${runnerFile}`,
    );
  }

  let scorer =
    fs.readFileSync(
      scorerFile,
      'utf8',
    );

  let runner =
    fs.readFileSync(
      runnerFile,
      'utf8',
    );

  // ------------------------------------------------------------------
  // 1) Explicit phase-aware risk policy on the candidate input contract.
  // Default remains REQUIRED, preserving all existing smoke semantics.
  // ------------------------------------------------------------------

  scorer =
    replaceOnce(
      scorer,
      `export interface AlphaCandidateInput {
  stockCode: string;

  /**
   * Exact decision timestamp used by backtest/shadow/paper/live.
   */
  decisionAt: string;

  modelId?: string;
  modelVersion?: string;
`,
      `export type AlphaRiskPolicy =
  | "REQUIRED"
  | "DEFER_TO_PREFLIGHT";

export interface AlphaCandidateInput {
  stockCode: string;

  /**
   * Exact decision timestamp used by backtest/shadow/paper/live.
   */
  decisionAt: string;

  modelId?: string;
  modelVersion?: string;

  /**
   * REQUIRED:
   *   Candidate score expects trade-specific risk evidence.
   *   Missing risk receives the historical neutral 0.5 penalty.
   *
   * DEFER_TO_PREFLIGHT:
   *   Candidate ranking intentionally runs before a concrete
   *   entry/stop/qty exists. Missing risk contributes no artificial
   *   penalty. validateBuyRisk() must be bound later before execution.
   */
  riskPolicy?: AlphaRiskPolicy;
`,
      'ADD_RISK_POLICY',
    );

  // ------------------------------------------------------------------
  // 2) Replace missing-risk behavior.
  // ------------------------------------------------------------------

  scorer =
    replaceOnce(
      scorer,
      `  /**
   * Missing risk is intentionally conservative:
   * use neutral 0.5 rather than zero risk.
   */
  const effectiveRiskPenalty =
    risk.included
      ? risk.effective
      : 0.5;
`,
      `  const riskPolicy =
    input.riskPolicy ??
    "REQUIRED";

  /**
   * Candidate selection and trade preflight are separate phases.
   *
   * REQUIRED:
   *   Historical behavior. Missing risk receives neutral 0.5 penalty.
   *
   * DEFER_TO_PREFLIGHT:
   *   No trade-specific risk exists yet, so do not fabricate a penalty.
   *   Execution must still bind validateBuyRisk() later.
   */
  const effectiveRiskPenalty =
    risk.included
      ? risk.effective
      : riskPolicy ===
          "DEFER_TO_PREFLIGHT"
        ? 0
        : 0.5;
`,
      'PATCH_EFFECTIVE_RISK',
    );

  // ------------------------------------------------------------------
  // 3) Make warning truthful instead of saying missing risk got neutral
  //    penalty when it was intentionally deferred.
  // ------------------------------------------------------------------

  scorer =
    replaceOnce(
      scorer,
      `  if (!risk.included) {
    warnings.push(
      "RISK_EVIDENCE_MISSING_OR_UNUSABLE_NEUTRAL_PENALTY_APPLIED",
    );
  }
`,
      `  if (!risk.included) {
    if (
      riskPolicy ===
      "DEFER_TO_PREFLIGHT"
    ) {
      warnings.push(
        "RISK_DEFERRED_TO_PREFLIGHT_NO_CANDIDATE_STAGE_PENALTY",
      );
    } else {
      warnings.push(
        "RISK_EVIDENCE_MISSING_OR_UNUSABLE_NEUTRAL_PENALTY_APPLIED",
      );
    }
  }
`,
      'PATCH_RISK_WARNING',
    );

  // ------------------------------------------------------------------
  // 4) Fingerprint must include policy because it materially changes
  //    the score contract.
  // ------------------------------------------------------------------

  scorer =
    replaceOnce(
      scorer,
      `      modelVersion:
        input.modelVersion ?? null,

      features:
        input.features,
`,
      `      modelVersion:
        input.modelVersion ?? null,

      riskPolicy,

      features:
        input.features,
`,
      'PATCH_FINGERPRINT',
    );

  // ------------------------------------------------------------------
  // 5) Expose risk policy in score metadata.
  // ------------------------------------------------------------------

  scorer =
    replaceOnce(
      scorer,
      `    metadata: {
      modelId:
        input.modelId ?? null,

      modelVersion:
        input.modelVersion ??
        null,
`,
      `    metadata: {
      modelId:
        input.modelId ?? null,

      modelVersion:
        input.modelVersion ??
        null,

      riskPolicy,
`,
      'PATCH_METADATA',
    );

  // Type currently inferred from returned object; extend interface metadata.
  scorer =
    replaceOnce(
      scorer,
      `  metadata: {
    modelId: string | null;
    modelVersion: string | null;
    positiveWeightCovered: number;
`,
      `  metadata: {
    modelId: string | null;
    modelVersion: string | null;
    riskPolicy: AlphaRiskPolicy;
    positiveWeightCovered: number;
`,
      'PATCH_METADATA_INTERFACE',
    );

  // ------------------------------------------------------------------
  // 6) Real runner explicitly defers risk to preflight.
  // ------------------------------------------------------------------

  runner =
    replaceOnce(
      runner,
      `        return buildAlphaCandidateInputFromRealSources({
          stockCode,

          decisionAt:
            config.decisionAt,
`,
      `        const candidateInput =
          buildAlphaCandidateInputFromRealSources({
            stockCode,

            decisionAt:
              config.decisionAt,
`,
      'PATCH_RUNNER_DECLARATION',
    );

  runner =
    replaceOnce(
      runner,
      `          modelVersion:
            "alpha-v1-real-runner-readonly",
        });
      },
    );
`,
      `          modelVersion:
            "alpha-v1-real-runner-readonly",
          });

        candidateInput.riskPolicy =
          "DEFER_TO_PREFLIGHT";

        return candidateInput;
      },
    );
`,
      'PATCH_RUNNER_RISK_POLICY',
    );

  // ------------------------------------------------------------------
  // 7) Diagnostic output records the phase contract.
  // ------------------------------------------------------------------

  runner =
    replaceOnce(
      runner,
      `      riskPenalty:
        "DEFERRED_UNTIL_PROPOSED_TRADE_PREFLIGHT",
`,
      `      riskPenalty:
        "DEFERRED_UNTIL_PROPOSED_TRADE_PREFLIGHT_NO_CANDIDATE_STAGE_PENALTY",
`,
      'PATCH_RUNNER_STATUS',
    );

  fs.writeFileSync(
    scorerFile,
    scorer,
    'utf8',
  );

  fs.writeFileSync(
    runnerFile,
    runner,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_PHASE_AWARE_RISK_POLICY_FIX_COMPLETE',

        version:
          VERSION,

        changedFiles: [
          'lib/alpha/candidate-scoring.ts',
          'scripts/alpha-v1-real-runner-db-read-only.ts',
        ],

        contract: {
          defaultRiskPolicy:
            'REQUIRED',

          realRunnerRiskPolicy:
            'DEFER_TO_PREFLIGHT',

          missingRiskPenaltyInRealRunner:
            0,

          executionRiskValidationStillRequired:
            true,

          validateBuyRiskBypassed:
            false,
        },

        thresholdsChanged:
          false,

        weightsChanged:
          false,

        safety: {
          databaseReads:
            0,

          databaseWrites:
            0,

          networkRequests:
            0,

          ordersCreated:
            0,
        },

        nextAction:
          'RERUN_ALPHA_SMOKES_AND_REAL_RUNNER',
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
          'ALPHA_V1_PHASE_AWARE_RISK_POLICY_FIX_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
