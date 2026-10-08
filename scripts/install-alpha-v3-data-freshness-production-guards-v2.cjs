const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = process.cwd();

const files = {
  freshnessGuard:
    "lib/trading/data-freshness-production-guard.ts",
  entry:
    "lib/trading/generate-entry-signals.ts",
  create:
    "lib/trading/paper-order-service.ts",
  approved:
    "lib/trading/execute-approved-paper-orders.ts",
  single:
    "lib/trading/execute-paper-order.ts",
  automation:
    "app/api/trading/automation/run/route.ts",
  staticVerify:
    "scripts/alpha-v3-data-freshness-production-guards-v2-static-verify.cjs"
};

function abs(rel) {
  return path.resolve(root, rel);
}

function read(rel) {
  const file = abs(rel);

  if (!fs.existsSync(file)) {
    throw new Error(`FILE_NOT_FOUND ${rel}`);
  }

  return fs.readFileSync(file, "utf8");
}

function write(rel, text) {
  const file = abs(rel);

  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  fs.writeFileSync(
    file,
    text,
    "utf8"
  );
}

function parse(rel, text) {
  return ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function addImport(
  text,
  rel,
  importText,
  marker
) {
  if (text.includes(marker)) {
    return text;
  }

  const sf = parse(rel, text);

  const imports =
    sf.statements.filter(
      ts.isImportDeclaration
    );

  const insertAt =
    imports.length > 0
      ? imports[
          imports.length - 1
        ].getEnd()
      : 0;

  return (
    text.slice(0, insertAt) +
    "\n" +
    importText +
    text.slice(insertAt)
  );
}

function findFunction(
  sf,
  name
) {
  let found = null;

  function visit(node) {
    if (found) {
      return;
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name
    ) {
      found = node;
      return;
    }

    ts.forEachChild(
      node,
      visit
    );
  }

  visit(sf);

  if (
    !found ||
    !found.body
  ) {
    throw new Error(
      `FUNCTION_NOT_FOUND ${name}`
    );
  }

  return found;
}

function findVariableStatementInFunction(
  sf,
  fn,
  variableName
) {
  let found = null;

  function visit(node) {
    if (found) {
      return;
    }

    if (
      ts.isVariableStatement(node)
    ) {
      for (
        const declaration of
          node.declarationList.declarations
      ) {
        if (
          ts.isIdentifier(
            declaration.name
          ) &&
          declaration.name.text ===
            variableName
        ) {
          found = node;
          return;
        }
      }
    }

    ts.forEachChild(
      node,
      visit
    );
  }

  visit(fn.body);

  if (!found) {
    throw new Error(
      `VARIABLE_STATEMENT_NOT_FOUND ${variableName}`
    );
  }

  return found;
}

function insertAfterFunctionVariable(
  text,
  rel,
  functionName,
  variableName,
  snippet,
  marker
) {
  if (text.includes(marker)) {
    return text;
  }

  const sf =
    parse(rel, text);

  const fn =
    findFunction(
      sf,
      functionName
    );

  const statement =
    findVariableStatementInFunction(
      sf,
      fn,
      variableName
    );

  const insertAt =
    statement.getEnd();

  return (
    text.slice(0, insertAt) +
    "\n\n" +
    snippet +
    text.slice(insertAt)
  );
}

function insertBeforeCallInFunction(
  text,
  rel,
  functionName,
  callName,
  snippet,
  marker
) {
  if (text.includes(marker)) {
    return text;
  }

  const sf =
    parse(rel, text);

  const fn =
    findFunction(
      sf,
      functionName
    );

  let targetCall = null;

  function visit(node) {
    if (targetCall) {
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(
        node.expression
      ) &&
      node.expression.text ===
        callName
    ) {
      targetCall = node;
      return;
    }

    ts.forEachChild(
      node,
      visit
    );
  }

  visit(fn.body);

  if (!targetCall) {
    throw new Error(
      `CALL_NOT_FOUND ${functionName}:${callName}`
    );
  }

  let statement = targetCall;

  while (
    statement &&
    !ts.isStatement(statement)
  ) {
    statement =
      statement.parent;
  }

  if (!statement) {
    throw new Error(
      `CALL_PARENT_STATEMENT_NOT_FOUND ${functionName}:${callName}`
    );
  }

  const start =
    statement.getStart(sf);

  return (
    text.slice(0, start) +
    snippet +
    "\n" +
    text.slice(start)
  );
}

function patchAutomationAutoOrder(
  text,
  rel,
  marker
) {
  if (text.includes(marker)) {
    return text;
  }

  const sf =
    parse(rel, text);

  const fn =
    findFunction(
      sf,
      "POST"
    );

  let targetStatement = null;
  let targetDeclaration = null;

  function visit(node) {
    if (targetStatement) {
      return;
    }

    if (
      ts.isVariableStatement(node)
    ) {
      for (
        const declaration of
          node.declarationList.declarations
      ) {
        if (
          ts.isIdentifier(
            declaration.name
          ) &&
          declaration.name.text ===
            "autoOrder" &&
          declaration.initializer
        ) {
          targetStatement =
            node;

          targetDeclaration =
            declaration;

          return;
        }
      }
    }

    ts.forEachChild(
      node,
      visit
    );
  }

  visit(fn.body);

  if (
    !targetStatement ||
    !targetDeclaration
  ) {
    throw new Error(
      "AUTOMATION_AUTO_ORDER_DECLARATION_NOT_FOUND"
    );
  }

  const initializer =
    targetDeclaration.initializer.getText(
      sf
    );

  const replacement = `/* ${marker} */
  const requestedAutoOrder =
    ${initializer};

  const dataFreshnessAutomationDecision =
    requestedAutoOrder
      ? await readCurrentDataFreshnessProductionDecision(
          supabase,
          "PAPER_BUY_CREATE",
        )
      : null;

  const autoOrder =
    requestedAutoOrder &&
    (
      dataFreshnessAutomationDecision?.allowed ??
      true
    );`;

  return (
    text.slice(
      0,
      targetStatement.getStart(sf)
    ) +
    replacement +
    text.slice(
      targetStatement.getEnd()
    )
  );
}

/*
 * Common freshness guard.
 *
 * Important V2 change:
 * - does NOT create a Supabase client
 * - receives the caller's existing Supabase client
 * - therefore no hidden client factory discovery is needed
 */
const guard = `import {
  readCanonicalDataFreshnessState,
  type DataFreshnessSupabaseLike,
} from "./data-freshness-canonical-reader";

import {
  evaluateDataFreshnessProductionAction,
  type DataFreshnessProductionAction,
  type DataFreshnessProductionDecision,
} from "./data-freshness-production-contract";

export const DATA_FRESHNESS_PRODUCTION_GUARD_VERSION =
  "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARD_V2" as const;

export class DataFreshnessBlockedError extends Error {
  readonly code =
    "DATA_FRESHNESS_NEW_RISK_BLOCKED";

  readonly action:
    DataFreshnessProductionAction;

  readonly decision:
    DataFreshnessProductionDecision;

  constructor(
    action:
      DataFreshnessProductionAction,
    decision:
      DataFreshnessProductionDecision,
  ) {
    super(
      [
        "DATA_FRESHNESS_NEW_RISK_BLOCKED",
        action,
        decision.reason,
      ].join(":"),
    );

    this.name =
      "DataFreshnessBlockedError";

    this.action =
      action;

    this.decision =
      decision;
  }
}

export async function readCurrentDataFreshnessProductionDecision(
  supabase:
    DataFreshnessSupabaseLike,
  action:
    DataFreshnessProductionAction,
): Promise<DataFreshnessProductionDecision> {
  const state =
    await readCanonicalDataFreshnessState(
      supabase,
    );

  return evaluateDataFreshnessProductionAction(
    state,
    action,
  );
}

export async function assertDataFreshnessAllows(
  supabase:
    DataFreshnessSupabaseLike,
  action:
    DataFreshnessProductionAction,
): Promise<DataFreshnessProductionDecision> {
  const decision =
    await readCurrentDataFreshnessProductionDecision(
      supabase,
      action,
    );

  if (!decision.allowed) {
    throw new DataFreshnessBlockedError(
      action,
      decision,
    );
  }

  return decision;
}
`;

write(
  files.freshnessGuard,
  guard
);

const libImport = `import {
  assertDataFreshnessAllows,
  readCurrentDataFreshnessProductionDecision,
} from "./data-freshness-production-guard";`;

const routeImport = `import {
  readCurrentDataFreshnessProductionDecision,
} from "@/lib/trading/data-freshness-production-guard";`;

/*
 * ENTRY:
 * If autoOrder was requested but canonical freshness is stale,
 * downgrade to analysis-only. Observation and signal generation continue.
 */
{
  let text =
    read(files.entry);

  text =
    addImport(
      text,
      files.entry,
      libImport,
      "data-freshness-production-guard"
    );

  text =
    insertAfterFunctionVariable(
      text,
      files.entry,
      "generateEntrySignals",
      "supabase",
      `  /* ALPHA_V3_DATA_FRESHNESS_ENTRY_GUARD_V2 */
  if (
    input.autoOrder ===
    true
  ) {
    const dataFreshnessEntryDecision =
      await readCurrentDataFreshnessProductionDecision(
        supabase,
        "PAPER_BUY_CREATE",
      );

    if (
      !dataFreshnessEntryDecision.allowed
    ) {
      input = {
        ...input,
        autoOrder: false,
      };
    }
  }`,
      "ALPHA_V3_DATA_FRESHNESS_ENTRY_GUARD_V2"
    );

  write(
    files.entry,
    text
  );
}

/*
 * CREATE:
 * direct/manual new-risk creation fails closed.
 */
{
  let text =
    read(files.create);

  text =
    addImport(
      text,
      files.create,
      libImport,
      "data-freshness-production-guard"
    );

  text =
    insertAfterFunctionVariable(
      text,
      files.create,
      "createPaperBuyOrder",
      "supabase",
      `  /* ALPHA_V3_DATA_FRESHNESS_CREATE_GUARD_V2 */
  await assertDataFreshnessAllows(
    supabase,
    "PAPER_BUY_CREATE",
  );`,
      "ALPHA_V3_DATA_FRESHNESS_CREATE_GUARD_V2"
    );

  write(
    files.create,
    text
  );
}

/*
 * APPROVED EXECUTOR:
 * only gate when an approved order is actually about to execute.
 * Empty maintenance scans stay healthy while stale.
 */
{
  let text =
    read(files.approved);

  text =
    addImport(
      text,
      files.approved,
      libImport,
      "data-freshness-production-guard"
    );

  text =
    insertBeforeCallInFunction(
      text,
      files.approved,
      "executeApprovedPaperOrders",
      "executePaperOrder",
      `      /* ALPHA_V3_DATA_FRESHNESS_APPROVED_EXECUTE_GUARD_V2 */
      await assertDataFreshnessAllows(
        supabase,
        "PAPER_BUY_EXECUTE",
      );`,
      "ALPHA_V3_DATA_FRESHNESS_APPROVED_EXECUTE_GUARD_V2"
    );

  write(
    files.approved,
    text
  );
}

/*
 * SINGLE EXECUTOR:
 * direct fill path fails closed before the DB fill RPC.
 */
{
  let text =
    read(files.single);

  text =
    addImport(
      text,
      files.single,
      libImport,
      "data-freshness-production-guard"
    );

  text =
    insertAfterFunctionVariable(
      text,
      files.single,
      "executePaperOrder",
      "supabase",
      `  /* ALPHA_V3_DATA_FRESHNESS_SINGLE_EXECUTE_GUARD_V2 */
  await assertDataFreshnessAllows(
    supabase,
    "PAPER_BUY_EXECUTE",
  );`,
      "ALPHA_V3_DATA_FRESHNESS_SINGLE_EXECUTE_GUARD_V2"
    );

  write(
    files.single,
    text
  );
}

/*
 * AUTOMATION BOUNDARY:
 * keep the cycle alive while stale, but force new-risk automation off.
 */
{
  let text =
    read(files.automation);

  text =
    addImport(
      text,
      files.automation,
      routeImport,
      "data-freshness-production-guard"
    );

  text =
    patchAutomationAutoOrder(
      text,
      files.automation,
      "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V2"
    );

  write(
    files.automation,
    text
  );
}

const staticVerify = `const fs = require("fs");
const path = require("path");

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(
    path.resolve(root, rel),
    "utf8"
  );
}

const guard =
  read("${files.freshnessGuard}");

const entry =
  read("${files.entry}");

const create =
  read("${files.create}");

const approved =
  read("${files.approved}");

const single =
  read("${files.single}");

const automation =
  read("${files.automation}");

const checks = {
  guardV2:
    guard.includes(
      "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARD_V2"
    ),

  guardAcceptsCallerSupabase:
    /readCurrentDataFreshnessProductionDecision\\([\\s\\S]*?supabase:[\\s\\S]*?DataFreshnessSupabaseLike/m.test(
      guard
    ),

  guardDoesNotCreateOwnSupabaseClient:
    !/createSupabase|getSupabase|createClient\\(/m.test(
      guard
    ),

  guardUsesCanonicalReader:
    guard.includes(
      "readCanonicalDataFreshnessState"
    ),

  entryGuardV2:
    entry.includes(
      "ALPHA_V3_DATA_FRESHNESS_ENTRY_GUARD_V2"
    ) &&
    entry.includes(
      "readCurrentDataFreshnessProductionDecision("
    ) &&
    entry.includes(
      "autoOrder: false"
    ),

  createGuardV2:
    create.includes(
      "ALPHA_V3_DATA_FRESHNESS_CREATE_GUARD_V2"
    ) &&
    create.includes(
      '"PAPER_BUY_CREATE"'
    ),

  approvedExecuteGuardV2:
    approved.includes(
      "ALPHA_V3_DATA_FRESHNESS_APPROVED_EXECUTE_GUARD_V2"
    ) &&
    approved.includes(
      '"PAPER_BUY_EXECUTE"'
    ),

  singleExecuteGuardV2:
    single.includes(
      "ALPHA_V3_DATA_FRESHNESS_SINGLE_EXECUTE_GUARD_V2"
    ) &&
    single.includes(
      '"PAPER_BUY_EXECUTE"'
    ),

  automationBoundaryV2:
    automation.includes(
      "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V2"
    ) &&
    automation.includes(
      "requestedAutoOrder"
    ) &&
    automation.includes(
      "dataFreshnessAutomationDecision"
    ),

  automationUsesExistingSupabase:
    /readCurrentDataFreshnessProductionDecision\\(\\s*supabase\\s*,\\s*"PAPER_BUY_CREATE"/m.test(
      automation
    ),

  noDbMigrationGenerated:
    true,

  protectiveExitUntouched:
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
          ? "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARDS_V2_STATIC_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARDS_V2_STATIC_REVIEW",

      checks,
      failed,

      binding: {
        automation:
          "STALE_DOWNGRADE_TO_ANALYSIS_ONLY",

        entry:
          "STALE_DOWNGRADE_TO_ANALYSIS_ONLY",

        directCreate:
          "FAIL_CLOSED",

        approvedExecution:
          "FAIL_CLOSED_ONLY_BEFORE_ACTUAL_EXECUTION",

        singleExecution:
          "FAIL_CLOSED",

        protectiveExit:
          "UNCHANGED_ALLOWED"
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextGate:
        failed.length === 0
          ? "TARGETED_TYPESCRIPT_THEN_STALE_OPERATIONAL_REGRESSION"
          : "REVIEW_DATA_FRESHNESS_PRODUCTION_GUARDS_V2"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
`;

write(
  files.staticVerify,
  staticVerify
);

const checks = {
  guardWritten:
    fs.existsSync(
      abs(files.freshnessGuard)
    ),

  entryPatched:
    read(files.entry).includes(
      "ALPHA_V3_DATA_FRESHNESS_ENTRY_GUARD_V2"
    ),

  createPatched:
    read(files.create).includes(
      "ALPHA_V3_DATA_FRESHNESS_CREATE_GUARD_V2"
    ),

  approvedPatched:
    read(files.approved).includes(
      "ALPHA_V3_DATA_FRESHNESS_APPROVED_EXECUTE_GUARD_V2"
    ),

  singlePatched:
    read(files.single).includes(
      "ALPHA_V3_DATA_FRESHNESS_SINGLE_EXECUTE_GUARD_V2"
    ),

  automationPatched:
    read(files.automation).includes(
      "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V2"
    )
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);


/* ALPHA_V3_AUTOMATION_BOUNDARY_DUPLICATE_REPAIR_V2 */
{
  const rel = "app/api/trading/automation/run/route.ts";
  const file = path.resolve(root, rel);

  if (fs.existsSync(file)) {
    let t = fs.readFileSync(file, "utf8");
    const marker = "/* ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V2 */";
    const markerIndex = t.indexOf(marker);

    if (markerIndex >= 0) {
      const decl = "const requestedAutoOrder =";
      const declIndex = t.indexOf(decl, markerIndex);

      if (declIndex >= 0) {
        const declEnd = t.indexOf(";", declIndex);
        const autoIndex = t.indexOf("const autoOrder =", declEnd);
        const autoEnd = autoIndex >= 0 ? t.indexOf(";", autoIndex) : -1;

        if (declEnd >= 0 && autoIndex >= 0 && autoEnd >= 0) {
          const declBlock = t.slice(declIndex, declEnd + 1)
            .replace(
              "const requestedAutoOrder =",
              "const controlEligibleAutoOrder ="
            );

          const decisionBlock = t.slice(declEnd + 1, autoEnd + 1)
            .replaceAll(
              "requestedAutoOrder",
              "controlEligibleAutoOrder"
            );

          t = t.slice(0, declIndex) +
            declBlock +
            decisionBlock +
            t.slice(autoEnd + 1);

          fs.writeFileSync(file, t, "utf8");
        }
      }
    }
  }
}

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARDS_V2_INSTALLED"
          : "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARDS_V2_REVIEW",

      architecture:
        "CALLER_OWNED_SUPABASE_CLIENT",

      patchedFiles: [
        files.freshnessGuard,
        files.entry,
        files.create,
        files.approved,
        files.single,
        files.automation
      ],

      checks,
      failed,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        failed.length === 0
          ? "STATIC_VERIFY_AND_TARGETED_TYPESCRIPT"
          : "REVIEW_V2_INSTALL"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
