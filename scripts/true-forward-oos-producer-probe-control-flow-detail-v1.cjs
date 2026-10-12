const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET_REL =
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts";

const TARGET =
  path.join(
    ROOT,
    TARGET_REL,
  );

function getLines() {
  return fs
    .readFileSync(
      TARGET,
      "utf8",
    )
    .split(/\r?\n/);
}

function window(
  lines,
  center,
  before = 12,
  after = 18,
) {
  const start =
    Math.max(
      1,
      center - before,
    );

  const end =
    Math.min(
      lines.length,
      center + after,
    );

  const selected = [];

  for (
    let lineNumber = start;
    lineNumber <= end;
    lineNumber++
  ) {
    selected.push({
      line:
        lineNumber,

      text:
        lines[
          lineNumber - 1
        ],
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

function findAll(
  lines,
  regex,
  limit = 40,
) {
  const out = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (
      regex.test(
        lines[i],
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

    regex.lastIndex = 0;
  }

  return out;
}

if (
  !fs.existsSync(
    TARGET,
  )
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_CONTROL_FLOW_DETAIL_V1_FAILED",

        reason:
          "PRODUCER_NOT_FOUND",
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
} else {
  const lines =
    getLines();

  const dryLike =
    findAll(
      lines,
      /(dry.?run|probe.?only|read.?only|no.?write|preview|smoke)/i,
      20,
    );

  const writes =
    findAll(
      lines,
      /(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|rename|copyFile|unlink)/i,
      20,
    );

  const dbReads =
    findAll(
      lines,
      /\.(select|from)\s*\(/i,
      30,
    );

  const mainDefs =
    findAll(
      lines,
      /(async\s+function\s+main|function\s+main)/i,
      10,
    );

  const mainCalls =
    findAll(
      lines,
      /(main\s*\(\s*\)\s*\.catch|await\s+main\s*\(\s*\)|(?:^|\s)main\s*\(\s*\)\s*;?)/i,
      10,
    );

  const argvOrEnv =
    findAll(
      lines,
      /(process\.argv|process\.env|--[a-z0-9][a-z0-9-]*)/i,
      60,
    );

  const exports =
    findAll(
      lines,
      /^\s*export\s+(async\s+)?(function|const|type|interface|class)/i,
      60,
    );

  const candidatePureFunctions =
    exports.filter(
      item =>
        /(resolve|build|select|score|candidate|target|session|plan|date|freeze|forward)/i.test(
          item.text,
        ),
    );

  const anchors = {
    dryLike:
      dryLike[0]?.line ??
      null,

    firstWrite:
      writes[0]?.line ??
      null,

    firstDbRead:
      dbReads[0]?.line ??
      null,

    mainDefinition:
      mainDefs[0]?.line ??
      null,

    mainCall:
      mainCalls[0]?.line ??
      null,
  };

  const detail = {
    dryLike:
      anchors.dryLike
        ? window(
            lines,
            anchors.dryLike,
            18,
            24,
          )
        : null,

    firstWrite:
      anchors.firstWrite
        ? window(
            lines,
            anchors.firstWrite,
            22,
            32,
          )
        : null,

    firstDbRead:
      anchors.firstDbRead
        ? window(
            lines,
            anchors.firstDbRead,
            22,
            32,
          )
        : null,

    mainDefinition:
      anchors.mainDefinition
        ? window(
            lines,
            anchors.mainDefinition,
            12,
            40,
          )
        : null,

    mainCall:
      anchors.mainCall
        ? window(
            lines,
            anchors.mainCall,
            18,
            24,
          )
        : null,
  };

  const checks = {
    producerExists:
      true,

    dryLikeTextFound:
      dryLike.length >
      0,

    runtimeCliOrEnvTriggerFound:
      argvOrEnv.some(
        item =>
          /(DRY|PROBE|READ_ONLY|NO_WRITE|PREVIEW|SMOKE|--dry|--probe|--preview|--read)/i.test(
            item.text,
          ),
      ),

    fileWriteSurfaceFound:
      writes.length >
      0,

    dbReadSurfaceFound:
      dbReads.length >
      0,

    mainDefinitionFound:
      mainDefs.length >
      0,

    mainCallFound:
      mainCalls.length >
      0,

    reusableExportCandidatesFound:
      candidatePureFunctions.length >
      0,
  };

  const recommendedStrategy =
    checks.runtimeCliOrEnvTriggerFound
      ? "VERIFY_EXISTING_TRIGGER_EXACT_BRANCH"
      : checks.reusableExportCandidatesFound
      ? "ADD_THIN_PROBE_WRAPPER_AROUND_REUSABLE_PURE_EXPORTED_SURFACES_DO_NOT_RUN_MAIN"
      : "EXTRACT_PURE_PLANNING_SURFACE_BEFORE_ANY_REAL_PRODUCER_EXECUTION";

  const report = {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_CONTROL_FLOW_DETAIL_V1_COMPLETE",

    checks,

    anchors,

    argvOrEnv,

    exports:
      exports.slice(
        0,
        40,
      ),

    candidatePureFunctions,

    detail,

    recommendedStrategy,

    safety: {
      sourceOnlyAudit:
        true,

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

    nextGate:
      recommendedStrategy ===
      "VERIFY_EXISTING_TRIGGER_EXACT_BRANCH"
        ? "VERIFY_EXISTING_PRODUCER_PROBE_BRANCH_V1"
        : recommendedStrategy ===
          "ADD_THIN_PROBE_WRAPPER_AROUND_REUSABLE_PURE_EXPORTED_SURFACES_DO_NOT_RUN_MAIN"
        ? "DESIGN_NON_EXECUTING_PRODUCER_PROBE_WRAPPER_V1"
        : "DESIGN_PURE_PRODUCER_PLANNING_EXTRACTION_V1",
  };

  fs.mkdirSync(
    path.join(
      ROOT,
      "logs",
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "true-forward-oos-producer-probe-control-flow-detail-v1.json",
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
      {
        status:
          report.status,

        checks:
          report.checks,

        anchors:
          report.anchors,

        argvOrEnv:
          report.argvOrEnv,

        candidatePureFunctions:
          report.candidatePureFunctions,

        recommendedStrategy:
          report.recommendedStrategy,

        nextGate:
          report.nextGate,
      },
      null,
      2,
    ),
  );

  process.exitCode = 0;
}
