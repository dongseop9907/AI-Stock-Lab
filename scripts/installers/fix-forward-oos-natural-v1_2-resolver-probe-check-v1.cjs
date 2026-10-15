const fs = require("fs");
const path = require("path");

const root = process.cwd();

const probeRel =
  "scripts/forward-oos-natural-v1_2-full-commit-sha-resolver-v1-read-only-probe.cjs";

const probePath =
  path.resolve(root, probeRel);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_FORWARD_OOS_NATURAL_V1_2_RESOLVER_PROBE_CHECK_FIX_V1_FAILED",
    reason,
    ...extra
  }, null, 2));

  process.exitCode = 2;
}

if (!fs.existsSync(probePath)) {
  fail("PROBE_NOT_FOUND", { probeRel });
  return;
}

let source =
  fs.readFileSync(probePath, "utf8");

const oldText = `  producerExecuted:
    false,

  filesystemWritesZero:
    true,`;

const newText = `  producerNotExecuted:
    true,

  filesystemWritesZero:
    true,`;

if (source.includes(oldText)) {
  source =
    source.replace(
      oldText,
      newText,
    );
}
else if (
  source.includes(
    "producerNotExecuted:"
  )
) {
  console.log(
    "PROBE_CHECK_ALREADY_FIXED"
  );
}
else {
  fail(
    "EXPECTED_PROBE_CHECK_SHAPE_NOT_FOUND"
  );
  return;
}

fs.writeFileSync(
  probePath,
  source,
  "utf8",
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_FORWARD_OOS_NATURAL_V1_2_RESOLVER_PROBE_CHECK_FIX_V1_APPLIED",

  changed: [
    probeRel,
  ],

  fix: {
    previousCheck:
      "producerExecuted=false was incorrectly treated as a failed boolean check",

    newCheck:
      "producerNotExecuted=true",

    resolverLogicChanged:
      false,

    producerChanged:
      false,
  },

  safety: {
    producerExecuted:
      false,

    canonicalSessionFileWritten:
      false,

    sessionBackfilled:
      false,

    manifestPersisted:
      false,

    promotionShadowActivated:
      false,

    paperPromotionExecuted:
      false,

    realTradingChanged:
      false,
  },

  nextAction:
    "RERUN_STATIC_VERIFY_AND_READ_ONLY_PROBE",
}, null, 2));
