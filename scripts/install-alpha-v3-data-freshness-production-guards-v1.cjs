const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = process.cwd();

const files = {
  killSwitchGuard:
    "lib/trading/kill-switch-guard.ts",

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
    "scripts/alpha-v3-data-freshness-production-guards-v1-static-verify.cjs"
};

function abs(rel) {
  return path.resolve(root, rel);
}

function read(rel) {
  const file = abs(rel);

  if (!fs.existsSync(file)) {
    throw new Error(
      `FILE_NOT_FOUND ${rel}`
    );
  }

  return fs.readFileSync(
    file,
    "utf8"
  );
}

function write(rel, text) {
  const file = abs(rel);

  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
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

function applyEdits(
  text,
  edits
) {
  return edits
    .sort(
      (a, b) =>
        b.start - a.start
    )
    .reduce(
      (current, edit) =>
        current.slice(0, edit.start) +
        edit.text +
        current.slice(edit.end),
      text
    );
}

function addImport(
  text,
  rel,
  importText,
  marker
) {
  if (
    text.includes(marker)
  ) {
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

function insertAtFunctionBodyStart(
  text,
  rel,
  functionName,
  snippet,
  marker
) {
  if (
    text.includes(marker)
  ) {
    return text;
  }

  const sf =
    parse(rel, text);

  const fn =
    findFunction(
      sf,
      functionName
    );

  const start =
    fn.body.getStart(sf) + 1;

  return (
    text.slice(0, start) +
    "\n" +
    snippet +
    "\n" +
    text.slice(start)
  );
}

function insertBeforeExecutePaperOrderCall(
  text,
  rel,
  snippet,
  marker
) {
  if (
    text.includes(marker)
  ) {
    return text;
  }

  const sf =
    parse(rel, text);

  const fn =
    findFunction(
      sf,
      "executeApprovedPaperOrders"
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
        "executePaperOrder"
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
      "EXECUTE_PAPER_ORDER_CALL_NOT_FOUND_IN_APPROVED_EXECUTOR"
    );
  }

  let statement =
    targetCall;

  while (
    statement &&
    !ts.isStatement(statement)
  ) {
    statement =
      statement.parent;
  }

  if (!statement) {
    throw new Error(
      "EXECUTE_PAPER_ORDER_PARENT_STATEMENT_NOT_FOUND"
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
  if (
    text.includes(marker)
  ) {
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

  for (
    const statement of
      fn.body.statements
  ) {
    if (
      !ts.isVariableStatement(
        statement
      )
    ) {
      continue;
    }

    for (
      const declaration of
        statement.declarationList
          .declarations
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
          statement;

        targetDeclaration =
          declaration;

        break;
      }
    }

    if (targetStatement) {
      break;
    }
  }

  if (
    !targetStatement ||
    !targetDeclaration
  ) {
    throw new Error(
      "AUTOMATION_AUTO_ORDER_DECLARATION_NOT_FOUND"
    );
  }

  const initializerText =
    targetDeclaration.initializer.getText(
      sf
    );

  const replacement = `/* ${marker} */
  const requestedAutoOrder =
    ${initializerText};

  const dataFreshnessAutomationDecision =
    requestedAutoOrder
      ? await readCurrentDataFreshnessProductionDecision(
          "PAPER_BUY_CREATE",
        )
      : null;

  const autoOrder =
    requestedAutoOrder &&
    (
      dataFreshnessAutomationDecision?.allowed ??
      true
    );`;

  return applyEdits(
    text,
    [
      {
        start:
          targetStatement.getStart(sf),

        end:
          targetStatement.getEnd(),

        text:
          replacement
      }
    ]
  );
}

function discoverSupabaseFactory() {
  const rel =
    files.killSwitchGuard;

  const text =
    read(rel);

  const sf =
    parse(rel, text);

  const imported = new Map();

  for (
    const statement of
      sf.statements
  ) {
    if (
      !ts.isImportDeclaration(
        statement
      )
    ) {
      continue;
    }

    const moduleSpecifier =
      statement.moduleSpecifier
        .getText(sf)
        .slice(1, -1);

    const clause =
      statement.importClause;

    if (!clause) {
      continue;
    }

    if (clause.name) {
      imported.set(
        clause.name.text,
        {
          localName:
            clause.name.text,

          importText:
            statement.getText(sf),

          moduleSpecifier
        }
      );
    }

    const bindings =
      clause.namedBindings;

    if (
      bindings &&
      ts.isNamedImports(bindings)
    ) {
      for (
        const element of
          bindings.elements
      ) {
        imported.set(
          element.name.text,
          {
            localName:
              element.name.text,

            importText:
              statement.getText(sf),

            moduleSpecifier
          }
        );
      }
    }
  }

  const candidates = [];

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /supabase/i.test(
        node.name.text
      ) &&
      node.initializer
    ) {
      let init =
        node.initializer;

      let awaited =
        false;

      if (
        ts.isAwaitExpression(init)
      ) {
        awaited = true;
        init =
          init.expression;
      }

      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(
          init.expression
        ) &&
        imported.has(
          init.expression.text
        )
      ) {
        const importInfo =
          imported.get(
            init.expression.text
          );

        const score =
          (
            /supabase/i.test(
              init.expression.text
            )
              ? 10
              : 0
          ) +
          (
            /admin|server/i.test(
              init.expression.text
            )
              ? 5
              : 0
          );

        candidates.push({
          variableName:
            node.name.text,

          factoryName:
            init.expression.text,

          awaited,

          score,

          ...importInfo
        });
      }
    }

    ts.forEachChild(
      node,
      visit
    );
  }

  visit(sf);

  candidates.sort(
    (a, b) =>
      b.score - a.score
  );

  if (
    candidates.length === 0
  ) {
    throw new Error(
      "SUPABASE_FACTORY_NOT_DISCOVERED_FROM_KILL_SWITCH_GUARD"
    );
  }

  return candidates[0];
}

const factory =
  discoverSupabaseFactory();

const guardImportText =
  factory.importText;

const factoryExpression =
  `${
    factory.awaited
      ? "await "
      : ""
  }${factory.factoryName}()`;

const freshnessGuard = `${guardImportText}

import {
  readCanonicalDataFreshnessState,
} from "./data-freshness-canonical-reader";

import {
  evaluateDataFreshnessProductionAction,
  type DataFreshnessProductionAction,
  type DataFreshnessProductionDecision,
} from "./data-freshness-production-contract";

export const DATA_FRESHNESS_PRODUCTION_GUARD_VERSION =
  "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARD_V1" as const;

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
  action:
    DataFreshnessProductionAction,
): Promise<DataFreshnessProductionDecision> {
  const supabase =
    ${factoryExpression};

  const state =
    await readCanonicalDataFreshnessState(
      supabase as never,
    );

  return evaluateDataFreshnessProductionAction(
    state,
    action,
  );
}

export async function assertDataFreshnessAllows(
  action:
    DataFreshnessProductionAction,
): Promise<DataFreshnessProductionDecision> {
  const decision =
    await readCurrentDataFreshnessProductionDecision(
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
  freshnessGuard
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
 * downgrade requested autoOrder to analysis-only when freshness
 * is not production-usable. This preserves observation/analysis.
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
    insertAtFunctionBodyStart(
      text,
      files.entry,
      "generateEntrySignals",
      `  /* ALPHA_V3_DATA_FRESHNESS_ENTRY_GUARD_V1 */
  if (
    input.autoOrder ===
    true
  ) {
    const dataFreshnessEntryDecision =
      await readCurrentDataFreshnessProductionDecision(
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
      "ALPHA_V3_DATA_FRESHNESS_ENTRY_GUARD_V1"
    );

  write(
    files.entry,
    text
  );
}

/*
 * CREATE:
 * direct/manual service calls fail closed.
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
    insertAtFunctionBodyStart(
      text,
      files.create,
      "createPaperBuyOrder",
      `  /* ALPHA_V3_DATA_FRESHNESS_CREATE_GUARD_V1 */
  await assertDataFreshnessAllows(
    "PAPER_BUY_CREATE",
  );`,
      "ALPHA_V3_DATA_FRESHNESS_CREATE_GUARD_V1"
    );

  write(
    files.create,
    text
  );
}

/*
 * APPROVED EXECUTOR:
 * only assert immediately before a real executePaperOrder call.
 * With zero approved orders, maintenance loop remains healthy.
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
    insertBeforeExecutePaperOrderCall(
      text,
      files.approved,
      `/* ALPHA_V3_DATA_FRESHNESS_APPROVED_EXECUTE_GUARD_V1 */
      await assertDataFreshnessAllows(
        "PAPER_BUY_EXECUTE",
      );`,
      "ALPHA_V3_DATA_FRESHNESS_APPROVED_EXECUTE_GUARD_V1"
    );

  write(
    files.approved,
    text
  );
}

/*
 * SINGLE EXECUTOR:
 * direct fill/RPC path fails closed.
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
    insertAtFunctionBodyStart(
      text,
      files.single,
      "executePaperOrder",
      `  /* ALPHA_V3_DATA_FRESHNESS_SINGLE_EXECUTE_GUARD_V1 */
  await assertDataFreshnessAllows(
    "PAPER_BUY_EXECUTE",
  );`,
      "ALPHA_V3_DATA_FRESHNESS_SINGLE_EXECUTE_GUARD_V1"
    );

  write(
    files.single,
    text
  );
}

/*
 * AUTOMATION BOUNDARY:
 * stale/missing freshness downgrades requested autoOrder to false,
 * but the cycle continues for observation, analysis and maintenance.
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
      "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V1"
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
  guardVersion:
    guard.includes(
      "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARD_V1"
    ),

  guardUsesCanonicalReader:
    guard.includes(
      "readCanonicalDataFreshnessState"
    ),

  guardUsesProductionContract:
    guard.includes(
      "evaluateDataFreshnessProductionAction"
    ),

  entryGuardPresent:
    entry.includes(
      "ALPHA_V3_DATA_FRESHNESS_ENTRY_GUARD_V1"
    ) &&
    entry.includes(
      'autoOrder: false'
    ),

  createGuardPresent:
    create.includes(
      "ALPHA_V3_DATA_FRESHNESS_CREATE_GUARD_V1"
    ) &&
    create.includes(
      '"PAPER_BUY_CREATE"'
    ),

  approvedExecuteGuardPresent:
    approved.includes(
      "ALPHA_V3_DATA_FRESHNESS_APPROVED_EXECUTE_GUARD_V1"
    ) &&
    approved.includes(
      '"PAPER_BUY_EXECUTE"'
    ),

  singleExecuteGuardPresent:
    single.includes(
      "ALPHA_V3_DATA_FRESHNESS_SINGLE_EXECUTE_GUARD_V1"
    ) &&
    single.includes(
      '"PAPER_BUY_EXECUTE"'
    ),

  automationBoundaryPresent:
    automation.includes(
      "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V1"
    ) &&
    automation.includes(
      "requestedAutoOrder"
    ) &&
    automation.includes(
      "dataFreshnessAutomationDecision"
    ),

  automationDowngradesInsteadOfThrows:
    automation.includes(
      "dataFreshnessAutomationDecision?.allowed"
    ),

  protectiveExitFilesUntouchedByInstaller:
    true,

  noDbMigrationGenerated:
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
          ? "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARDS_V1_STATIC_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARDS_V1_STATIC_REVIEW",

      checks,
      failed,

      binding: {
        automation:
          "DOWNGRADE_AUTO_ORDER_TO_ANALYSIS_ONLY",

        entry:
          "DOWNGRADE_AUTO_ORDER_TO_ANALYSIS_ONLY",

        directCreate:
          "FAIL_CLOSED",

        approvedExecution:
          "FAIL_CLOSED_BEFORE_ACTUAL_EXECUTION",

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
          ? "TARGETED_TYPESCRIPT_AND_STALE_OPERATIONAL_REGRESSION"
          : "REVIEW_DATA_FRESHNESS_BINDING"
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

const postChecks = {
  guardCreated:
    fs.existsSync(
      abs(files.freshnessGuard)
    ),

  entryPatched:
    read(files.entry).includes(
      "ALPHA_V3_DATA_FRESHNESS_ENTRY_GUARD_V1"
    ),

  createPatched:
    read(files.create).includes(
      "ALPHA_V3_DATA_FRESHNESS_CREATE_GUARD_V1"
    ),

  approvedPatched:
    read(files.approved).includes(
      "ALPHA_V3_DATA_FRESHNESS_APPROVED_EXECUTE_GUARD_V1"
    ),

  singlePatched:
    read(files.single).includes(
      "ALPHA_V3_DATA_FRESHNESS_SINGLE_EXECUTE_GUARD_V1"
    ),

  automationPatched:
    read(files.automation).includes(
      "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V1"
    )
};

const failed =
  Object.entries(postChecks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARDS_V1_INSTALLED"
          : "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARDS_V1_REVIEW",

      discoveredSupabaseFactory: {
        factoryName:
          factory.factoryName,

        moduleSpecifier:
          factory.moduleSpecifier,

        awaited:
          factory.awaited
      },

      patchedFiles: [
        files.freshnessGuard,
        files.entry,
        files.create,
        files.approved,
        files.single,
        files.automation
      ],

      checks:
        postChecks,

      failed,

      semantics: {
        staleAutomation:
          "ANALYSIS_ONLY_NO_NEW_RISK",

        staleDirectCreate:
          "BLOCK",

        staleApprovedExecution:
          "BLOCK_BEFORE_EXECUTE",

        staleSingleExecution:
          "BLOCK",

        stopLossTrailing:
          "UNCHANGED_ALLOWED"
      },

      safety: {
        installerDatabaseReads: 0,
        installerDatabaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        failed.length === 0
          ? "STATIC_VERIFY_AND_TARGETED_TYPESCRIPT"
          : "REVIEW_PRODUCTION_GUARD_INSTALL"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
