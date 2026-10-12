const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "lib",
  "models",
  "model-promotion-decision-service.ts",
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups",
);

const BUGGY_BACKUP = path.join(
  BACKUP_DIR,
  "model-promotion-decision-service.after-bad-canonical-reader-binding-v1.ts",
);

function output(status, extra = {}) {
  console.log(
    JSON.stringify(
      {
        status,
        ...extra,
      },
      null,
      2,
    ),
  );
}

function fail(reason, extra = {}) {
  output(
    "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V2_REPAIR_FAILED",
    {
      reason,
      ...extra,
      safety: {
        databaseWrites: 0,
        orderCreation: false,
        positionChange: false,
        promotionChange: false,
        controlsChange: false,
        realTradingEnable: false,
      },
    },
  );

  process.exit(1);
}

if (!fs.existsSync(TARGET)) {
  fail(
    "TARGET_NOT_FOUND",
    {
      target:
        "lib/models/model-promotion-decision-service.ts",
    },
  );
}

let ts;

try {
  ts = require("typescript");
} catch (error) {
  fail(
    "TYPESCRIPT_NOT_AVAILABLE",
    {
      error:
        error instanceof Error
          ? error.message
          : String(error),
    },
  );
}

const original =
  fs.readFileSync(
    TARGET,
    "utf8",
  );

if (
  !original.includes(
    "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V1",
  )
) {
  fail(
    "V1_BINDING_MARKER_NOT_FOUND",
  );
}

if (
  !original.includes(
    "modelId.canonicalShadowOutcomeEvidenceReady",
  )
) {
  if (
    original.includes(
      ".canonicalShadowOutcomeEvidenceReady",
    ) &&
    !original.includes(
      "|| !modelId.canonicalShadowOutcomeEvidenceReady",
    )
  ) {
    output(
      "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V2_ALREADY_REPAIRED",
      {
        file:
          "lib/models/model-promotion-decision-service.ts",
        nextAction:
          "RUN_TYPECHECK_AND_FAIL_CLOSED_REGRESSION",
      },
    );
    process.exit(0);
  }

  fail(
    "EXPECTED_BAD_REFERENCE_NOT_FOUND",
  );
}

const sf =
  ts.createSourceFile(
    TARGET,
    original,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

let evaluateFn = null;

function visitForEvaluate(node) {
  if (evaluateFn) {
    return;
  }

  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    node.name.text ===
      "evaluateModelPromotionRecommendation"
  ) {
    evaluateFn = node;
    return;
  }

  ts.forEachChild(
    node,
    visitForEvaluate,
  );
}

visitForEvaluate(sf);

if (
  !evaluateFn ||
  !evaluateFn.body
) {
  fail(
    "EVALUATE_MODEL_PROMOTION_RECOMMENDATION_NOT_FOUND",
  );
}

const evidenceCandidates = [];

function unwrapAwait(node) {
  if (
    ts.isAwaitExpression(node)
  ) {
    return node.expression;
  }

  return node;
}

function visitForEvidence(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer
  ) {
    const init =
      unwrapAwait(
        node.initializer,
      );

    if (
      ts.isCallExpression(init) &&
      ts.isIdentifier(
        init.expression,
      ) &&
      init.expression.text ===
        "collectModelPromotionEvidence"
    ) {
      evidenceCandidates.push(
        node.name.text,
      );
    }
  }

  ts.forEachChild(
    node,
    visitForEvidence,
  );
}

visitForEvidence(
  evaluateFn.body,
);

const uniqueCandidates =
  [...new Set(
    evidenceCandidates,
  )];

if (
  uniqueCandidates.length !== 1
) {
  fail(
    "CANONICAL_EVIDENCE_VARIABLE_INCONCLUSIVE",
    {
      candidates:
        uniqueCandidates,
      functionSnippet:
        original.slice(
          evaluateFn.getStart(sf),
          Math.min(
            evaluateFn.end,
            evaluateFn.getStart(sf) +
              5000,
          ),
        ),
    },
  );
}

const evidenceVar =
  uniqueCandidates[0];

const exactBad =
  "(transition.allowed) || !modelId.canonicalShadowOutcomeEvidenceReady";

const exactGood =
  `(transition.allowed) && !${evidenceVar}.canonicalShadowOutcomeEvidenceReady`;

let patched =
  original;

if (
  patched.includes(
    exactBad,
  )
) {
  patched =
    patched.replace(
      exactBad,
      exactGood,
    );
} else {
  const badReference =
    "modelId.canonicalShadowOutcomeEvidenceReady";

  patched =
    patched.replace(
      badReference,
      `${evidenceVar}.canonicalShadowOutcomeEvidenceReady`,
    );

  const orPattern =
    `(transition.allowed) || !${evidenceVar}.canonicalShadowOutcomeEvidenceReady`;

  if (
    patched.includes(
      orPattern,
    )
  ) {
    patched =
      patched.replace(
        orPattern,
        `(transition.allowed) && !${evidenceVar}.canonicalShadowOutcomeEvidenceReady`,
      );
  }
}

if (
  patched.includes(
    "modelId.canonicalShadowOutcomeEvidenceReady",
  )
) {
  fail(
    "BAD_REFERENCE_STILL_PRESENT_AFTER_REPAIR",
  );
}

if (
  patched.includes(
    `(transition.allowed) || !${evidenceVar}.canonicalShadowOutcomeEvidenceReady`,
  )
) {
  fail(
    "BAD_OR_CONDITION_STILL_PRESENT_AFTER_REPAIR",
  );
}

if (
  !patched.includes(
    `(transition.allowed) && !${evidenceVar}.canonicalShadowOutcomeEvidenceReady`,
  )
) {
  fail(
    "EXPECTED_FAIL_CLOSED_AND_CONDITION_NOT_FOUND",
    {
      evidenceVariable:
        evidenceVar,
    },
  );
}

const repairedSf =
  ts.createSourceFile(
    TARGET,
    patched,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

const parseDiagnostics =
  repairedSf.parseDiagnostics || [];

if (
  parseDiagnostics.length > 0
) {
  fail(
    "REPAIRED_SOURCE_PARSE_FAILED",
    {
      diagnostics:
        parseDiagnostics.map(
          (diag) => ({
            start:
              diag.start,
            length:
              diag.length,
            message:
              ts.flattenDiagnosticMessageText(
                diag.messageText,
                "\n",
              ),
          }),
        ),
    },
  );
}

fs.mkdirSync(
  BACKUP_DIR,
  {
    recursive: true,
  },
);

if (
  !fs.existsSync(
    BUGGY_BACKUP,
  )
) {
  fs.writeFileSync(
    BUGGY_BACKUP,
    original,
    "utf8",
  );
}

fs.writeFileSync(
  TARGET,
  patched,
  "utf8",
);

const verifyScript = path.join(
  ROOT,
  "scripts",
  "model-promotion-canonical-evidence-reader-binding-v2-repair-verify.ts",
);

const verifySource = String.raw`
import fs from "fs";
import path from "path";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  collectModelPromotionEvidence,
} from "@/lib/models/model-promotion-decision-service";

const ROOT = process.cwd();

const serviceFile =
  path.join(
    ROOT,
    "lib",
    "models",
    "model-promotion-decision-service.ts",
  );

async function countRows(
  table: string,
): Promise<number> {
  const supabase =
    createSupabaseServerClient();

  const {
    count,
    error,
  } =
    await supabase
      .from(table)
      .select("*", {
        count: "exact",
        head: true,
      });

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

async function main() {
  const supabase =
    createSupabaseServerClient();

  const {
    data: model,
    error: modelError,
  } =
    await supabase
      .from("ai_model_versions")
      .select(
        "id,purpose,promotion_stage"
      )
      .eq(
        "purpose",
        "ENTRY_TIMING",
      )
      .eq(
        "promotion_stage",
        "SHADOW",
      )
      .limit(1)
      .maybeSingle();

  if (
    modelError ||
    !model
  ) {
    throw new Error(
      "SHADOW_MODEL_NOT_FOUND:" +
      (
        modelError?.message ??
        "NO_MODEL"
      ),
    );
  }

  const before = {
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
    await collectModelPromotionEvidence(
      model.id,
    );

  const after = {
    orders:
      await countRows(
        "paper_order_requests",
      ),
    positions:
      await countRows(
        "paper_positions",
      ),
  };

  const source =
    fs.readFileSync(
      serviceFile,
      "utf8",
    );

  const readyValue =
    (
      evidence as
        Record<string, unknown>
    )
      .canonicalShadowOutcomeEvidenceReady;

  const checks = {
    modelIsEntryTimingShadow:
      model.purpose ===
        "ENTRY_TIMING" &&
      model.promotion_stage ===
        "SHADOW",

    collectorReturnsCanonicalReadiness:
      typeof readyValue ===
        "boolean",

    currentCanonicalReadinessIsFalse:
      readyValue === false,

    badModelIdPropertyReferenceRemoved:
      !source.includes(
        "modelId.canonicalShadowOutcomeEvidenceReady",
      ),

    failClosedConditionUsesAnd:
      source.includes(
        "transition.allowed"
      ) &&
      source.includes(
        "&& !"
      ) &&
      source.includes(
        ".canonicalShadowOutcomeEvidenceReady",
      ),

    noOrdersCreated:
      before.orders ===
      after.orders,

    noPositionsChanged:
      before.positions ===
      after.positions,

    realTradingEnabledByScript:
      false,
  };

  const required = [
    "modelIsEntryTimingShadow",
    "collectorReturnsCanonicalReadiness",
    "currentCanonicalReadinessIsFalse",
    "badModelIdPropertyReferenceRemoved",
    "failClosedConditionUsesAnd",
    "noOrdersCreated",
    "noPositionsChanged",
  ] as const;

  const failed =
    required.filter(
      (key) =>
        !checks[key],
    );

  const report = {
    status:
      failed.length === 0
        ? "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V2_REPAIR_VERIFIED"
        : "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V2_REPAIR_FAILED",

    model: {
      id:
        model.id,
      purpose:
        model.purpose,
      promotionStage:
        model.promotion_stage,
    },

    canonicalShadowOutcomeEvidenceReady:
      readyValue,

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
        ? "RERUN_SHADOW_CANONICAL_EVIDENCE_FAIL_CLOSED_REGRESSION"
        : "STOP_AND_INSPECT_CANONICAL_READER_BINDING_REPAIR",
  };

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
            "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V2_REPAIR_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
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
  verifyScript,
  verifySource,
  "utf8",
);

output(
  "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V2_REPAIRED",
  {
    file:
      "lib/models/model-promotion-decision-service.ts",
    buggyBackup:
      "scripts/backups/model-promotion-decision-service.after-bad-canonical-reader-binding-v1.ts",
    generatedVerifyFile:
      "scripts/model-promotion-canonical-evidence-reader-binding-v2-repair-verify.ts",
    evidenceVariable:
      evidenceVar,
    repairedCondition:
      `(transition.allowed) && !${evidenceVar}.canonicalShadowOutcomeEvidenceReady`,
    safety: {
      databaseWrites: 0,
      orderCreation: false,
      positionChange: false,
      promotionChange: false,
      controlsChange: false,
      realTradingEnable: false,
    },
    nextAction:
      "RUN_V2_REPAIR_VERIFY",
  },
);
