const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET_REL =
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts";

const TARGET =
  path.join(
    ROOT,
    TARGET_REL
  );

function collect(
  lines,
  predicate,
  limit = 30
) {
  const out = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (
      predicate(
        lines[i],
        i
      )
    ) {
      out.push({
        line:
          i + 1,

        text:
          lines[i].trim(),
      });

      if (
        out.length >=
        limit
      ) {
        break;
      }
    }
  }

  return out;
}

function sliceWindow(
  lines,
  center,
  before = 8,
  after = 16
) {
  const start =
    Math.max(
      1,
      center - before
    );

  const end =
    Math.min(
      lines.length,
      center + after
    );

  const selected = [];

  for (
    let n = start;
    n <= end;
    n++
  ) {
    selected.push({
      line:
        n,

      text:
        lines[n - 1],
    });
  }

  return {
    startLine:
      start,

    endLine:
      end,

    lines:
      selected,
  };
}

if (
  !fs.existsSync(
    TARGET
  )
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFETY_AUDIT_V1_FAILED",

        reason:
          "PRODUCER_NOT_FOUND",
      },
      null,
      2
    )
  );

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      TARGET,
      "utf8"
    );

  const lines =
    source.split(/\r?\n/);

  const mainDefinitions =
    collect(
      lines,
      line =>
        /^\s*(?:export\s+)?(?:async\s+)?function\s+main\s*\(/.test(
          line
        )
    );

  const mainInvocations =
    collect(
      lines,
      line =>
        !/function\s+main\s*\(/.test(
          line
        ) &&
        (
          /\bmain\s*\(\s*\)\s*\.catch\s*\(/.test(
            line
          ) ||
          /^\s*(?:void\s+)?main\s*\(\s*\)\s*;?\s*$/.test(
            line
          ) ||
          /^\s*await\s+main\s*\(\s*\)\s*;?\s*$/.test(
            line
          )
        )
    );

  const importMetaGuards =
    collect(
      lines,
      line =>
        /import\.meta\.url|pathToFileURL|fileURLToPath/.test(
          line
        )
    );

  const requireMainGuards =
    collect(
      lines,
      line =>
        /require\.main\s*===\s*module|module\s*===\s*require\.main/.test(
          line
        )
    );

  const argvEntryGuards =
    collect(
      lines,
      line =>
        /process\.argv\s*\[\s*1\s*\]|process\.argv\.at\s*\(\s*1\s*\)/.test(
          line
        )
    );

  const nextExpectedDefinitions =
    collect(
      lines,
      line =>
        /export\s+function\s+nextExpectedKrxOpenDate\s*\(/.test(
          line
        )
    );

  const nextExpectedLine =
    nextExpectedDefinitions[0]
      ?.line ??
    null;

  const nextExpectedWindow =
    nextExpectedLine
      ? sliceWindow(
          lines,
          nextExpectedLine,
          5,
          22
        )
      : null;

  const mainCallLine =
    mainInvocations[0]
      ?.line ??
    null;

  const mainCallWindow =
    mainCallLine
      ? sliceWindow(
          lines,
          mainCallLine,
          12,
          12
        )
      : null;

  const hasEntrypointGuard =
    importMetaGuards.length >
      0 ||
    requireMainGuards.length >
      0 ||
    argvEntryGuards.length >
      0;

  const autoMainInvocation =
    mainInvocations.length >
      0;

  const importSafe =
    !autoMainInvocation ||
    hasEntrypointGuard;

  const nextExpectedLooksPure =
    Boolean(
      nextExpectedWindow &&
      nextExpectedWindow.lines.some(
        item =>
          /nextKrxTradingDate\s*\(/.test(
            item.text
          )
      ) &&
      !nextExpectedWindow.lines.some(
        item =>
          /(writeFile|insert\s*\(|update\s*\(|upsert\s*\(|delete\s*\(|fetch\s*\(|createClient|supabase)/i.test(
            item.text
          )
      )
    );

  const checks = {
    producerExists:
      true,

    mainDefinitionFound:
      mainDefinitions.length >
      0,

    topLevelMainInvocationFound:
      autoMainInvocation,

    entrypointGuardFound:
      hasEntrypointGuard,

    moduleImportSafe:
      importSafe,

    nextExpectedKrxOpenDateExportFound:
      nextExpectedDefinitions.length >
      0,

    nextExpectedKrxOpenDateLooksPure:
      nextExpectedLooksPure,
  };

  let readiness;

  if (
    importSafe &&
    nextExpectedLooksPure
  ) {
    readiness =
      "IMPORT_SAFE_PURE_EXPORT_WRAPPER_CAN_PROCEED";
  } else if (
    !importSafe &&
    nextExpectedLooksPure
  ) {
    readiness =
      "PURE_EXPORT_EXISTS_BUT_MODULE_IMPORT_UNSAFE_MAIN_AUTOEXECUTES";
  } else {
    readiness =
      "DO_NOT_IMPORT_PRODUCER_MODULE_YET";
  }

  const report = {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFETY_AUDIT_V1_COMPLETE",

    readiness,

    checks,

    evidence: {
      mainDefinitions,

      mainInvocations,

      importMetaGuards,

      requireMainGuards,

      argvEntryGuards,

      nextExpectedDefinitions,

      nextExpectedWindow,

      mainCallWindow,
    },

    safety: {
      sourceOnlyAudit:
        true,

      producerImported:
        false,

      producerExecuted:
        false,

      subprocessExecuted:
        false,

      databaseReads:
        0,

      databaseWrites:
        0,

      fileWrites:
        0,

      networkCalls:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    failed:
      [],

    nextGate:
      readiness ===
      "IMPORT_SAFE_PURE_EXPORT_WRAPPER_CAN_PROCEED"
        ? "IMPLEMENT_NON_EXECUTING_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1"
        : readiness ===
          "PURE_EXPORT_EXISTS_BUT_MODULE_IMPORT_UNSAFE_MAIN_AUTOEXECUTES"
        ? "ADD_IMPORT_SAFE_ENTRYPOINT_GUARD_TO_PRODUCER_BEFORE_WRAPPER_V1"
        : "INSPECT_NEXT_EXPECTED_KRX_OPEN_DATE_DEPENDENCIES_BEFORE_WRAPPER",
  };

  fs.mkdirSync(
    path.join(
      ROOT,
      "logs"
    ),
    {
      recursive:
        true,
    }
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "true-forward-oos-producer-import-safety-audit-v1.json"
    ),
    JSON.stringify(
      report,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        readiness:
          report.readiness,

        checks:
          report.checks,

        evidence: {
          mainDefinitions:
            report.evidence.mainDefinitions,

          mainInvocations:
            report.evidence.mainInvocations,

          importMetaGuards:
            report.evidence.importMetaGuards,

          requireMainGuards:
            report.evidence.requireMainGuards,

          argvEntryGuards:
            report.evidence.argvEntryGuards,

          nextExpectedDefinitions:
            report.evidence.nextExpectedDefinitions,
        },

        nextGate:
          report.nextGate,
      },
      null,
      2
    )
  );

  process.exitCode = 0;
}
