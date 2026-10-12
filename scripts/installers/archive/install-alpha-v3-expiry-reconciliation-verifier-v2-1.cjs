const fs = require("fs");
const path = require("path");

const root = process.cwd();

const verifierRel =
  "scripts/alpha-v3-committed-risk-expiry-reconciliation-v2-verify.cjs";

const verifierFile =
  path.resolve(
    root,
    verifierRel
  );

const backupFile =
  path.resolve(
    root,
    "scripts/alpha-v3-committed-risk-expiry-reconciliation-v2-verify.cjs.before-v2-1.bak"
  );

if (!fs.existsSync(verifierFile)) {
  throw new Error(
    `VERIFIER_NOT_FOUND:${verifierRel}`
  );
}

let text =
  fs.readFileSync(
    verifierFile,
    "utf8"
  );

if (!fs.existsSync(backupFile)) {
  fs.copyFileSync(
    verifierFile,
    backupFile
  );
}

/*
 * V2 used a broad pattern beginning at the first
 * "from public.paper_order_requests" in the function.
 * Because the function first scans candidate rows, that regex could span
 * from the candidate SELECT to the later FOR UPDATE and falsely report the
 * row-lock index before pg_advisory_xact_lock.
 *
 * Match the actual locked canonical row read instead:
 *
 *   select *
 *   into v_order
 *   from public.paper_order_requests
 *   where id = ...
 *   for update;
 */
const oldPattern =
`/from\\s+public\\.paper_order_requests[\\s\\S]{0,800}?for\\s+update\\s*;/i`;

const newPattern =
`/select\\s+\\*[\\s\\S]{0,300}?into\\s+v_order[\\s\\S]{0,300}?from\\s+public\\.paper_order_requests[\\s\\S]{0,500}?for\\s+update\\s*;/i`;

let replacements = 0;

while (text.includes(oldPattern)) {
  text =
    text.replace(
      oldPattern,
      newPattern
    );

  replacements += 1;
}

if (replacements !== 2) {
  throw new Error(
    `EXPECTED_TWO_ROW_LOCK_PATTERN_REPLACEMENTS_GOT:${replacements}`
  );
}

fs.writeFileSync(
  verifierFile,
  text,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_EXPIRY_RECONCILIATION_VERIFIER_V2_1_INSTALLED",

      patchedFile:
        verifierRel,

      backupFile:
        "scripts/alpha-v3-committed-risk-expiry-reconciliation-v2-verify.cjs.before-v2-1.bak",

      fix:
        "MATCH_CANONICAL_SELECT_INTO_V_ORDER_FOR_UPDATE_INSTEAD_OF_CANDIDATE_SCAN",

      replacements,

      migrationChanged:
        false,

      databaseWrites:
        0,

      nextAction:
        "RERUN_EXPIRY_RECONCILIATION_V2_VERIFY"
    },
    null,
    2
  )
);
