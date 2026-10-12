const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "lib",
  "research",
  "run-true-forward-oos-automation-binding-v1.ts"
);

const PACKAGE = path.join(
  ROOT,
  "package.json"
);

const BACKUP = path.join(
  ROOT,
  "scripts",
  "backups",
  "run-true-forward-oos-automation-binding-v1.before-producer-probe-test-mode-v2.ts"
);

const VERIFY = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-automation-producer-probe-test-mode-v2-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V2_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

function findMatching(text, openIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === openChar) {
      depth++;
      continue;
    }

    if (ch === closeChar) {
      depth--;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function splitTopLevelArgs(text) {
  const args = [];
  let start = 0;

  let paren = 0;
  let square = 0;
  let curly = 0;

  let quote = null;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "[") square++;
    else if (ch === "]") square--;
    else if (ch === "{") curly++;
    else if (ch === "}") curly--;

    if (
      ch === "," &&
      paren === 0 &&
      square === 0 &&
      curly === 0
    ) {
      args.push({
        start,
        end: i,
        text: text.slice(start, i),
      });

      start = i + 1;
    }
  }

  args.push({
    start,
    end: text.length,
    text: text.slice(start),
  });

  return args;
}

if (
  !fs.existsSync(TARGET) ||
  !fs.existsSync(PACKAGE)
) {
  fail("REQUIRED_FILES_MISSING", {
    bindingExists:
      fs.existsSync(TARGET),
    packageExists:
      fs.existsSync(PACKAGE),
  });
} else {
  let source =
    fs.readFileSync(
      TARGET,
      "utf8"
    );

  fs.mkdirSync(
    path.dirname(BACKUP),
    { recursive: true }
  );

  if (!fs.existsSync(BACKUP)) {
    fs.copyFileSync(
      TARGET,
      BACKUP
    );
  }

  const marker =
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V2";

  let changed = false;

  if (!source.includes(marker)) {
    let searchFrom = 0;
    let selected = null;

    while (true) {
      const callStart =
        source.indexOf(
          "spawnSync(",
          searchFrom
        );

      if (callStart < 0) {
        break;
      }

      const openParen =
        source.indexOf(
          "(",
          callStart
        );

      const closeParen =
        findMatching(
          source,
          openParen,
          "(",
          ")"
        );

      if (closeParen < 0) {
        fail(
          "SPAWNSYNC_PAREN_MATCH_FAILED",
          { callStart }
        );
        break;
      }

      const inside =
        source.slice(
          openParen + 1,
          closeParen
        );

      const args =
        splitTopLevelArgs(
          inside
        );

      if (
        args.length >= 2 &&
        args[0].text.includes(
          "process.execPath"
        )
      ) {
        selected = {
          callStart,
          openParen,
          closeParen,
          inside,
          args,
        };
        break;
      }

      searchFrom =
        closeParen + 1;
    }

    if (
      process.exitCode !== 1 &&
      !selected
    ) {
      fail(
        "PROCESS_EXECPATH_SPAWNSYNC_CALL_NOT_FOUND"
      );
    }

    if (
      process.exitCode !== 1 &&
      selected
    ) {
      const second =
        selected.args[1];

      const secondTrimmed =
        second.text.trim();

      if (!secondTrimmed) {
        fail(
          "SPAWNSYNC_SECOND_ARGUMENT_EMPTY"
        );
      } else {
        const wrapped = `
        (
          step === "PRODUCE" &&
          process.env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY === "true"
            ? [
                ...(${secondTrimmed}),
                "--probe-only",
              ]
            : (${secondTrimmed})
        ) /* ${marker} */`;

        const newInside =
          selected.inside.slice(
            0,
            second.start
          ) +
          wrapped +
          selected.inside.slice(
            second.end
          );

        source =
          source.slice(
            0,
            selected.openParen + 1
          ) +
          newInside +
          source.slice(
            selected.closeParen
          );

        changed = true;
      }
    }
  }

  if (process.exitCode !== 1) {
    fs.writeFileSync(
      TARGET,
      source,
      "utf8"
    );

    const verifier = `const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "lib",
  "research",
  "run-true-forward-oos-automation-binding-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V2_STATIC_FAILED",
    failed: ["bindingExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const marker =
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V2";

  const checks = {
    bindingExists:
      true,

    markerPresent:
      source.includes(marker),

    processExecPathPresent:
      source.includes("process.execPath"),

    produceOnlyGuardPresent:
      source.includes('step === "PRODUCE"'),

    explicitEnvFlagPresent:
      source.includes(
        "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY"
      ),

    exactTrueRequired:
      /FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY\\s*===\\s*"true"/.test(
        source
      ),

    probeOnlyFlagPresent:
      source.includes("--probe-only"),

    defaultPathPreserved:
      /:\\s*\\([^\\n]*\\)|:\\s*\\([\\s\\S]{0,300}\\)/.test(
        source
      ),

    collectNotExplicitlyTargeted:
      !/step\\s*===\\s*"COLLECT"[\\s\\S]{0,250}--probe-only/.test(
        source
      ),

    evaluateNotExplicitlyTargeted:
      !/step\\s*===\\s*"EVALUATE"[\\s\\S]{0,250}--probe-only/.test(
        source
      ),

    summaryNotExplicitlyTargeted:
      !/step\\s*===\\s*"SUMMARY"[\\s\\S]{0,250}--probe-only/.test(
        source
      ),

    realTradingNotEnabled:
      !/(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\\s*[:=]\\s*["']true["']/i.test(
        source
      ),
  };

  const failed =
    Object.entries(checks)
      .filter(([, value]) => value !== true)
      .map(([key]) => key);

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V2_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V2_STATIC_FAILED",

    checks,

    failed,

    nextGate:
      failed.length === 0
        ? "VERIFY_AUTOMATION_DEFAULT_RUNSTEP_REACHES_REAL_PRODUCER_PROBE_ONLY_BOUNDARY_V1"
        : "REPAIR_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V2",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

    fs.writeFileSync(
      VERIFY,
      verifier,
      "utf8"
    );

    let pkg;

    try {
      pkg =
        JSON.parse(
          fs.readFileSync(
            PACKAGE,
            "utf8"
          )
        );
    } catch (error) {
      fail(
        "PACKAGE_JSON_PARSE_FAILED",
        {
          error:
            String(
              error instanceof Error
                ? error.message
                : error
            ),
        }
      );
    }

    if (pkg) {
      pkg.scripts ||= {};

      pkg.scripts[
        "test:true-forward-oos-automation-producer-probe-test-mode-v2-static"
      ] =
        "node ./scripts/true-forward-oos-automation-producer-probe-test-mode-v2-static-verify.cjs";

      fs.writeFileSync(
        PACKAGE,
        JSON.stringify(
          pkg,
          null,
          2
        ) + "\n",
        "utf8"
      );

      console.log(JSON.stringify({
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V2_INSTALLED",

        changed,

        target:
          "lib/research/run-true-forward-oos-automation-binding-v1.ts",

        backup:
          "scripts/backups/run-true-forward-oos-automation-binding-v1.before-producer-probe-test-mode-v2.ts",

        trigger:
          "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY=true",

        behavior: {
          default:
            "UNCHANGED",
          produceProbeMode:
            "APPENDS_--probe-only",
          collect:
            "UNCHANGED",
          evaluate:
            "UNCHANGED",
          summary:
            "UNCHANGED",
        },

        safety: {
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
          ordersCreated:
            0,
          positionsChanged:
            0,
          realTradingEnabled:
            false,
        },

        nextAction:
          "RUN_V2_STATIC_AND_EXISTING_REGRESSIONS",
      }, null, 2));

      process.exitCode = 0;
    }
  }
}
