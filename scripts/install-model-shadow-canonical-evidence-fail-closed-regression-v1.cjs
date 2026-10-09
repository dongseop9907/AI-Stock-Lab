const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "model-shadow-canonical-evidence-fail-closed-regression-v1.ts"
);

const source = String.raw`
import fs from "fs";
import path from "path";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  getCanonicalShadowOutcomeEvidence,
} from "@/lib/models/model-shadow-outcome-storage";

import * as promotionDecisionService
  from "@/lib/models/model-promotion-decision-service";

const ROOT = process.cwd();

const SERVICE_FILE =
  "lib/models/model-promotion-decision-service.ts";

function readSource(relativePath: string): string {
  const full =
    path.join(ROOT, relativePath);

  if (!fs.existsSync(full)) {
    return "";
  }

  return fs.readFileSync(
    full,
    "utf8",
  );
}

function matchingLines(
  text: string,
  patterns: RegExp[],
) {
  return text
    .split(/\r?\n/)
    .map((value, index) => ({
      line: index + 1,
      text: value.trim(),
    }))
    .filter(({ text }) =>
      patterns.some((pattern) =>
        pattern.test(text),
      ),
    )
    .slice(0, 60);
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const serviceSource =
    readSource(SERVICE_FILE);

  const {
    data: model,
    error: modelError,
  } =
    await supabase
      .from("ai_model_versions")
      .select(
        "id,model_name,model_version,purpose,status,promotion_stage,promotion_stage_updated_at"
      )
      .eq(
        "purpose",
        "ENTRY_TIMING",
      )
      .eq(
        "promotion_stage",
        "SHADOW",
      )
      .order(
        "promotion_stage_updated_at",
        {
          ascending: false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    modelError ||
    !model
  ) {
    throw new Error(
      "ENTRY_TIMING_SHADOW_MODEL_NOT_FOUND:" +
      (
        modelError?.message ??
        "NO_MODEL"
      ),
    );
  }

  async function countRows(
    table: string,
  ): Promise<number> {
    const {
      count,
      error,
    } =
      await supabase
        .from(table)
        .select(
          "*",
          {
            count: "exact",
            head: true,
          },
        );

    if (error) {
      throw new Error(
        "COUNT_FAILED:" +
        table +
        ":" +
        error.message,
      );
    }

    return count ?? 0;
  }

  const before = {
    canonicalRows:
      await countRows(
        "model_shadow_signal_outcomes",
      ),

    orders:
      await countRows(
        "paper_order_requests",
      ),

    positions:
      await countRows(
        "paper_positions",
      ),
  };

  const evidence =
    await getCanonicalShadowOutcomeEvidence(
      model.id,
    );

  const after = {
    canonicalRows:
      await countRows(
        "model_shadow_signal_outcomes",
      ),

    orders:
      await countRows(
        "paper_order_requests",
      ),

    positions:
      await countRows(
        "paper_positions",
      ),
  };

  const hasCanonicalReader =
    serviceSource.includes(
      "getCanonicalShadowOutcomeEvidence",
    );

  const hasFailClosedContract =
    serviceSource.includes(
      "FAIL_CLOSED_UNTIL_CANONICAL_SHADOW_OUTCOME_EVIDENCE_EXISTS",
    );

  const hasEvidenceNotReadyReason =
    serviceSource.includes(
      "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY",
    );

  const hasShadowToPaperLogic =
    serviceSource.includes(
      "shadowToPaper",
    );

  const canonicalEvidenceEmpty =
    evidence.counts.total === 0;

  const completedEvidenceEmpty =
    evidence.counts.completed === 0 &&
    evidence.completed.withReturn1d === 0 &&
    evidence.completed.withReturn3d === 0 &&
    evidence.completed.withReturn5d === 0;

  const failClosedExpected =
    model.promotion_stage === "SHADOW" &&
    canonicalEvidenceEmpty &&
    completedEvidenceEmpty &&
    hasCanonicalReader &&
    hasFailClosedContract &&
    hasEvidenceNotReadyReason &&
    hasShadowToPaperLogic;

  const checks = {
    entryTimingShadowModelFound:
      model.purpose ===
        "ENTRY_TIMING" &&
      model.promotion_stage ===
        "SHADOW",

    canonicalReaderConnected:
      hasCanonicalReader,

    failClosedContractDeclared:
      hasFailClosedContract,

    evidenceNotReadyReasonDeclared:
      hasEvidenceNotReadyReason,

    shadowToPaperLogicPresent:
      hasShadowToPaperLogic,

    canonicalEvidenceCurrentlyEmpty:
      canonicalEvidenceEmpty,

    completedEvidenceCurrentlyEmpty:
      completedEvidenceEmpty,

    shadowToPaperMustRemainBlocked:
      failClosedExpected,

    canonicalRowsUnchanged:
      before.canonicalRows ===
      after.canonicalRows,

    noOrdersCreated:
      before.orders ===
      after.orders,

    noPositionsChanged:
      before.positions ===
      after.positions,

    modelStillShadow:
      evidence.promotionStage ===
      "SHADOW",

    realTradingEnabledByScript:
      false,
  };

  const required = [
    "entryTimingShadowModelFound",
    "canonicalReaderConnected",
    "failClosedContractDeclared",
    "evidenceNotReadyReasonDeclared",
    "shadowToPaperLogicPresent",
    "canonicalEvidenceCurrentlyEmpty",
    "completedEvidenceCurrentlyEmpty",
    "shadowToPaperMustRemainBlocked",
    "canonicalRowsUnchanged",
    "noOrdersCreated",
    "noPositionsChanged",
    "modelStillShadow",
  ] as const;

  const failed =
    required.filter(
      (key) =>
        !checks[key],
    );

  const report = {
    status:
      failed.length === 0
        ? "MODEL_SHADOW_CANONICAL_EVIDENCE_FAIL_CLOSED_REGRESSION_V1_VERIFIED"
        : "MODEL_SHADOW_CANONICAL_EVIDENCE_FAIL_CLOSED_REGRESSION_V1_FAILED",

    model: {
      id:
        model.id,

      name:
        model.model_name,

      version:
        model.model_version,

      purpose:
        model.purpose,

      legacyStatus:
        model.status,

      promotionStage:
        model.promotion_stage,

      shadowStartedAt:
        model.promotion_stage_updated_at,
    },

    canonicalEvidence:
      evidence,

    promotionDecisionService: {
      file:
        SERVICE_FILE,

      exports:
        Object.keys(
          promotionDecisionService,
        ),

      hasCanonicalReader,
      hasFailClosedContract,
      hasEvidenceNotReadyReason,
      hasShadowToPaperLogic,

      relevantLines:
        matchingLines(
          serviceSource,
          [
            /getCanonicalShadowOutcomeEvidence/,
            /SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY/,
            /FAIL_CLOSED_UNTIL_CANONICAL_SHADOW_OUTCOME_EVIDENCE_EXISTS/,
            /shadowToPaper/,
          ],
        ),
    },

    counts: {
      canonicalRows:
        String(
          before.canonicalRows,
        ) +
        "->" +
        String(
          after.canonicalRows,
        ),

      orders:
        String(
          before.orders,
        ) +
        "->" +
        String(
          after.orders,
        ),

      positions:
        String(
          before.positions,
        ) +
        "->" +
        String(
          after.positions,
        ),
    },

    checks,

    failed,

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      ordersCreated:
        after.orders -
        before.orders,

      positionsChanged:
        after.positions -
        before.positions,

      promotionChange:
        false,

      controlsChange:
        false,

      realTradingEnabledByScript:
        false,
    },

    nextGate:
      failed.length === 0
        ? "KEEP_SHADOW_AND_VERIFY_FIRST_REAL_POST_SHADOW_SIGNAL_CANONICAL_CAPTURE"
        : "PATCH_CANONICAL_EVIDENCE_READER_OR_SHADOW_TO_PAPER_FAIL_CLOSED_GAP",
  };

  fs.mkdirSync(
    path.join(
      ROOT,
      "logs",
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "model-shadow-canonical-evidence-fail-closed-regression-v1.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "MODEL_SHADOW_CANONICAL_EVIDENCE_FAIL_CLOSED_REGRESSION_V1_FAILED",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          safety: {
            databaseWrites:
              0,

            orderCreation:
              false,

            positionChange:
              false,

            promotionChange:
              false,

            controlsChange:
              false,

            realTradingEnable:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
`;

fs.writeFileSync(
  target,
  source,
  "utf8",
);

console.log(JSON.stringify({
  status:
    "MODEL_SHADOW_CANONICAL_EVIDENCE_FAIL_CLOSED_REGRESSION_V1_INSTALLED",

  generatedFile:
    "scripts/model-shadow-canonical-evidence-fail-closed-regression-v1.ts",

  mode:
    "READ_ONLY_CANONICAL_EVIDENCE_FAIL_CLOSED_REGRESSION",

  safety: {
    databaseWrites: 0,
    orderCreation: false,
    positionChange: false,
    promotionChange: false,
    controlsChange: false,
    realTradingEnable: false
  },

  nextAction:
    "RUN_FAIL_CLOSED_REGRESSION"
}, null, 2));
