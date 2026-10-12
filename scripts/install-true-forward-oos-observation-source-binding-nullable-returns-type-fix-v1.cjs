const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const targetRel = "scripts/true-forward-oos-observation-source-binding-v1-contract-test.ts";
const target = path.join(ROOT, targetRel);
const backupDir = path.join(ROOT, "scripts", "backups");
const marker = "AI_STOCK_LAB_PATCH_OBSERVATION_SOURCE_BINDING_NULLABLE_RETURNS_TYPE_V1";

function print(obj, error = false) {
  (error ? console.error : console.log)(JSON.stringify(obj, null, 2));
}

function findFunctionBlock(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) return null;

  const braceStart = source.indexOf("{", start);
  if (braceStart < 0) return null;

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return {
          start,
          braceStart,
          end: i + 1,
          text: source.slice(start, i + 1),
        };
      }
    }
  }
  return null;
}

if (!fs.existsSync(target)) {
  print({
    status: "AI_STOCK_LAB_OBSERVATION_SOURCE_BINDING_NULLABLE_RETURNS_TYPE_FIX_V1_FAILED",
    message: "TARGET_FILE_NOT_FOUND",
    target: targetRel
  }, true);
  process.exitCode = 1;
  return;
}

let source = fs.readFileSync(target, "utf8");

if (source.includes(marker)) {
  print({
    status: "AI_STOCK_LAB_OBSERVATION_SOURCE_BINDING_NULLABLE_RETURNS_TYPE_FIX_V1_ALREADY_APPLIED",
    target: targetRel,
    nextAction: "RUN_FOCUSED_CONTRACT_AND_TARGET_TSC_CHECK"
  });
  return;
}

const block = findFunctionBlock(source, "validBase");
if (!block) {
  print({
    status: "AI_STOCK_LAB_OBSERVATION_SOURCE_BINDING_NULLABLE_RETURNS_TYPE_FIX_V1_FAILED",
    message: "VALID_BASE_FUNCTION_NOT_FOUND",
    target: targetRel
  }, true);
  process.exitCode = 1;
  return;
}

let validBase = block.text;

// Widen only r1/r3/r5 scalar literals inside validBase().
// Handles numbers and nulls while preserving runtime values exactly.
const returnFieldPattern =
  /\b(r1|r3|r5)\s*:\s*(null|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?!\s+as\s+number\s*\|\s*null)/gi;

const matches = [...validBase.matchAll(returnFieldPattern)];

if (matches.length < 6) {
  print({
    status: "AI_STOCK_LAB_OBSERVATION_SOURCE_BINDING_NULLABLE_RETURNS_TYPE_FIX_V1_FAILED",
    message: "EXPECTED_RETURN_FIELDS_NOT_FOUND_IN_VALID_BASE",
    target: targetRel,
    found: matches.length,
    expectedAtLeast: 6,
    preview: validBase
  }, true);
  process.exitCode = 1;
  return;
}

validBase = validBase.replace(
  returnFieldPattern,
  (_full, key, value) => `${key}: ${value} as number | null`
);

fs.mkdirSync(backupDir, { recursive: true });

const backup = path.join(
  backupDir,
  "true-forward-oos-observation-source-binding-v1-contract-test.before-nullable-returns-type-fix-v1.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

source =
  source.slice(0, block.start) +
  validBase +
  source.slice(block.end);

source =
  `// ${marker}\n` +
  `// Contract fixture typing only: widen forward return fixtures to number | null without changing runtime values.\n` +
  source;

fs.writeFileSync(target, source, "utf8");

const after = fs.readFileSync(target, "utf8");
const widenedCount = (after.match(/\br[135]\s*:\s*(?:null|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+as\s+number\s*\|\s*null/gi) || []).length;

if (!after.includes(marker) || widenedCount < matches.length) {
  print({
    status: "AI_STOCK_LAB_OBSERVATION_SOURCE_BINDING_NULLABLE_RETURNS_TYPE_FIX_V1_FAILED",
    message: "POST_PATCH_VERIFICATION_FAILED",
    target: targetRel,
    matchedFields: matches.length,
    widenedCount,
    backup: path.relative(ROOT, backup).replace(/\\/g, "/")
  }, true);
  process.exitCode = 1;
  return;
}

print({
  status: "AI_STOCK_LAB_OBSERVATION_SOURCE_BINDING_NULLABLE_RETURNS_TYPE_FIX_V1_INSTALLED",
  target: targetRel,
  backup: path.relative(ROOT, backup).replace(/\\/g, "/"),
  widenedFixtureFields: matches.length,
  fix: "VALID_BASE_R1_R3_R5_NUMBER_OR_NULL_TYPE_WIDENING",
  runtimeValuesChanged: false,
  runtimeLogicChanged: false,
  productSourceChanges: 0,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingEnabled: false
  },
  nextAction: "RUN_FOCUSED_CONTRACT_AND_TARGET_TSC_CHECK"
});
