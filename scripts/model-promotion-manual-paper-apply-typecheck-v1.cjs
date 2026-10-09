
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = process.cwd();

const TARGETS = [
  "lib/models/model-promotion-decision-service.ts",
  "lib/models/model-promotion-manual-apply.ts",
  "app/api/models/promotion/apply/route.ts",
  "scripts/model-promotion-manual-paper-apply-fail-closed-regression-v1.ts",
];

const files = TARGETS.map((rel) =>
  path.join(ROOT, rel),
);

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(
      JSON.stringify(
        {
          status:
            "MODEL_PROMOTION_MANUAL_PAPER_APPLY_TYPECHECK_V1_FAILED",
          reason:
            "TARGET_FILE_MISSING",
          file:
            path.relative(ROOT, file),
        },
        null,
        2,
      ),
    );

    process.exit(1);
  }
}

const compilerOptions = {
  target:
    ts.ScriptTarget.ES2022,

  module:
    ts.ModuleKind.ESNext,

  moduleResolution:
    ts.ModuleResolutionKind.Bundler,

  esModuleInterop:
    true,

  allowSyntheticDefaultImports:
    true,

  resolveJsonModule:
    true,

  strict:
    true,

  skipLibCheck:
    true,

  noEmit:
    true,

  jsx:
    ts.JsxEmit.Preserve,

  baseUrl:
    ROOT,

  paths: {
    "@/*": [
      "./*",
    ],
  },

  types: [
    "node",
  ],
};

const host =
  ts.createCompilerHost(
    compilerOptions,
    true,
  );

const program =
  ts.createProgram({
    rootNames:
      files,

    options:
      compilerOptions,

    host,
  });

const diagnostics = [
  ...program.getSyntacticDiagnostics(),
  ...program.getSemanticDiagnostics(),
];

const normalized =
  diagnostics.map(
    (diag) => {
      const file =
        diag.file
          ? path
              .relative(
                ROOT,
                diag.file.fileName,
              )
              .replace(
                /\\/g,
                "/",
              )
          : null;

      let line =
        null;

      let character =
        null;

      if (
        diag.file &&
        typeof diag.start ===
          "number"
      ) {
        const pos =
          diag.file
            .getLineAndCharacterOfPosition(
              diag.start,
            );

        line =
          pos.line + 1;

        character =
          pos.character + 1;
      }

      return {
        file,
        line,
        character,
        code:
          diag.code,

        category:
          ts.DiagnosticCategory[
            diag.category
          ],

        message:
          ts.flattenDiagnosticMessageText(
            diag.messageText,
            "\n",
          ),
      };
    },
  );

const targetSet =
  new Set(
    TARGETS,
  );

const targetDiagnostics =
  normalized.filter(
    (diag) =>
      diag.file &&
      targetSet.has(
        diag.file,
      ),
  );

const checks = {
  allTargetFilesExist:
    true,

  noSyntacticDiagnostics:
    normalized.filter(
      (diag) =>
        diag.category ===
          "Error" &&
        targetSet.has(
          diag.file,
        ) &&
        diag.code >= 1000 &&
        diag.code < 2000,
    ).length ===
    0,

  noTargetTypeErrors:
    targetDiagnostics.filter(
      (diag) =>
        diag.category ===
        "Error",
    ).length ===
    0,
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, value]) =>
        !value,
    )
    .map(
      ([key]) =>
        key,
    );

const report = {
  status:
    failed.length ===
    0
      ? "MODEL_PROMOTION_MANUAL_PAPER_APPLY_TYPECHECK_V1_VERIFIED"
      : "MODEL_PROMOTION_MANUAL_PAPER_APPLY_TYPECHECK_V1_FAILED",

  targets:
    TARGETS,

  diagnostics: {
    total:
      normalized.length,

    targetTotal:
      targetDiagnostics.length,

    targetErrors:
      targetDiagnostics.filter(
        (diag) =>
          diag.category ===
          "Error",
      ),

    firstGlobalDiagnostics:
      normalized
        .filter(
          (diag) =>
            !diag.file ||
            !targetSet.has(
              diag.file,
            ),
        )
        .slice(
          0,
          20,
        ),
  },

  checks,

  failed,

  safety: {
    sourceFilesModified:
      0,

    databaseReads:
      0,

    databaseWrites:
      0,

    promotionApplyExecuted:
      false,

    ordersCreated:
      0,

    positionsChanged:
      0,

    controlsChanged:
      false,

    realTradingEnabled:
      false,
  },

  nextGate:
    failed.length ===
    0
      ? "HARDEN_MANUAL_PROMOTION_EXPLICIT_CONFIRMATION_CONTRACT"
      : "PATCH_MANUAL_PROMOTION_TYPE_ERRORS_BEFORE_ANY_FURTHER_GOVERNANCE_WORK",
};

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);

process.exitCode =
  failed.length ===
  0
    ? 0
    : 1;
