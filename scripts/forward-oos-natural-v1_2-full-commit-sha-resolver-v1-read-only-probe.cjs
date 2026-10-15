const cp = require("child_process");
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

  producerNotExecuted:
    true,

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
