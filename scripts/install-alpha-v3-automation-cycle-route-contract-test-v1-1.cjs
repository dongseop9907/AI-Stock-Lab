const fs = require("fs");
const path = require("path");

const root = process.cwd();

const testFile = path.resolve(
  root,
  "scripts/alpha-v3-automation-cycle-route-contract-test.ts"
);

if (!fs.existsSync(testFile)) {
  throw new Error(
    "AUTOMATION_CYCLE_CONTRACT_TEST_NOT_FOUND"
  );
}

let text = fs.readFileSync(
  testFile,
  "utf8"
);

const backup =
  `${testFile}.before-v1-1.bak`;

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    testFile,
    backup
  );
}

const oldBlock =
`  const stateModule =
    await import(
      pathToFileURL(
        stateFile,
      ).href +
        \`?v=\${Date.now()}\`
    );`;

const newBlock =
`  const stateModule =
    await import(
      pathToFileURL(
        stateFile,
      ).href
    );`;

if (text.includes(oldBlock)) {
  text = text.replace(
    oldBlock,
    newBlock
  );
} else {
  const pattern =
    /const stateModule\s*=\s*await import\(\s*pathToFileURL\(\s*stateFile,\s*\)\.href\s*\+\s*`[^`]*`\s*\);/m;

  if (pattern.test(text)) {
    text = text.replace(
      pattern,
      `const stateModule =
    await import(
      pathToFileURL(
        stateFile,
      ).href
    );`
    );
  } else if (!text.includes("const stateModule")) {
    throw new Error(
      "STATE_MODULE_IMPORT_NOT_FOUND"
    );
  }
}

if (
  !text.includes(
    "CONTRACT_STATE_IDENTITY_SELF_CHECK"
  )
) {
  const anchor =
`  const originalFetch =
    globalThis.fetch;`;

  if (!text.includes(anchor)) {
    throw new Error(
      "SELF_CHECK_ANCHOR_NOT_FOUND"
    );
  }

  const selfCheck =
`  /*
   * CONTRACT_STATE_IDENTITY_SELF_CHECK
   * The mocks and the test body must share one exact module instance.
   */
  resetContractState();

  events.push({
    type: "state-self-check",
  });

  if (
    events.length !== 1 ||
    events[0]?.type !==
      "state-self-check"
  ) {
    throw new Error(
      "CONTRACT_STATE_IDENTITY_SELF_CHECK_FAILED"
    );
  }

  resetContractState();

`;

  text = text.replace(
    anchor,
    selfCheck + anchor
  );
}

fs.writeFileSync(
  testFile,
  text,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_AUTOMATION_CYCLE_ROUTE_CONTRACT_TEST_V1_1_INSTALLED",

      patchedFile:
        "scripts/alpha-v3-automation-cycle-route-contract-test.ts",

      fix:
        "SHARE_EXACT_SAME_STATE_MODULE_INSTANCE_BETWEEN_TEST_AND_MOCKS",

      rootCause:
        "QUERY_STRING_CREATED_SECOND_STATE_MODULE_INSTANCE",

      productionRouteChanged:
        false,

      databaseWrites:
        0,

      productionOrdersCreated:
        0,

      productionPositionsChanged:
        0,

      nextAction:
        "RERUN_AUTOMATION_CYCLE_ROUTE_CONTRACT_TEST"
    },
    null,
    2
  )
);
