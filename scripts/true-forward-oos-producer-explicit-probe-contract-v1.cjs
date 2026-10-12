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

function lineNumberFromIndex(
  text,
  index,
) {
  if (index < 0) {
    return null;
  }

  return (
    text
      .slice(
        0,
        index,
      )
      .split(/\r?\n/)
      .length
  );
}

function collectMatches(
  text,
  regex,
  limit = 50,
) {
  const lines =
    text.split(/\r?\n/);

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

function contextsFor(
  text,
  matches,
  radius = 5,
) {
  const lines =
    text.split(/\r?\n/);

  return matches
    .slice(
      0,
      20,
    )
    .map(
      match => {
        const start =
          Math.max(
            0,
            match.line - 1 - radius,
          );

        const end =
          Math.min(
            lines.length,
            match.line + radius,
          );

        return {
          anchorLine:
            match.line,

          snippet:
            lines
              .slice(
                start,
                end,
              )
              .map(
                (
                  line,
                  offset,
                ) => ({
                  line:
                    start +
                    offset +
                    1,

                  text:
                    line,
                }),
              ),
        };
      },
    );
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_EXPLICIT_PROBE_CONTRACT_V1_FAILED",

        reason:
          "PRODUCER_NOT_FOUND",
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      TARGET,
      "utf8",
    );

  const dryRunMatches =
    collectMatches(
      source,
      /(dry.?run|probe.?only|read.?only|no.?write|preview|smoke)/i,
    );

  const argvMatches =
    collectMatches(
      source,
      /process\.argv|argv|--[a-z0-9][a-z0-9-]*/i,
      80,
    );

  const envMatches =
    collectMatches(
      source,
      /process\.env|[A-Z][A-Z0-9_]{4,}/,
      80,
    );

  const returnMatches =
    collectMatches(
      source,
      /\breturn\b/,
      80,
    );

  const writeMatches =
    collectMatches(
      source,
      /(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|rename|copyFile|unlink)/i,
      40,
    );

  const dbReadMatches =
    collectMatches(
      source,
      /\.(select|from)\s*\(/i,
      40,
    );

  const mainMatches =
    collectMatches(
      source,
      /(async\s+function\s+main|function\s+main|main\s*\(\s*\)|main\s*\(\s*\)\s*\.catch|await\s+main)/i,
      40,
    );

  const firstDryLine =
    dryRunMatches[0]
      ?.line ??
    null;

  const firstWriteLine =
    writeMatches[0]
      ?.line ??
    null;

  const firstDbReadLine =
    dbReadMatches[0]
      ?.line ??
    null;

  const firstMainCallLine =
    mainMatches
      .filter(
        item =>
          /main\s*\(\s*\)/i.test(
            item.text,
          ),
      )[0]
      ?.line ??
    null;

  const explicitCliFlagCandidates =
    argvMatches.filter(
      item =>
        /--[a-z0-9][a-z0-9-]*/i.test(
          item.text,
        ),
    );

  const explicitEnvFlagCandidates =
    envMatches.filter(
      item =>
        /(DRY|PROBE|READ_ONLY|NO_WRITE|PREVIEW|SMOKE)/i.test(
          item.text,
        ),
    );

  const hasExplicitTrigger =
    explicitCliFlagCandidates.length >
      0 ||
    explicitEnvFlagCandidates.length >
      0;

  const dryBeforeWrites =
    firstDryLine !==
      null &&
    (
      firstWriteLine ===
        null ||
      firstDryLine <
        firstWriteLine
    );

  const dryBeforeDbReads =
    firstDryLine !==
      null &&
    (
      firstDbReadLine ===
        null ||
      firstDryLine <
        firstDbReadLine
    );

  const possibleEarlyReturnNearDry =
    dryRunMatches.some(
      match =>
        returnMatches.some(
          ret =>
            ret.line >=
              match.line &&
            ret.line <=
              match.line +
                20,
        ),
    );

  const readiness =
    hasExplicitTrigger &&
    dryBeforeWrites &&
    possibleEarlyReturnNearDry
      ? "EXPLICIT_PROBE_TRIGGER_WITH_POSSIBLE_EARLY_RETURN_BEFORE_FILE_WRITE"
      : hasExplicitTrigger
      ? "EXPLICIT_PROBE_TRIGGER_FOUND_BUT_EARLY_RETURN_SAFETY_NOT_YET_PROVEN"
      : "DRY_RUN_LIKE_TEXT_FOUND_BUT_NO_CLEAR_RUNTIME_TRIGGER";

  const report = {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_EXPLICIT_PROBE_CONTRACT_V1_COMPLETE",

    readiness,

    checks: {
      producerExists:
        true,

      dryRunLikeSurfaceFound:
        dryRunMatches.length >
        0,

      explicitCliFlagCandidateFound:
        explicitCliFlagCandidates.length >
        0,

      explicitEnvFlagCandidateFound:
        explicitEnvFlagCandidates.length >
        0,

      explicitRuntimeTriggerFound:
        hasExplicitTrigger,

      drySurfaceBeforeFirstFileWrite:
        dryBeforeWrites,

      drySurfaceBeforeFirstDbRead:
        dryBeforeDbReads,

      possibleEarlyReturnNearDrySurface:
        possibleEarlyReturnNearDry,

      fileWriteSurfacePresent:
        writeMatches.length >
        0,

      dbReadSurfacePresent:
        dbReadMatches.length >
        0,

      autoMainCallSurfacePresent:
        firstMainCallLine !==
        null,
    },

    positions: {
      firstDryLikeLine:
        firstDryLine,

      firstFileWriteLine:
        firstWriteLine,

      firstDbReadLine:
        firstDbReadLine,

      firstMainCallLine,
    },

    candidates: {
      cliFlags:
        explicitCliFlagCandidates,

      envFlags:
        explicitEnvFlagCandidates,
    },

    evidence: {
      dryRunContexts:
        contextsFor(
          source,
          dryRunMatches,
          8,
        ),

      argvContexts:
        contextsFor(
          source,
          explicitCliFlagCandidates,
          5,
        ),

      envContexts:
        contextsFor(
          source,
          explicitEnvFlagCandidates,
          5,
        ),

      firstWriteContexts:
        contextsFor(
          source,
          writeMatches.slice(
            0,
            5,
          ),
          5,
        ),

      mainContexts:
        contextsFor(
          source,
          mainMatches.slice(
            0,
            5,
          ),
          5,
        ),
    },

    safety: {
      sourceOnlyAudit:
        true,

      producerExecuted:
        false,

      subprocessExecuted:
        false,

      networkCalls:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      filesWrittenByProducer:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      realTradingEnabled:
        false,
    },

    nextGate:
      readiness ===
      "EXPLICIT_PROBE_TRIGGER_WITH_POSSIBLE_EARLY_RETURN_BEFORE_FILE_WRITE"
        ? "VERIFY_EXACT_PROBE_BRANCH_CONTROL_FLOW_AND_OUTPUT_CONTRACT_V1"
        : "DO_NOT_EXECUTE_REAL_PRODUCER_INSPECT_EXPLICIT_PROBE_TRIGGER_CONTROL_FLOW",
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
      "true-forward-oos-producer-explicit-probe-contract-v1.json",
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

        readiness:
          report.readiness,

        checks:
          report.checks,

        positions:
          report.positions,

        candidates:
          report.candidates,

        nextGate:
          report.nextGate,
      },
      null,
      2,
    ),
  );

  process.exitCode = 0;
}
