const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET = path.join(
  ROOT,
  "lib",
  "models",
  "model-promotion-decision-service.ts",
);
const BACKUP_DIR = path.join(ROOT, "scripts", "backups");
const BACKUP = path.join(
  BACKUP_DIR,
  "model-promotion-decision-service.before-canonical-reader-binding-v1.ts",
);

function fail(reason, details = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V1_FAILED",
        reason,
        ...details,
        safety: {
          sourceModified: false,
          databaseWrites: 0,
          orderCreation: false,
          positionChange: false,
          promotionChange: false,
          controlsChange: false,
          realTradingEnable: false,
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

if (!fs.existsSync(TARGET)) {
  fail("TARGET_NOT_FOUND", {
    target: "lib/models/model-promotion-decision-service.ts",
  });
}

let ts;
try {
  ts = require("typescript");
} catch (error) {
  fail("TYPESCRIPT_PACKAGE_NOT_AVAILABLE", {
    error: String(
      error instanceof Error ? error.message : error,
    ),
  });
}

const original = fs.readFileSync(TARGET, "utf8");

if (
  original.includes(
    "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V1",
  )
) {
  console.log(
    JSON.stringify(
      {
        status:
          "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V1_ALREADY_APPLIED",
        file:
          "lib/models/model-promotion-decision-service.ts",
        backup:
          "scripts/backups/model-promotion-decision-service.before-canonical-reader-binding-v1.ts",
        nextAction:
          "RERUN_SHADOW_CANONICAL_EVIDENCE_FAIL_CLOSED_REGRESSION",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const sf = ts.createSourceFile(
  TARGET,
  original,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function functionByName(name) {
  let found = null;

  function visit(node) {
    if (found) return;

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.name.text === name
    ) {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return found;
}

const collectFn =
  functionByName("collectModelPromotionEvidence");

const evaluateFn =
  functionByName("evaluateModelPromotionRecommendation");

if (!collectFn || !collectFn.body) {
  fail("COLLECT_MODEL_PROMOTION_EVIDENCE_FUNCTION_NOT_FOUND");
}

if (!evaluateFn || !evaluateFn.body) {
  fail("EVALUATE_MODEL_PROMOTION_RECOMMENDATION_FUNCTION_NOT_FOUND");
}

function findModelIdBinding(fn) {
  for (const parameter of fn.parameters) {
    if (ts.isIdentifier(parameter.name)) {
      const p = parameter.name.text;

      if (/modelId/i.test(p)) {
        return {
          expression: p,
          insertPos: fn.body.statements.pos,
          mode: "DIRECT_PARAMETER",
        };
      }

      let propertyFound = false;

      function searchProperty(node) {
        if (propertyFound) return;

        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === p &&
          node.name.text === "modelId"
        ) {
          propertyFound = true;
          return;
        }

        ts.forEachChild(node, searchProperty);
      }

      searchProperty(fn.body);

      if (propertyFound) {
        return {
          expression: `${p}.modelId`,
          insertPos: fn.body.statements.pos,
          mode: "PARAMETER_PROPERTY",
        };
      }
    }
  }

  let variableResult = null;

  function searchVariable(node) {
    if (variableResult) return;

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === "modelId"
        ) {
          variableResult = {
            expression: "modelId",
            insertPos: node.end,
            mode: "LOCAL_VARIABLE",
          };
          return;
        }
      }
    }

    ts.forEachChild(node, searchVariable);
  }

  searchVariable(fn.body);

  return variableResult;
}

const modelIdBinding =
  findModelIdBinding(collectFn);

if (!modelIdBinding) {
  fail("MODEL_ID_BINDING_NOT_FOUND_IN_COLLECT_FUNCTION");
}

function typeReferenceName(typeNode) {
  if (!typeNode) return null;

  let node = typeNode;

  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "Promise" &&
    node.typeArguments &&
    node.typeArguments.length === 1
  ) {
    node = node.typeArguments[0];
  }

  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName)
  ) {
    return node.typeName.text;
  }

  return null;
}

function findTypeDeclaration(name) {
  for (const stmt of sf.statements) {
    if (
      ts.isInterfaceDeclaration(stmt) &&
      stmt.name.text === name
    ) {
      return {
        kind: "interface",
        node: stmt,
      };
    }

    if (
      ts.isTypeAliasDeclaration(stmt) &&
      stmt.name.text === name
    ) {
      return {
        kind: "type",
        node: stmt,
      };
    }
  }

  return null;
}

const collectReturnTypeName =
  typeReferenceName(collectFn.type);

const evaluateParameterTypeNames =
  evaluateFn.parameters
    .map((p) => typeReferenceName(p.type))
    .filter(Boolean);

const typeNamesToPatch = [
  ...new Set(
    [
      collectReturnTypeName,
      ...evaluateParameterTypeNames,
    ].filter(Boolean),
  ),
];

function collectReturnObjects(fn) {
  const objects = [];

  function visit(node) {
    if (
      ts.isFunctionLike(node) &&
      node !== fn
    ) {
      return;
    }

    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      ts.isObjectLiteralExpression(node.expression)
    ) {
      objects.push(node.expression);
      return;
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(fn.body, visit);
  return objects;
}

const collectReturnObjectsFound =
  collectReturnObjects(collectFn);

if (collectReturnObjectsFound.length === 0) {
  fail("COLLECT_RETURN_OBJECT_NOT_FOUND");
}

let notReadyConditional = null;
let notReadyBranch = null;

function findNotReady(node) {
  if (notReadyConditional) return;

  if (ts.isConditionalExpression(node)) {
    const trueText = node.whenTrue.getText(sf);
    const falseText = node.whenFalse.getText(sf);

    if (
      trueText.includes(
        "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY",
      )
    ) {
      notReadyConditional = node;
      notReadyBranch = "WHEN_TRUE";
      return;
    }

    if (
      falseText.includes(
        "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY",
      )
    ) {
      notReadyConditional = node;
      notReadyBranch = "WHEN_FALSE";
      return;
    }
  }

  ts.forEachChild(node, findNotReady);
}

findNotReady(evaluateFn.body);

if (!notReadyConditional || !notReadyBranch) {
  fail("SHADOW_PAPER_NOT_READY_CONDITIONAL_NOT_FOUND");
}

const evaluateParam =
  evaluateFn.parameters.find((p) =>
    ts.isIdentifier(p.name),
  );

if (!evaluateParam || !ts.isIdentifier(evaluateParam.name)) {
  fail("EVALUATE_EVIDENCE_PARAMETER_NOT_FOUND");
}

const evaluateParamName =
  evaluateParam.name.text;

const edits = [];

function addInsert(pos, text, label) {
  edits.push({
    start: pos,
    end: pos,
    text,
    label,
  });
}

function addReplace(start, end, text, label) {
  edits.push({
    start,
    end,
    text,
    label,
  });
}

/*
 * 1) Import canonical evidence reader.
 */
const importText =
  `\nimport {\n` +
  `  getCanonicalShadowOutcomeEvidence,\n` +
  `} from "@/lib/models/model-shadow-outcome-storage";\n`;

let importInsertPos = 0;

for (const stmt of sf.statements) {
  if (ts.isImportDeclaration(stmt)) {
    importInsertPos = stmt.end;
  }
}

if (
  !original.includes(
    'from "@/lib/models/model-shadow-outcome-storage"',
  )
) {
  addInsert(
    importInsertPos,
    importText,
    "ADD_CANONICAL_READER_IMPORT",
  );
}

/*
 * 2) Read canonical evidence during promotion evidence collection.
 *    This is the actual DB reader binding.
 */
const readerBlock =
  `\n\n  /* MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V1 */\n` +
  `  const canonicalShadowOutcomeEvidence =\n` +
  `    await getCanonicalShadowOutcomeEvidence(\n` +
  `      ${modelIdBinding.expression},\n` +
  `    );\n\n` +
  `  const canonicalShadowOutcomeEvidenceReady =\n` +
  `    canonicalShadowOutcomeEvidence.counts.total > 0 &&\n` +
  `    canonicalShadowOutcomeEvidence.counts.completed > 0 &&\n` +
  `    canonicalShadowOutcomeEvidence.completed.withReturn1d > 0 &&\n` +
  `    canonicalShadowOutcomeEvidence.completed.withReturn3d > 0 &&\n` +
  `    canonicalShadowOutcomeEvidence.completed.withReturn5d > 0;\n`;

addInsert(
  modelIdBinding.insertPos,
  readerBlock,
  "ADD_CANONICAL_EVIDENCE_READ",
);

/*
 * 3) Carry readiness into collected evidence.
 */
for (const objectNode of collectReturnObjectsFound) {
  if (
    !objectNode.getText(sf).includes(
      "canonicalShadowOutcomeEvidenceReady",
    )
  ) {
    addInsert(
      objectNode.properties.end,
      `\n    canonicalShadowOutcomeEvidenceReady,\n`,
      "ADD_CANONICAL_READY_TO_COLLECT_RETURN",
    );
  }
}

/*
 * 4) Extend named evidence types when present.
 */
for (const typeName of typeNamesToPatch) {
  const decl = findTypeDeclaration(typeName);

  if (!decl) {
    continue;
  }

  const declarationText =
    decl.node.getText(sf);

  if (
    declarationText.includes(
      "canonicalShadowOutcomeEvidenceReady",
    )
  ) {
    continue;
  }

  if (decl.kind === "interface") {
    addInsert(
      decl.node.members.end,
      `\n  canonicalShadowOutcomeEvidenceReady: boolean;\n`,
      `PATCH_INTERFACE_${typeName}`,
    );
    continue;
  }

  if (
    decl.kind === "type" &&
    ts.isTypeLiteralNode(decl.node.type)
  ) {
    addInsert(
      decl.node.type.members.end,
      `\n  canonicalShadowOutcomeEvidenceReady: boolean;\n`,
      `PATCH_TYPE_${typeName}`,
    );
  }
}

/*
 * 5) Make SHADOW -> PAPER recommendation fail closed.
 *
 * If NOT_READY is the true branch:
 *   failureCondition OR !canonicalReady
 *
 * If NOT_READY is the false branch:
 *   successCondition AND canonicalReady
 */
const oldCondition =
  notReadyConditional.condition.getText(sf);

const readyAccess =
  `${evaluateParamName}.canonicalShadowOutcomeEvidenceReady`;

const newCondition =
  notReadyBranch === "WHEN_TRUE"
    ? `(${oldCondition}) || !${readyAccess}`
    : `(${oldCondition}) && ${readyAccess}`;

addReplace(
  notReadyConditional.condition.getStart(sf),
  notReadyConditional.condition.end,
  newCondition,
  "ENFORCE_FAIL_CLOSED_IN_SHADOW_TO_PAPER_DECISION",
);

/*
 * Validate edit ranges do not overlap.
 */
const ordered = [...edits].sort(
  (a, b) =>
    a.start - b.start ||
    a.end - b.end,
);

for (let i = 1; i < ordered.length; i += 1) {
  const prev = ordered[i - 1];
  const curr = ordered[i];

  if (
    prev.end > curr.start &&
    !(
      prev.start === prev.end &&
      prev.start === curr.start
    )
  ) {
    fail("PATCH_EDIT_OVERLAP", {
      previous: prev.label,
      current: curr.label,
    });
  }
}

fs.mkdirSync(
  BACKUP_DIR,
  {
    recursive: true,
  },
);

if (!fs.existsSync(BACKUP)) {
  fs.writeFileSync(
    BACKUP,
    original,
    "utf8",
  );
}

let patched = original;

for (const edit of [...edits].sort(
  (a, b) =>
    b.start - a.start ||
    b.end - a.end,
)) {
  patched =
    patched.slice(0, edit.start) +
    edit.text +
    patched.slice(edit.end);
}

/*
 * Parse the patched file before writing.
 */
const patchedSf = ts.createSourceFile(
  TARGET,
  patched,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

const syntaxDiagnostics =
  patchedSf.parseDiagnostics ?? [];

if (syntaxDiagnostics.length > 0) {
  fail("PATCHED_SOURCE_PARSE_FAILED", {
    diagnostics: syntaxDiagnostics.map((d) => ({
      start: d.start,
      length: d.length,
      message:
        ts.flattenDiagnosticMessageText(
          d.messageText,
          "\n",
        ),
    })),
  });
}

const requiredMarkers = [
  "getCanonicalShadowOutcomeEvidence",
  "canonicalShadowOutcomeEvidenceReady",
  "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V1",
  "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY",
  "FAIL_CLOSED_UNTIL_CANONICAL_SHADOW_OUTCOME_EVIDENCE_EXISTS",
];

const missingMarkers =
  requiredMarkers.filter(
    (marker) =>
      !patched.includes(marker),
  );

if (missingMarkers.length > 0) {
  fail("PATCH_VERIFICATION_MARKERS_MISSING", {
    missingMarkers,
  });
}

fs.writeFileSync(
  TARGET,
  patched,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V1_APPLIED",
      file:
        "lib/models/model-promotion-decision-service.ts",
      backup:
        "scripts/backups/model-promotion-decision-service.before-canonical-reader-binding-v1.ts",
      modelIdBinding: {
        expression:
          modelIdBinding.expression,
        mode:
          modelIdBinding.mode,
      },
      failClosedPatch: {
        notReadyBranch,
        oldCondition,
        newCondition,
      },
      edits:
        edits.map((edit) => edit.label),
      invariant:
        "SHADOW_TO_PAPER_REQUIRES_CANONICAL_COMPLETED_1D_3D_5D_EVIDENCE",
      safety: {
        databaseWrites: 0,
        orderCreation: false,
        positionChange: false,
        promotionChange: false,
        controlsChange: false,
        realTradingEnable: false,
      },
      nextAction:
        "RERUN_SHADOW_CANONICAL_EVIDENCE_FAIL_CLOSED_REGRESSION",
    },
    null,
    2,
  ),
);
