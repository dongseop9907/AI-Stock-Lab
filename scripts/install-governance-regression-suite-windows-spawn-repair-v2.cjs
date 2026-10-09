const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const RUNNER = path.join(ROOT, "scripts", "governance-regression-suite-v1.cjs");
const BACKUP_DIR = path.join(ROOT, "scripts", "backups");
const BACKUP = path.join(
  BACKUP_DIR,
  "governance-regression-suite-v1.before-windows-spawn-repair-v2.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_GOVERNANCE_REGRESSION_SUITE_WINDOWS_SPAWN_REPAIR_V2_FAILED",
    reason,
    ...extra
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(RUNNER)) {
  fail("GOVERNANCE_RUNNER_NOT_FOUND", { expected: "scripts/governance-regression-suite-v1.cjs" });
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

if (!fs.existsSync(BACKUP)) {
  fs.copyFileSync(RUNNER, BACKUP);
}

let source = fs.readFileSync(RUNNER, "utf8");

const oldBlock = `  if (file.name.endsWith(".cjs")) {
    command = process.execPath;
    args = [rel];
  } else {
    const preferred = "C:\\\\Program Files\\\\nodejs\\\\npx.cmd";
    command =
      process.platform === "win32" && fs.existsSync(preferred)
        ? preferred
        : process.platform === "win32"
          ? "npx.cmd"
          : "npx";
    args = ["tsx", "--env-file=.env.local", rel];
  }

  const r = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });`;

const newBlock = `  command = process.execPath;

  if (file.name.endsWith(".cjs")) {
    args = [rel];
  } else {
    args = [
      "--env-file=.env.local",
      "--import",
      "tsx",
      rel
    ];
  }

  const r = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });`;

if (!source.includes(oldBlock)) {
  fail("EXPECTED_WINDOWS_SPAWN_BLOCK_NOT_FOUND", {
    hint: "Runner may already be modified or differs from V1."
  });
}

source = source.replace(oldBlock, newBlock);

fs.writeFileSync(RUNNER, source, "utf8");

console.log(JSON.stringify({
  status: "AI_STOCK_LAB_GOVERNANCE_REGRESSION_SUITE_WINDOWS_SPAWN_REPAIR_V2_INSTALLED",
  repairedFile: "scripts/governance-regression-suite-v1.cjs",
  backup: "scripts/backups/governance-regression-suite-v1.before-windows-spawn-repair-v2.cjs",
  repair: {
    removedWindowsShellExecution: true,
    removedNpxCmdProgramFilesPathDependency: true,
    tsRunner: "node --env-file=.env.local --import tsx <script.ts>",
    cjsRunner: "node <script.cjs>",
    shell: false
  },
  safety: {
    databaseWrites: 0,
    productCodeChanges: 0,
    realTradingEnable: false
  },
  nextAction: "RUN_GOVERNANCE_SUITE_AGAIN"
}, null, 2));
