const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = process.cwd();

const routeRel =
  "app/api/trading/automation/run/route.ts";

const installerRel =
  "scripts/install-alpha-v3-data-freshness-production-guards-v2.cjs";

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
  fs.writeFileSync(
    abs(rel),
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

function findFunction(sf, name) {
  let found = null;

  function visit(node) {
    if (found) return;

    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name
    ) {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);

  if (!found || !found.body) {
    throw new Error(`FUNCTION_NOT_FOUND ${name}`);
  }

  return found;
}

function collectNamedVariableStatements(
  sf,
  fn,
  variableName
) {
  const found = [];

  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (
        const declaration of
          node.declarationList.declarations
      ) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === variableName
        ) {
          found.push({
            statement: node,
            declaration
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(fn.body);

  return found;
}

function patchRoute(text) {
  const marker =
    "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V2";

  if (!text.includes(marker)) {
    throw new Error(
      "FRESHNESS_AUTOMATION_BOUNDARY_MARKER_NOT_FOUND"
    );
  }

  const sf =
    parse(routeRel, text);

  const fn =
    findFunction(sf, "POST");

  const requested =
    collectNamedVariableStatements(
      sf,
      fn,
      "requestedAutoOrder"
    );

  const decisions =
    collectNamedVariableStatements(
      sf,
      fn,
      "dataFreshnessAutomationDecision"
    );

  const autoOrders =
    collectNamedVariableStatements(
      sf,
      fn,
      "autoOrder"
    );

  if (requested.length < 2) {
    /*
     * Already repaired or source shape changed.
     */
    if (
      requested.length === 1 &&
      text.includes(
        "controlEligibleAutoOrder"
      )
    ) {
      return {
        text,
        alreadyFixed: true,
        originalInitializer: null
      };
    }

    throw new Error(
      `EXPECTED_DUPLICATE_REQUESTED_AUTO_ORDER count=${requested.length}`
    );
  }

  if (
    decisions.length !== 1 ||
    autoOrders.length !== 1
  ) {
    throw new Error(
      `BOUNDARY_STATEMENT_SHAPE_UNEXPECTED decisions=${decisions.length} autoOrders=${autoOrders.length}`
    );
  }

  const duplicate =
    requested[requested.length - 1];

  const initializer =
    duplicate.declaration.initializer;

  if (!initializer) {
    throw new Error(
      "DUPLICATE_REQUESTED_AUTO_ORDER_INITIALIZER_MISSING"
    );
  }

  const initializerText =
    initializer.getText(sf);

  if (
    !initializerText.includes(
      "requestedAutoOrder"
    )
  ) {
    throw new Error(
      "DUPLICATE_INITIALIZER_DOES_NOT_REFERENCE_ORIGINAL_REQUEST"
    );
  }

  const start =
    duplicate.statement.getStart(sf);

  const end =
    autoOrders[0].statement.getEnd();

  const replacement = `/* ${marker} */
  const controlEligibleAutoOrder =
    ${initializerText};

  const dataFreshnessAutomationDecision =
    controlEligibleAutoOrder
      ? await readCurrentDataFreshnessProductionDecision(
          supabase,
          "PAPER_BUY_CREATE",
        )
      : null;

  const autoOrder =
    controlEligibleAutoOrder &&
    (
      dataFreshnessAutomationDecision?.allowed ??
      true
    );`;

  return {
    text:
      text.slice(0, start) +
      replacement +
      text.slice(end),

    alreadyFixed:
      false,

    originalInitializer:
      initializerText
  };
}

function correctedInstallerPatchFunction() {
  return String.raw`function patchAutomationAutoOrder(
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
  let existingRequestedAutoOrder = null;

  function visit(node) {
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
            "requestedAutoOrder"
        ) {
          existingRequestedAutoOrder =
            declaration;
        }

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

  const hasExistingRequest =
    Boolean(
      existingRequestedAutoOrder
    );

  const eligibilityName =
    hasExistingRequest
      ? "controlEligibleAutoOrder"
      : "requestedAutoOrder";

  const requestDeclaration =
    hasExistingRequest
      ? `const controlEligibleAutoOrder =
    ${initializer};`
      : `const requestedAutoOrder =
    ${initializer};`;

  const replacement = `/* ${marker} */
  ${requestDeclaration}

  const dataFreshnessAutomationDecision =
    ${eligibilityName}
      ? await readCurrentDataFreshnessProductionDecision(
          supabase,
          "PAPER_BUY_CREATE",
        )
      : null;

  const autoOrder =
    ${eligibilityName} &&
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
}`;

}

function patchInstaller(text) {
  const startToken =
    "function patchAutomationAutoOrder(";

  const endToken =
    "\n\n/*\n * Common freshness guard.";

  const start =
    text.indexOf(startToken);

  const end =
    text.indexOf(
      endToken,
      start
    );

  if (
    start < 0 ||
    end < 0
  ) {
    throw new Error(
      "INSTALLER_PATCH_FUNCTION_BOUNDARY_NOT_FOUND"
    );
  }

  return (
    text.slice(0, start) +
    correctedInstallerPatchFunction() +
    text.slice(end)
  );
}

const routeBefore =
  read(routeRel);

const routePatch =
  patchRoute(routeBefore);

write(
  routeRel,
  routePatch.text
);

const installerBefore =
  read(installerRel);

const installerAfter =
  patchInstaller(
    installerBefore
  );

write(
  installerRel,
  installerAfter
);

/*
 * Validate the persisted route structurally.
 */
const routeAfter =
  read(routeRel);

const sfAfter =
  parse(routeRel, routeAfter);

const postAfter =
  findFunction(
    sfAfter,
    "POST"
  );

const requestedAfter =
  collectNamedVariableStatements(
    sfAfter,
    postAfter,
    "requestedAutoOrder"
  );

const controlEligibleAfter =
  collectNamedVariableStatements(
    sfAfter,
    postAfter,
    "controlEligibleAutoOrder"
  );

const autoOrderAfter =
  collectNamedVariableStatements(
    sfAfter,
    postAfter,
    "autoOrder"
  );

const checks = {
  exactlyOneRequestedAutoOrder:
    requestedAfter.length === 1,

  controlEligiblePresent:
    controlEligibleAfter.length === 1,

  exactlyOneAutoOrder:
    autoOrderAfter.length === 1,

  freshnessDecisionPresent:
    routeAfter.includes(
      "dataFreshnessAutomationDecision"
    ),

  freshnessReaderPresent:
    routeAfter.includes(
      'readCurrentDataFreshnessProductionDecision(\n          supabase,\n          "PAPER_BUY_CREATE",'
    ),

  killSwitchConditionPreserved:
    routeAfter.includes(
      "control.emergencyStop"
    ),

  automationEnabledPreserved:
    routeAfter.includes(
      "control.automationEnabled"
    ),

  paperOrderEnabledPreserved:
    routeAfter.includes(
      "control.paperOrderEnabled"
    ),

  selfReferentialDuplicateRemoved:
    !/const\s+requestedAutoOrder\s*=\s*requestedAutoOrder\s*&&/m.test(
      routeAfter
    ),

  installerUsesExistingRequestAwareness:
    installerAfter.includes(
      "hasExistingRequest"
    ) &&
    installerAfter.includes(
      "controlEligibleAutoOrder"
    )
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
          ? "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_DUPLICATE_FIX_V1_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_DUPLICATE_FIX_V1_REVIEW",

      patchedFiles: [
        routeRel,
        installerRel
      ],

      diagnosis: {
        rootCause:
          "V2_PATCH_REDECLARED_EXISTING_REQUESTED_AUTO_ORDER",

        originalDuplicateInitializer:
          routePatch.originalInitializer,

        fixedArchitecture:
          "ORIGINAL_REQUESTED_AUTO_ORDER -> CONTROL_ELIGIBLE_AUTO_ORDER -> FRESHNESS_DECISION -> AUTO_ORDER"
      },

      checks,
      failed,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        failed.length === 0
          ? "STATIC_VERIFY_TYPESCRIPT_THEN_RETRY_MARKET_DATA_MAINTENANCE_ONCE"
          : "REVIEW_AUTOMATION_BOUNDARY_REPAIR"
    },
    null,
    2
  )
);

if (
  failed.length > 0
) {
  process.exitCode = 2;
}
