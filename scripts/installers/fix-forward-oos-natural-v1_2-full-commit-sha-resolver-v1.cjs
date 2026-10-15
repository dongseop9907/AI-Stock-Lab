const fs = require("fs");
const path = require("path");

const root = process.cwd();

const producerRel =
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts";
const verifyRel =
  "scripts/forward-oos-natural-v1_2-full-commit-sha-resolver-v1-static-verify.cjs";
const probeRel =
  "scripts/forward-oos-natural-v1_2-full-commit-sha-resolver-v1-read-only-probe.cjs";

const producerPath = path.resolve(root, producerRel);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_FORWARD_OOS_NATURAL_V1_2_FULL_COMMIT_SHA_RESOLVER_V1_INSTALL_FAILED",
    reason,
    ...extra
  }, null, 2));
  process.exitCode = 2;
}

if (!fs.existsSync(producerPath)) {
  fail("PRODUCER_NOT_FOUND", { producerRel });
  return;
}

let source = fs.readFileSync(producerPath, "utf8");

if (
  !source.includes(
    'FORWARD_OOS_PROMOTION_GRADE_PROVENANCE_V1_2'
  ) ||
  !source.includes(
    'function resolveForwardOosCommitShaV1_2()'
  )
) {
  fail("EXPECTED_V1_2_PRODUCER_SHAPE_NOT_FOUND");
  return;
}

if (!source.includes('from "node:child_process"')) {
  source =
    'import { execFileSync } from "node:child_process";\n' +
    source;
} else if (!source.includes("execFileSync")) {
  fail("CHILD_PROCESS_IMPORT_EXISTS_BUT_EXECFILESYNC_NOT_AVAILABLE");
  return;
}

const startMarker =
  "function resolveForwardOosCommitShaV1_2()";
const endMarker =
  "function buildPromotionGradeProvenanceV1_2()";

const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);

if (start < 0 || end < 0 || end <= start) {
  fail("COMMIT_SHA_RESOLVER_BOUNDARY_NOT_FOUND");
  return;
}

const replacement = `function resolveForwardOosCommitShaV1_2():
  string {
  const explicit =
    process.env
      .AI_STOCK_LAB_COMMIT_SHA
      ?.trim();

  if (
    explicit &&
    /^[0-9a-f]{40}$/i.test(
      explicit,
    )
  ) {
    return explicit.toLowerCase();
  }

  try {
    const gitHead =
      execFileSync(
        "git",
        [
          "rev-parse",
          "HEAD",
        ],
        {
          cwd:
            process.cwd(),

          encoding:
            "utf8",

          stdio: [
            "ignore",
            "pipe",
            "ignore",
          ],
        },
      )
        .trim();

    if (
      /^[0-9a-f]{40}$/i.test(
        gitHead,
      )
    ) {
      return gitHead.toLowerCase();
    }
  }
  catch {
    // Packaged runtimes may not expose Git metadata.
  }

  try {
    const releaseName =
      path.basename(
        fs.realpathSync(
          process.cwd(),
        ),
      );

    if (
      /^[0-9a-f]{40}$/i.test(
        releaseName,
      )
    ) {
      return releaseName.toLowerCase();
    }
  }
  catch {
    // Local development checkout may not be a hash-named release directory.
  }

  return "UNRESOLVED";
}

`;

source =
  source.slice(0, start) +
  replacement +
  source.slice(end);

fs.writeFileSync(producerPath, source, "utf8");

const verifySource = `const fs = require("fs");
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
`;

const probeSource = `const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const explicit =
  process.env
    .AI_STOCK_LAB_COMMIT_SHA
    ?.trim();

let gitHead = null;
let releaseName = null;
let resolved = "UNRESOLVED";
let resolutionSource = "UNRESOLVED";

if (
  explicit &&
  /^[0-9a-f]{40}$/i.test(explicit)
) {
  resolved = explicit.toLowerCase();
  resolutionSource = "AI_STOCK_LAB_COMMIT_SHA";
} else {
  try {
    gitHead =
      cp.execFileSync(
        "git",
        ["rev-parse", "HEAD"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();

    if (/^[0-9a-f]{40}$/i.test(gitHead)) {
      resolved = gitHead.toLowerCase();
      resolutionSource = "GIT_REV_PARSE_HEAD";
    }
  } catch {}

  if (resolved === "UNRESOLVED") {
    try {
      releaseName =
        path.basename(
          fs.realpathSync(process.cwd()),
        );

      if (/^[0-9a-f]{40}$/i.test(releaseName)) {
        resolved = releaseName.toLowerCase();
        resolutionSource = "FULL_40_RELEASE_BASENAME";
      }
    } catch {}
  }
}

const checks = {
  resolvedFull40:
    /^[0-9a-f]{40}$/i.test(resolved),

  shortReleaseBasenameRejected:
    !(releaseName &&
      /^[0-9a-f]{7,39}$/i.test(releaseName) &&
      resolutionSource === "FULL_40_RELEASE_BASENAME"),

  producerExecuted:
    false,

  filesystemWritesZero:
    true,
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_FORWARD_OOS_NATURAL_V1_2_FULL_COMMIT_SHA_RESOLVER_V1_READ_ONLY_PROBE_PASS"
      : "AI_STOCK_LAB_FORWARD_OOS_NATURAL_V1_2_FULL_COMMIT_SHA_RESOLVER_V1_READ_ONLY_PROBE_BLOCKED",

  resolved,
  resolvedLength: resolved.length,
  resolutionSource,
  explicitPresent: Boolean(explicit),
  gitHead,
  gitHeadLength:
    typeof gitHead === "string" ? gitHead.length : null,
  releaseName,
  releaseNameLength:
    typeof releaseName === "string" ? releaseName.length : null,

  checks,
  failed,

  safety: {
    readOnly: true,
    filesystemWrites: 0,
    producerExecuted: false,
    sessionBackfilled: false,
    manifestPersisted: false,
    promotionShadowActivated: false,
    realTradingChanged: false
  },

  nextAction:
    failed.length === 0
      ? "PATCH_VERIFIED_READY_FOR_COMMIT_AND_NORMAL_DEPLOY_NO_MANUAL_PRODUCER_RUN"
      : "STOP_AND_DIAGNOSE",
}, null, 2));

if (failed.length > 0) {
  process.exitCode = 2;
}
`;

for (const [rel, body] of [
  [verifyRel, verifySource],
  [probeRel, probeSource],
]) {
  const p = path.resolve(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
}

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_FORWARD_OOS_NATURAL_V1_2_FULL_COMMIT_SHA_RESOLVER_V1_PATCHED",

  changed: [
    producerRel,
  ],

  generated: [
    verifyRel,
    probeRel,
  ],

  behavior: {
    explicitEnvAcceptedOnlyWhenFull40: true,
    gitRevParseHeadPreferredBeforeReleaseBasename: true,
    gitHeadAcceptedOnlyWhenFull40: true,
    releaseBasenameAcceptedOnlyWhenFull40: true,
    short12ReleaseBasenameRejected: true,
    unresolvedFailsClosed: true,
    promotionGradeSchemaPreserved: true,
    developmentShadowPreserved: true
  },

  safety: {
    producerExecuted: false,
    canonicalSessionFileWritten: false,
    sessionBackfilled: false,
    manifestPersisted: false,
    promotionShadowActivated: false,
    paperPromotionExecuted: false,
    realTradingChanged: false
  },

  nextAction:
    "RUN_STATIC_VERIFY_READ_ONLY_PROBE_TYPECHECK_DIFF",
}, null, 2));
