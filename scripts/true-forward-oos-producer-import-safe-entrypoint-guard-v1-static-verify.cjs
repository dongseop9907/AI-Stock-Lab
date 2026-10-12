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

if (!fs.existsSync(TARGET)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_STATIC_FAILED",
    failed: [
      "producerExists",
    ],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      TARGET,
      "utf8",
    );

  const guardIndex =
    source.indexOf(
      "export function isTrueForwardTop1DirectExecution("
    );

  const mainDefinitionIndex =
    source.indexOf(
      "async function main()"
    );

  const guardedMainIndex =
    source.indexOf(
      "if (isTrueForwardTop1DirectExecution())"
    );

  const mainCallIndex =
    source.indexOf(
      "main().catch(",
      Math.max(
        0,
        guardedMainIndex,
      ),
    );

  const checks = {
    producerExists:
      true,

    guardExportPresent:
      guardIndex >= 0,

    guardUsesArgv1:
      /isTrueForwardTop1DirectExecution[\s\S]{0,500}process\.argv\s*\[\s*1\s*\]/.test(
        source,
      ),

    guardUsesProducerFilename:
      source.includes(
        "alpha-v3-true-forward-top1-producer-v1.ts"
      ),

    guardUsesPathBasename:
      /path\.basename\s*\(/.test(
        source,
      ),

    guardBeforeMainDefinition:
      guardIndex >= 0 &&
      mainDefinitionIndex >= 0 &&
      guardIndex <
        mainDefinitionIndex,

    directExecutionIfPresent:
      guardedMainIndex >= 0,

    mainCallInsideGuardOrder:
      guardedMainIndex >= 0 &&
      mainCallIndex >= 0 &&
      guardedMainIndex <
        mainCallIndex,

    oldNakedMainPatternGone:
      !/\nmain\(\)\.catch\(/.test(
        source,
      ),

    pureCalendarExportStillPresent:
      source.includes(
        "export function nextExpectedKrxOpenDate("
      ),

    producerRuntimeExportStillPresent:
      source.includes(
        "export async function runTrueForwardTop1Producer("
      ),
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          value !== true,
      )
      .map(
        ([key]) =>
          key,
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_STATIC_FAILED",

    checks,

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_IMPORT_SMOKE_AND_FORWARD_OOS_REGRESSIONS"
        : "REPAIR_ENTRYPOINT_GUARD",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
