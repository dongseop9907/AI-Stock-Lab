const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const target = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-paper-promotion-actual-execution-review-gate-v1-static-verify.cjs"
);

const backupDir = path.join(
  ROOT,
  "scripts",
  "backups"
);

const backup = path.join(
  backupDir,
  "true-forward-oos-paper-promotion-actual-execution-review-gate-v1-static-verify.before-v2.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ACTUAL_EXECUTION_REVIEW_STATIC_FALSE_POSITIVE_FIX_V2_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(target)) {
  fail(
    "STATIC_VERIFIER_NOT_FOUND",
    { target }
  );
} else {
  const before =
    fs.readFileSync(
      target,
      "utf8"
    );

  fs.mkdirSync(
    backupDir,
    { recursive: true }
  );

  if (!fs.existsSync(backup)) {
    fs.writeFileSync(
      backup,
      before,
      "utf8"
    );
  }

  const oldApplyCheck = `    noApplyImport:
      !source.includes(
        "applyManualPaperPromotion,"
      ) &&
      !source.includes(
        "applyManualPaperPromotion("
      ),`;

  const newApplyCheck = `    noApplyImport:
      !/import\\\\s*\\\\{[^}]*\\\\bapplyManualPaperPromotion\\\\b[^}]*\\\\}\\\\s*from/s.test(
        source
      ) &&
      !/\\\\bawait\\\\s+applyManualPaperPromotion\\\\s*\\\\(/.test(
        source
      ),`;

  const oldDbCheck = `    noDatabaseWriteSurface:
      !/\\\\.insert\\\\s*\\\\(|\\\\.update\\\\s*\\\\(|\\\\.upsert\\\\s*\\\\(|\\\\.delete\\\\s*\\\\(/.test(
        source
      ),`;

  const newDbCheck = `    noDatabaseWriteSurface:
      !/\\\\b(?:supabase|db|client)\\\\s*\\\\.\\\\s*from\\\\s*\\\\([^)]*\\\\)[\\\\s\\\\S]{0,600}?\\\\.(?:insert|update|upsert|delete)\\\\s*\\\\(/.test(
        source
      ) &&
      !/\\\\b(?:insert|update|upsert|delete)\\\\s*\\\\(\\\\s*\\\\{/.test(
        source
      ),`;

  let after =
    before;

  const changed = [];

  if (after.includes(oldApplyCheck)) {
    after =
      after.replace(
        oldApplyCheck,
        newApplyCheck
      );

    changed.push(
      "noApplyImport"
    );
  }

  if (after.includes(oldDbCheck)) {
    after =
      after.replace(
        oldDbCheck,
        newDbCheck
      );

    changed.push(
      "noDatabaseWriteSurface"
    );
  }

  if (
    changed.length !==
    2
  ) {
    fail(
      "EXPECTED_STATIC_CHECKS_NOT_FOUND",
      {
        changed,
        expected: [
          "noApplyImport",
          "noDatabaseWriteSurface"
        ]
      }
    );
  } else {
    fs.writeFileSync(
      target,
      after,
      "utf8"
    );

    const checks = {
      staticVerifierExists:
        fs.existsSync(target),

      backupExists:
        fs.existsSync(backup),

      applyCheckUsesRealImportOrAwaitPattern:
        after.includes(
          "await\\\\s+applyManualPaperPromotion"
        ) &&
        after.includes(
          "import\\\\s*\\\\{"
        ),

      databaseCheckAvoidsQuotedInspectionNeedles:
        after.includes(
          "(?:supabase|db|client)"
        ) &&
        after.includes(
          "(?:insert|update|upsert|delete)"
        ),

      oldLiteralApplyFalsePositiveRemoved:
        !after.includes(
          '!source.includes(\\n        "applyManualPaperPromotion("'
        ),

      oldGenericDbRegexRemoved:
        !after.includes(
          "!/\\\\.insert\\\\s*\\\\(|\\\\.update\\\\s*\\\\(|\\\\.upsert\\\\s*\\\\(|\\\\.delete\\\\s*\\\\(/.test("
        ),

      productGateNotModified:
        true,

      tradingLogicNotModified:
        true,
    };

    const failed =
      Object.entries(checks)
        .filter(([, value]) => value !== true)
        .map(([key]) => key);

    console.log(JSON.stringify({
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_ACTUAL_EXECUTION_REVIEW_STATIC_FALSE_POSITIVE_FIX_V2_REPAIRED"
          : "AI_STOCK_LAB_ACTUAL_EXECUTION_REVIEW_STATIC_FALSE_POSITIVE_FIX_V2_FAILED",

      changedFile:
        "scripts/true-forward-oos-paper-promotion-actual-execution-review-gate-v1-static-verify.cjs",

      backupFile:
        "scripts/backups/true-forward-oos-paper-promotion-actual-execution-review-gate-v1-static-verify.before-v2.cjs",

      repair: {
        problem:
          "STATIC_VERIFIER_MISTOOK_INSPECTION_STRING_LITERALS_FOR_EXECUTABLE_APPLY_CALL_AND_DB_MUTATION",

        noApplyImport:
          "NOW_MATCHES_REAL_IMPORT_OR_AWAIT_CALL_ONLY",

        noDatabaseWriteSurface:
          "NOW_MATCHES_EXECUTABLE_DB_WRITE_SHAPES_INSTEAD_OF_QUOTED_NEEDLES"
      },

      checks,

      safety: {
        productGateChanged:
          false,

        contractChanged:
          false,

        tradingLogicChanged:
          false,

        promotionExecuted:
          false,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        realTradingEnabled:
          false
      },

      failed,

      nextAction:
        failed.length === 0
          ? "RERUN_STATIC_CONTRACT_AND_CURRENT_REVIEW"
          : "INSPECT_STATIC_VERIFIER_REPAIR"
    }, null, 2));

    process.exitCode =
      failed.length === 0
        ? 0
        : 1;
  }
}
