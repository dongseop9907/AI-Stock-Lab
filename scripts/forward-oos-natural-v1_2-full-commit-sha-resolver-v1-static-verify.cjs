const fs = require("fs");
const path = require("path");

const root = process.cwd();
const producerRel =
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts";
const producerPath =
  path.resolve(root, producerRel);

const source =
  fs.readFileSync(producerPath, "utf8");

const fnStart =
  source.indexOf("function resolveForwardOosCommitShaV1_2()");
const fnEnd =
  source.indexOf("function buildPromotionGradeProvenanceV1_2()");
const fn =
  fnStart >= 0 && fnEnd > fnStart
    ? source.slice(fnStart, fnEnd)
    : "";

const explicitPos = fn.indexOf("AI_STOCK_LAB_COMMIT_SHA");
const gitPos = fn.indexOf('"rev-parse"');
const releasePos = fn.indexOf("releaseName");

const checks = {
  producerExists:
    fs.existsSync(producerPath),

  promotionGradeSchemaPreserved:
    source.includes("FORWARD_OOS_PROMOTION_GRADE_PROVENANCE_V1_2") &&
    source.includes("promotionGradeSchemaVersion:"),

  childProcessExecFileSyncImported:
    source.includes("execFileSync") &&
    source.includes('from "node:child_process"'),

  explicitCommitRequiresFull40:
    fn.includes("/^[0-9a-f]{40}$/i.test") &&
    !fn.includes("{7,40}"),

  gitRevParseHeadPresent:
    fn.includes('"rev-parse"') &&
    fn.includes('"HEAD"'),

  gitResolutionBeforeReleaseBasename:
    explicitPos >= 0 &&
    gitPos > explicitPos &&
    releasePos > gitPos,

  gitHeadRequiresFull40:
    fn.includes("gitHead") &&
    fn.includes("return gitHead.toLowerCase()"),

  releaseFallbackRequiresFull40:
    fn.includes("releaseName") &&
    fn.includes("return releaseName.toLowerCase()") &&
    !fn.includes("{7,40}"),

  unresolvedFailClosed:
    fn.includes('return "UNRESOLVED"'),

  developmentShadowPreserved:
    source.includes('"DEVELOPMENT_SHADOW"'),

  strategyVersionsPreserved:
    source.includes('"TRUE_FORWARD_TOP1_V1"') &&
    source.includes('"ALPHA_V3"') &&
    source.includes('"ENTRY_V3"') &&
    source.includes('"RISK_V3"'),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_FORWARD_OOS_NATURAL_V1_2_FULL_COMMIT_SHA_RESOLVER_V1_STATIC_VERIFIED"
      : "AI_STOCK_LAB_FORWARD_OOS_NATURAL_V1_2_FULL_COMMIT_SHA_RESOLVER_V1_STATIC_FAILED",

  classification:
    failed.length === 0
      ? "FULL_40_COMMIT_SHA_REQUIRED_GIT_HEAD_BEFORE_RELEASE_BASENAME_FAIL_CLOSED"
      : "COMMIT_SHA_RESOLVER_PATCH_REQUIRES_FIX",

  checks,
  failed,

  safety: {
    producerExecuted: false,
    sessionBackfilled: false,
    canonicalSessionFileWritten: false,
    manifestPersisted: false,
    promotionShadowActivated: false,
    paperPromotionExecuted: false,
    realTradingChanged: false
  },

  nextAction:
    failed.length === 0
      ? "RUN_READ_ONLY_RESOLVER_PROBE_TYPECHECK_DIFF"
      : "STOP_AND_DIAGNOSE",
}, null, 2));

if (failed.length > 0) {
  process.exitCode = 2;
}
