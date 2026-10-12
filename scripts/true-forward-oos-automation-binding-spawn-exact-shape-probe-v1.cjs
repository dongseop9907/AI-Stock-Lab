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

function collectMatches(
  lines,
  regex,
  before = 8,
  after = 14,
  limit = 20
) {
  const out = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (!regex.test(lines[i])) {
      continue;
    }

    const start =
      Math.max(
        0,
        i - before
      );

    const end =
      Math.min(
        lines.length - 1,
        i + after
      );

    const snippet = [];

    for (
      let n = start;
      n <= end;
      n++
    ) {
      snippet.push({
        line:
          n + 1,

        text:
          lines[n],
      });
    }

    out.push({
      matchLine:
        i + 1,

      matchText:
        lines[i],

      snippet,
    });

    if (
      out.length >=
      limit
    ) {
      break;
    }
  }

  return out;
}

if (!fs.existsSync(TARGET)) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_SPAWN_EXACT_SHAPE_PROBE_V1_FAILED",

        reason:
          "BINDING_NOT_FOUND",
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

  const result = {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_SPAWN_EXACT_SHAPE_PROBE_V1_COMPLETE",

    matches: {
      spawnSync:
        collectMatches(
          lines,
          /spawnSync/
        ),

      processExecPath:
        collectMatches(
          lines,
          /process\.execPath/
        ),

      runStep:
        collectMatches(
          lines,
          /\brunStep\b/
        ),

      producerTarget:
        collectMatches(
          lines,
          /alpha-v3-true-forward-top1-producer-v1\.ts/
        ),

      envFile:
        collectMatches(
          lines,
          /--env-file/
        ),

      tsxLoader:
        collectMatches(
          lines,
          /--import|tsx/
        ),
    },

    safety: {
      sourceOnly:
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

    nextGate:
      "PATCH_USING_EXACT_SPAWN_SHAPE_FROM_THIS_OUTPUT",
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
      "true-forward-oos-automation-binding-spawn-exact-shape-probe-v1.json"
    ),
    JSON.stringify(
      result,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  process.exitCode = 0;
}
