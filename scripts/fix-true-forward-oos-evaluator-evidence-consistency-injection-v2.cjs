const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const GATE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-evaluator-evidence-consistency-gate-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-evaluator-evidence-consistency-gate-v1-contract-test.ts"
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_INJECTION_V2_REPAIR_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (
  !fs.existsSync(GATE) ||
  !fs.existsSync(CONTRACT)
) {
  fail("REQUIRED_FILES_MISSING", {
    gateExists:
      fs.existsSync(GATE),
    contractExists:
      fs.existsSync(CONTRACT),
  });
} else {
  fs.mkdirSync(
    BACKUP_DIR,
    {
      recursive: true,
    }
  );

  const backup = path.join(
    BACKUP_DIR,
    "true-forward-oos-evaluator-evidence-consistency-gate-v1.before-injection-v2.ts"
  );

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(
      GATE,
      backup
    );
  }

  let source =
    fs.readFileSync(
      GATE,
      "utf8"
    );

  const helperMarker =
    "function readEvidenceSource(";

  if (
    !source.includes(
      helperMarker
    )
  ) {
    const anchor =
`function finite(
  value: unknown,
): number | null {`;

    const helper =
`function readEvidenceSource(
  input: EvidenceConsistencyInput,
  key:
    | "observationsDocument"
    | "evaluatorReport"
    | "summaryReport",
  diskFile: string,
) {
  const injected =
    Object.prototype.hasOwnProperty.call(
      input,
      key,
    );

  if (!injected) {
    return readJsonIfExists(
      diskFile,
    );
  }

  const value =
    input[key];

  if (value === undefined) {
    return {
      exists:
        false,
      value:
        null,
      injected:
        true,
    };
  }

  return {
    exists:
      true,
    value,
    injected:
      true,
  };
}

`;

    if (
      !source.includes(
        anchor
      )
    ) {
      fail(
        "HELPER_INSERT_ANCHOR_NOT_FOUND"
      );
    } else {
      source =
        source.replace(
          anchor,
          helper + anchor
        );
    }
  }

  if (
    process.exitCode !== 1
  ) {
    const start =
      source.indexOf(
        "  const observationRead ="
      );

    const end =
      source.indexOf(
        "  const observations =",
        start
      );

    if (
      start < 0 ||
      end < 0 ||
      end <= start
    ) {
      fail(
        "EVIDENCE_READ_BLOCK_NOT_FOUND",
        {
          start,
          end,
        }
      );
    } else {
      const replacement =
`  const observationRead =
    readEvidenceSource(
      input,
      "observationsDocument",
      TRUE_FORWARD_OBSERVATION_FILE,
    );

  const evaluatorRead =
    readEvidenceSource(
      input,
      "evaluatorReport",
      TRUE_FORWARD_EVALUATOR_FILE,
    );

  const summaryRead =
    readEvidenceSource(
      input,
      "summaryReport",
      TRUE_FORWARD_SUMMARY_FILE,
    );

`;

      source =
        source.slice(
          0,
          start
        ) +
        replacement +
        source.slice(
          end
        );

      fs.writeFileSync(
        GATE,
        source,
        "utf8"
      );

      const checks = {
        gateExists:
          fs.existsSync(
            GATE
          ),

        backupExists:
          fs.existsSync(
            backup
          ),

        ownPropertySemantics:
          source.includes(
            "Object.prototype.hasOwnProperty.call"
          ),

        explicitUndefinedMeansMissing:
          source.includes(
            "if (value === undefined)"
          ) &&
          source.includes(
            "exists:"
          ) &&
          source.includes(
            "false"
          ),

        diskFallbackOnlyWhenNotInjected:
          source.includes(
            "if (!injected)"
          ) &&
          source.includes(
            "return readJsonIfExists"
          ),

        observationUsesHelper:
          source.includes(
            '"observationsDocument",'
          ),

        evaluatorUsesHelper:
          source.includes(
            '"evaluatorReport",'
          ),

        summaryUsesHelper:
          source.includes(
            '"summaryReport",'
          ),

        noTradingEnable:
          !/(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\s*[:=]\s*["']true["']/i.test(
            source
          ),

        noPromotionExecution:
          !/applyPromotion|promoteModel|executePromotion/i.test(
            source
          ),
      };

      const failed =
        Object.entries(
          checks
        )
          .filter(
            ([, value]) =>
              value !== true
          )
          .map(
            ([key]) =>
              key
          );

      console.log(JSON.stringify({
        status:
          failed.length === 0
            ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_INJECTION_V2_REPAIRED"
            : "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_INJECTION_V2_REPAIR_FAILED",

        changedFile:
          "scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1.ts",

        backupFile:
          "scripts/backups/true-forward-oos-evaluator-evidence-consistency-gate-v1.before-injection-v2.ts",

        repair: {
          problem:
            "EXPLICIT_UNDEFINED_WAS_TREATED_AS_NO_INJECTION_AND_FELL_BACK_TO_DISK",

          newSemantics: {
            propertyAbsent:
              "READ_DISK",

            propertyPresentUndefined:
              "TREAT_AS_MISSING_SOURCE",

            propertyPresentNull:
              "TREAT_AS_PRESENT_BUT_INVALID_SOURCE",

            propertyPresentValue:
              "USE_INJECTED_VALUE"
          }
        },

        checks,

        safety: {
          productTradingLogicChanged:
            false,

          evaluatorExecuted:
            false,

          summaryExecuted:
            false,

          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          realTradingEnabled:
            false,

          promotionExecuted:
            false
        },

        failed,

        nextAction:
          failed.length === 0
            ? "RERUN_STATIC_CONTRACT_AND_CURRENT_GATE"
            : "STOP_AND_INSPECT_REPAIR"
      }, null, 2));

      process.exitCode =
        failed.length === 0
          ? 0
          : 1;
    }
  }
}
