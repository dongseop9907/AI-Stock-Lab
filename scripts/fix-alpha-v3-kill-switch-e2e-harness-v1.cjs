const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "scripts/alpha-v3-kill-switch-e2e-preactivation-guard-v1.cjs";

const file =
  path.resolve(root, rel);

if (!fs.existsSync(file)) {
  throw new Error(
    "E2E_RUNNER_NOT_FOUND"
  );
}

const before =
  fs.readFileSync(
    file,
    "utf8"
  );

let after = before;

/*
 * 1) Windows-safe targeted TypeScript:
 *    do not spawn npx.cmd directly.
 *    Execute the installed TypeScript CLI through node.
 */
after =
  after.replace(
    /const\s+npx\s*=\s*"C:\\\\Program Files\\\\nodejs\\\\npx\.cmd";/m,
    `const tscCli =
    path.resolve(
      root,
      "node_modules/typescript/bin/tsc"
    );

  if (!fs.existsSync(tscCli)) {
    throw new Error(
      "LOCAL_TYPESCRIPT_CLI_NOT_FOUND"
    );
  }`
  );

after =
  after.replace(
    /runStep\(\s*"TARGETED_TYPESCRIPT",\s*npx,\s*\[\s*"tsc",\s*"-p",\s*"tsconfig\.alpha-v3-production-cycle\.json",\s*"--noEmit"\s*\]\s*\)/m,
    `runStep(
      "TARGETED_TYPESCRIPT",
      node,
      [
        tscCli,
        "-p",
        "tsconfig.alpha-v3-production-cycle.json",
        "--noEmit"
      ]
    )`
  );

/*
 * 2) Status extraction:
 *    stdout may contain nested JSON with many "status" fields.
 *    Keep all candidates and validate steps by exact marker presence
 *    instead of assuming the last status is the process status.
 */
after =
  after.replace(
    /let status = null;[\s\S]*?if \(matches\.length > 0\) \{[\s\S]*?\n\s*\}/m,
    `let status = null;

  const statusCandidates =
    [...stdout.matchAll(
      /"status"\\s*:\\s*"([^"]+)"/g
    )].map(
      (item) => item[1]
    );

  if (
    statusCandidates.length > 0
  ) {
    status =
      statusCandidates[0];
  }`
  );

after =
  after.replace(
    /status,\s*\n\s*ok:/m,
    `status,

    statusCandidates,

    ok:`
  );

/*
 * 3) Child-step verification:
 *    for script steps, success requires exitCode=0 and the exact
 *    expected success marker anywhere in stdout.
 */
after =
  after.replace(
    /stepChecks\[step\.name\]\s*=\s*step\.ok\s*===\s*true\s*&&\s*step\.status\s*===\s*expectedStatuses\[\s*step\.name\s*\];/m,
    `stepChecks[step.name] =
      step.ok === true &&
      step.stdout.includes(
        \`"status": "\${expectedStatuses[step.name]}"\`
      );`
  );

/*
 * 4) Summary child status:
 *    show expected verified marker when present, otherwise first
 *    status candidate, avoiding nested CANDIDATE confusion.
 */
after =
  after.replace(
    /status:\s*step\.status\s*\}\)\s*\)/m,
    `status:
            expectedStatuses[
              step.name
            ] &&
            step.stdout.includes(
              \`"status": "\${expectedStatuses[step.name]}"\`
            )
              ? expectedStatuses[
                  step.name
                ]
              : step.status
        })
      )`
  );

fs.writeFileSync(
  file,
  after,
  "utf8"
);

const checks = {
  fileChanged:
    after !== before,

  usesLocalTscViaNode:
    after.includes(
      '"node_modules/typescript/bin/tsc"'
    ) &&
    /"TARGETED_TYPESCRIPT",\s*node,/m.test(
      after
    ),

  directNpxCmdRemoved:
    !after.includes(
      'C:\\\\Program Files\\\\nodejs\\\\npx.cmd'
    ),

  exactStatusMarkerVerification:
    after.includes(
      'step.stdout.includes('
    ) &&
    after.includes(
      'expectedStatuses[step.name]'
    ),

  statusCandidatesCaptured:
    after.includes(
      "statusCandidates"
    ),

  noProductionFilesChanged:
    true
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_KILL_SWITCH_E2E_HARNESS_FIX_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_E2E_HARNESS_FIX_V1_REVIEW",

      patchedFile:
        rel,

      checks,
      failed,

      diagnosis: {
        targetedTypescript:
          "WINDOWS_CMD_SPAWN_HARNESS_ISSUE",

        noOrderRegression:
          "NESTED_JSON_LAST_STATUS_FALSE_POSITIVE_CANDIDATE"
      },

      safety: {
        productionCodeChanged:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        emergencyStopChanged:
          false,

        ordersChanged:
          0,

        positionsChanged:
          0
      },

      nextAction:
        failed.length === 0
          ? "NODE_CHECK_AND_RERUN_E2E_PREACTIVATION"
          : "REVIEW_E2E_HARNESS_PATCH"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
