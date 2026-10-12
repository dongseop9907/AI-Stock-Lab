const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const PROBE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-collector-cli-maturity-binding-probe-v1.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_COLLECTOR_CLI_MATURITY_BINDING_PROBE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
  "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
  "lib/trading/krx-trading-calendar.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(ROOT, rel)
      )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    { missing }
  );
} else {
  const probeSource = String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const FILES = {
  collector:
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",

  maturityGate:
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",

  maturityAudit:
    "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",

  krxCalendar:
    "lib/trading/krx-trading-calendar.ts",
};

function read(rel) {
  return fs.readFileSync(
    path.join(
      ROOT,
      rel,
    ),
    "utf8",
  );
}

function lineHits(
  source,
  patterns,
) {
  const lines =
    source.split(/\r?\n/);

  const out = {};

  for (
    const pattern of patterns
  ) {
    const matches = [];

    for (
      let i = 0;
      i < lines.length;
      i++
    ) {
      if (
        lines[i]
          .toLowerCase()
          .includes(
            pattern.toLowerCase(),
          )
      ) {
        matches.push({
          line:
            i + 1,

          text:
            lines[i],
        });
      }

      if (
        matches.length >=
        20
      ) {
        break;
      }
    }

    if (
      matches.length > 0
    ) {
      out[pattern] =
        matches;
    }
  }

  return out;
}

function snippetAround(
  source,
  pattern,
  radius = 6,
) {
  const lines =
    source.split(/\r?\n/);

  const index =
    lines.findIndex(
      line =>
        line
          .toLowerCase()
          .includes(
            pattern.toLowerCase(),
          )
    );

  if (
    index < 0
  ) {
    return [];
  }

  const start =
    Math.max(
      0,
      index - radius,
    );

  const end =
    Math.min(
      lines.length - 1,
      index + radius,
    );

  return lines
    .slice(
      start,
      end + 1,
    )
    .map(
      (text, offset) => ({
        line:
          start +
          offset +
          1,

        text,
      })
    );
}

const collector =
  read(
    FILES.collector,
  );

const maturityGate =
  read(
    FILES.maturityGate,
  );

const maturityAudit =
  read(
    FILES.maturityAudit,
  );

const krxCalendar =
  read(
    FILES.krxCalendar,
  );

const collectorPatterns = [
  "process.argv",
  "--horizon",
  "horizon",
  "r1",
  "r3",
  "r5",
  "directReturns",
  "selectedPolicy",
  "targetSessionDate",
  "sourceTradingDate",
  "observedAt",
  "mature",
  "maturity",
  "addDays",
  "setDate",
  "86400000",
  "24 * 60 * 60 * 1000",
  "krx",
  "trading calendar",
  "isKrx",
  "nextKrx",
  "previousKrx",
  "alpha-v3-entry-v3-forward-oos-observations.json",
];

const gatePatterns = [
  "--horizon",
  "spawn",
  "exec",
  "collector",
  "1D",
  "3D",
  "5D",
  "mature",
  "maturity",
];

const auditPatterns = [
  "1D",
  "3D",
  "5D",
  "setDate",
  "addDays",
  "86400000",
  "24 * 60 * 60 * 1000",
  "krx",
  "trading",
  "sourceTradingDate",
  "targetSessionDate",
  "mature",
];

const collectorHasProcessArgv =
  collector.includes(
    "process.argv"
  );

const collectorHasHorizonArg =
  collector.includes(
    "--horizon"
  );

const gatePassesHorizonArg =
  maturityGate.includes(
    "--horizon"
  );

const collectorImportsKrxCalendar =
  /from\s+["'][^"']*krx-trading-calendar[^"']*["']/.test(
    collector
  ) ||
  /require\s*\(\s*["'][^"']*krx-trading-calendar[^"']*["']\s*\)/.test(
    collector
  );

const maturityAuditImportsKrxCalendar =
  /from\s+["'][^"']*krx-trading-calendar[^"']*["']/.test(
    maturityAudit
  ) ||
  /require\s*\(\s*["'][^"']*krx-trading-calendar[^"']*["']\s*\)/.test(
    maturityAudit
  );

const collectorUsesCalendarDayArithmetic =
  /setDate\s*\(/.test(
    collector
  ) ||
  /86400000/.test(
    collector
  ) ||
  /24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(
    collector
  );

const maturityAuditUsesCalendarDayArithmetic =
  /setDate\s*\(/.test(
    maturityAudit
  ) ||
  /86400000/.test(
    maturityAudit
  ) ||
  /24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(
    maturityAudit
  );

const collectorMentionsR1R3R5 =
  collector.includes(
    "r1"
  ) &&
  collector.includes(
    "r3"
  ) &&
  collector.includes(
    "r5"
  );

const collectorWritesObservationFile =
  collector.includes(
    "alpha-v3-entry-v3-forward-oos-observations.json"
  );

const likelyCliBindingMismatch =
  gatePassesHorizonArg &&
  !collectorHasHorizonArg;

const likelyMaturitySemanticMismatch =
  maturityAuditUsesCalendarDayArithmetic &&
  !maturityAuditImportsKrxCalendar;

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_COLLECTOR_CLI_MATURITY_BINDING_PROBE_V1_COMPLETE",

  mode:
    "READ_ONLY_SOURCE_PROBE",

  files:
    FILES,

  collectorCli: {
    processArgvPresent:
      collectorHasProcessArgv,

    horizonFlagPresent:
      collectorHasHorizonArg,

    maturityGatePassesHorizonFlag:
      gatePassesHorizonArg,

    likelyCliBindingMismatch,
  },

  collectorOutcomeSemantics: {
    r1r3r5Present:
      collectorMentionsR1R3R5,

    directReturnsPresent:
      collector.includes(
        "directReturns"
      ),

    selectedPolicyPresent:
      collector.includes(
        "selectedPolicy"
      ),

    sourceTradingDatePresent:
      collector.includes(
        "sourceTradingDate"
      ),

    targetSessionDatePresent:
      collector.includes(
        "targetSessionDate"
      ),

    observationOutputPresent:
      collectorWritesObservationFile,
  },

  maturitySemantics: {
    collectorImportsKrxCalendar,
    maturityAuditImportsKrxCalendar,

    collectorUsesCalendarDayArithmetic,
    maturityAuditUsesCalendarDayArithmetic,

    likelyMaturitySemanticMismatch,

    krxCalendarSourceExists:
      krxCalendar.length >
      0,
  },

  sourceEvidence: {
    collector:
      lineHits(
        collector,
        collectorPatterns,
      ),

    maturityGate:
      lineHits(
        maturityGate,
        gatePatterns,
      ),

    maturityAudit:
      lineHits(
        maturityAudit,
        auditPatterns,
      ),

    keySnippets: {
      collectorProcessArgv:
        snippetAround(
          collector,
          "process.argv",
        ),

      collectorHorizon:
        snippetAround(
          collector,
          "--horizon",
        ),

      collectorR1:
        snippetAround(
          collector,
          "r1",
        ),

      maturityGateHorizon:
        snippetAround(
          maturityGate,
          "--horizon",
        ),

      maturityAudit1D:
        snippetAround(
          maturityAudit,
          "1D",
        ),

      maturityAuditCalendarArithmetic:
        snippetAround(
          maturityAudit,
          "86400000",
        ),
    },
  },

  safety: {
    sourceOnly:
      true,

    collectorExecuted:
      false,

    evaluatorExecuted:
      false,

    summaryExecuted:
      false,

    networkRequests:
      0,

    databaseReads:
      0,

    databaseWrites:
      0,

    fileWritesExceptProbeReport:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    promotionExecuted:
      false,

    realTradingEnabled:
      false,
  },

  nextGate:
    likelyCliBindingMismatch ||
    likelyMaturitySemanticMismatch
      ? "REPAIR_COLLECTOR_BINDING_OR_KRX_MATURITY_SEMANTICS_BEFORE_FIRST_REAL_FORWARD_SESSION"
      : "VERIFY_REAL_COLLECTOR_BINDING_CONTRACT_BEFORE_FIRST_REAL_FORWARD_SESSION",
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
    "true-forward-oos-collector-cli-maturity-binding-probe-v1.json",
  ),
  JSON.stringify(
    report,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);

process.exitCode = 0;
`;

  fs.writeFileSync(
    PROBE,
    probeSource,
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
      "test:true-forward-oos-collector-cli-maturity-binding-probe"
    ] =
      "node ./scripts/true-forward-oos-collector-cli-maturity-binding-probe-v1.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_COLLECTOR_CLI_MATURITY_BINDING_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/true-forward-oos-collector-cli-maturity-binding-probe-v1.cjs",

      productSourceChanges:
        0,

      purpose:
        "VERIFY_REAL_COLLECTOR_CLI_HORIZON_BINDING_AND_1D_3D_5D_KRX_MATURITY_SEMANTICS_BEFORE_FIRST_REAL_FORWARD_CAPTURE",

      inspects: [
        "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
        "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
        "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
        "lib/trading/krx-trading-calendar.ts"
      ],

      safety: {
        installerExecutedCollector:
          false,

        collectorExecuted:
          false,

        evaluatorExecuted:
          false,

        networkRequests:
          0,

        databaseReads:
          0,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        promotionExecuted:
          false,

        realTradingEnabled:
          false
      },

      nextAction:
        "RUN_READ_ONLY_COLLECTOR_CLI_MATURITY_BINDING_PROBE"
    }, null, 2));

    process.exitCode = 0;
  }
}
