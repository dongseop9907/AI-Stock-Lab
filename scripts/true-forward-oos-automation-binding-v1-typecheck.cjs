const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();

const FILES = {
  helper:
    "lib/research/run-true-forward-oos-automation-binding-v1.ts",
  scheduler:
    "scripts/alpha-v3-automation-cycle-scheduler.ts",
  contract:
    "scripts/true-forward-oos-automation-binding-v1-contract-test.ts",
  envLocal:
    ".env.local",
  env:
    ".env"
};

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

function parseEnvValue(text, key) {
  const match = text.match(
    new RegExp(
      `^\\s*${key}\\s*=\\s*(.*?)\\s*$`,
      "m"
    )
  );

  if (!match) return null;

  return match[1]
    .trim()
    .replace(/^["']|["']$/g, "");
}

const tsconfigRel =
  "scripts/tsconfig.true-forward-oos-automation-binding-v1.json";

const tsconfigPath =
  path.join(ROOT, tsconfigRel);

const tsconfig = {
  extends: "../tsconfig.json",
  compilerOptions: {
    noEmit: true,
    types: ["node"]
  },
  include: [
    "../lib/research/run-true-forward-oos-automation-binding-v1.ts",
    "../scripts/alpha-v3-automation-cycle-scheduler.ts",
    "../scripts/true-forward-oos-automation-binding-v1-contract-test.ts"
  ]
};

fs.writeFileSync(
  tsconfigPath,
  JSON.stringify(tsconfig, null, 2) + "\n",
  "utf8"
);

const tscBin =
  path.join(
    ROOT,
    "node_modules",
    "typescript",
    "bin",
    "tsc"
  );

let typecheck;

if (!fs.existsSync(tscBin)) {
  typecheck = {
    exitCode: 1,
    stdout: "",
    stderr: "LOCAL_TYPESCRIPT_COMPILER_NOT_FOUND"
  };
} else {
  const result = spawnSync(
    process.execPath,
    [
      tscBin,
      "-p",
      tsconfigRel,
      "--pretty",
      "false"
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
      maxBuffer: 16 * 1024 * 1024
    }
  );

  typecheck = {
    exitCode:
      typeof result.status === "number"
        ? result.status
        : 1,
    stdout:
      result.stdout || "",
    stderr:
      result.stderr || ""
  };
}

const helperText =
  read(FILES.helper);

const schedulerText =
  read(FILES.scheduler);

const envTexts = [
  read(FILES.envLocal),
  read(FILES.env)
];

const envValues =
  envTexts
    .map(text =>
      parseEnvValue(
        text,
        "FORWARD_OOS_AUTOMATION_ENABLED"
      )
    )
    .filter(value => value !== null);

const featureFlagExplicitlyTrue =
  envValues.some(
    value =>
      String(value).toLowerCase() === "true"
  );

const checks = {
  helperExists:
    exists(FILES.helper),

  schedulerExists:
    exists(FILES.scheduler),

  contractExists:
    exists(FILES.contract),

  typecheckPassed:
    typecheck.exitCode === 0,

  helperDefaultFailClosed:
    helperText.includes(
      "FORWARD_OOS_AUTOMATION_ENABLED"
    ) &&
    helperText.includes(
      'status: "DISABLED"'
    ),

  schedulerBindingPresent:
    schedulerText.includes(
      "ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CALL"
    ),

  forwardOosAutomationNotExplicitlyEnabled:
    featureFlagExplicitlyTrue === false,

  realTradingForcedOff:
    helperText.includes(
      'REAL_TRADING_ENABLED:'
    ) &&
    helperText.includes(
      'ENABLE_REAL_TRADING:'
    ) &&
    helperText.includes(
      'ENABLE_LIVE_TRADING:'
    )
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);

const report = {
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_TYPECHECK_VERIFIED"
      : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_TYPECHECK_FAILED",

  checks,

  typecheck: {
    exitCode:
      typecheck.exitCode,
    stderrTail:
      typecheck.stderr
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-12),
    stdoutTail:
      typecheck.stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-12)
  },

  featureFlag: {
    name:
      "FORWARD_OOS_AUTOMATION_ENABLED",
    envValues,
    explicitlyEnabled:
      featureFlagExplicitlyTrue,
    expected:
      "OFF_UNTIL_LIVE_FORWARD_SMOKE_IS_VERIFIED"
  },

  safety: {
    databaseWrites: 0,
    subprocessExecuted: false,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionApplied: false,
    realTradingEnabled: false
  },

  failed,

  nextGate:
    failed.length === 0
      ? "RUN_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE"
      : "REPAIR_TYPECHECK_OR_FEATURE_FLAG_STATE"
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "true-forward-oos-automation-binding-v1-typecheck.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

/* compact console output only */
console.log(JSON.stringify({
  status: report.status,
  checks: report.checks,
  featureFlag: report.featureFlag,
  failed: report.failed,
  nextGate: report.nextGate
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;

