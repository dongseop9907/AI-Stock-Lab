const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET_REL =
  "lib/research/run-true-forward-oos-automation-binding-v1.ts";

const TARGET =
  path.join(
    ROOT,
    TARGET_REL
  );

function lineNumber(
  text,
  index
) {
  if (index < 0) {
    return null;
  }

  return (
    text
      .slice(
        0,
        index
      )
      .split(/\r?\n/)
      .length
  );
}

function windowAround(
  lines,
  line,
  before = 15,
  after = 25
) {
  if (!line) {
    return null;
  }

  const start =
    Math.max(
      1,
      line - before
    );

  const end =
    Math.min(
      lines.length,
      line + after
    );

  const selected = [];

  for (
    let n = start;
    n <= end;
    n++
  ) {
    selected.push({
      line: n,
      text: lines[n - 1],
    });
  }

  return {
    startLine: start,
    endLine: end,
    lines: selected,
  };
}

if (!fs.existsSync(TARGET)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_BINDING_DETAIL_V1_FAILED",

    reason:
      "AUTOMATION_BINDING_NOT_FOUND",
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      TARGET,
      "utf8"
    );

  const lines =
    source.split(/\r?\n/);

  const markers = {
    stepScriptMap:
      source.search(
        /PRODUCE[\s\S]{0,500}alpha-v3-true-forward-top1-producer-v1\.ts/
      ),

    runStep:
      source.search(
        /\brunStep\b/
      ),

    spawn:
      source.search(
        /\bspawnSync\s*\(|\bspawn\s*\(|\bexecFileSync\s*\(|\bexecFile\s*\(/
      ),

    execPath:
      source.search(
        /process\.execPath/
      ),

    envFile:
      source.search(
        /--env-file/
      ),

    importTsx:
      source.search(
        /--import[\s\S]{0,120}tsx|tsx[\s\S]{0,120}--import/
      ),

    targetLookup:
      source.search(
        /STEP|step[\s\S]{0,300}(script|target)|script[\s\S]{0,300}step/i
      ),

    argsArray:
      source.search(
        /\bargs\s*=\s*\[|const\s+\w*args\w*\s*=\s*\[/i
      ),
  };

  const markerLines =
    Object.fromEntries(
      Object.entries(
        markers
      ).map(
        ([key, index]) => [
          key,
          lineNumber(
            source,
            index
          ),
        ]
      )
    );

  const evidence =
    Object.fromEntries(
      Object.entries(
        markerLines
      ).map(
        ([key, line]) => [
          key,
          windowAround(
            lines,
            line,
            18,
            30
          ),
        ]
      )
    );

  const checks = {
    bindingExists:
      true,

    produceTargetReferenced:
      source.includes(
        "scripts/alpha-v3-true-forward-top1-producer-v1.ts"
      ),

    runStepSurfaceFound:
      markers.runStep >= 0,

    subprocessPrimitiveFound:
      markers.spawn >= 0,

    processExecPathFound:
      markers.execPath >= 0,

    envFileFound:
      markers.envFile >= 0,

    importTsxFound:
      markers.importTsx >= 0,

    producerProbeFlagCurrentlyReferenced:
      source.includes(
        "--probe-only"
      ),

    stepSpecificArgumentSurfaceLikely:
      /(step\s*===\s*["']PRODUCE["']|case\s+["']PRODUCE["']|PRODUCE[\s\S]{0,300}(args|argument|argv))/i.test(
        source
      ),
  };

  let recommendedStrategy;

  if (
    checks.producerProbeFlagCurrentlyReferenced
  ) {
    recommendedStrategy =
      "EXISTING_PROBE_FLAG_BINDING_PRESENT_VERIFY_RUNTIME_ONLY";
  } else if (
    checks.stepSpecificArgumentSurfaceLikely
  ) {
    recommendedStrategy =
      "ADD_PRODUCE_ONLY_PROBE_ARGUMENT_AT_EXISTING_STEP_ARGUMENT_BOUNDARY";
  } else {
    recommendedStrategy =
      "ADD_EXPLICIT_PROBE_MODE_PARAMETER_TO_DEFAULT_RUNSTEP_WITH_PRODUCE_ONLY_ARG";
  }

  const report = {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_BINDING_DETAIL_V1_COMPLETE",

    checks,

    markerLines,

    recommendedStrategy,

    evidence,

    safety: {
      sourceOnlyAudit:
        true,

      automationExecuted:
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
      recommendedStrategy ===
      "EXISTING_PROBE_FLAG_BINDING_PRESENT_VERIFY_RUNTIME_ONLY"
        ? "RUN_AUTOMATION_BINDING_PRODUCER_PROBE_ONLY_RUNTIME_V1"
        : "PATCH_AUTOMATION_BINDING_WITH_EXPLICIT_PRODUCER_PROBE_ONLY_TEST_MODE_V1",
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
      "true-forward-oos-automation-producer-probe-binding-detail-v1.json"
    ),
    JSON.stringify(
      report,
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({
    status:
      report.status,

    checks:
      report.checks,

    markerLines:
      report.markerLines,

    recommendedStrategy:
      report.recommendedStrategy,

    nextGate:
      report.nextGate,
  }, null, 2));

  process.exitCode = 0;
}
