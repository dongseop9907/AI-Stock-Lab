const fs = require("fs");
const path = require("path");

const root = process.cwd();

const preflightRel =
  "scripts/alpha-v3-kill-switch-db-latch-audit-foundation-v1-preflight.cjs";

const file =
  path.resolve(
    root,
    preflightRel
  );

if (!fs.existsSync(file)) {
  throw new Error(
    "PREFLIGHT_FILE_NOT_FOUND"
  );
}

const before =
  fs.readFileSync(
    file,
    "utf8"
  );

let after =
  before
    .replaceAll(
      "?select=id,emergency_stop",
      "?select=control_key,emergency_stop"
    )
    .replaceAll(
      "&order=id.asc",
      "&control_key=eq.global&limit=1"
    )
    .replaceAll(
      "String(payload[0].id)",
      "String(payload[0].control_key)"
    );

fs.writeFileSync(
  file,
  after,
  "utf8"
);

const checks = {
  querySelectsControlKey:
    after.includes(
      "?select=control_key,emergency_stop"
    ),

  queryFiltersGlobal:
    after.includes(
      "&control_key=eq.global&limit=1"
    ),

  baselineUsesControlKey:
    after.includes(
      "String(payload[0].control_key)"
    ),

  staleIdSelectAbsent:
    !after.includes(
      "?select=id,emergency_stop"
    ),

  staleOrderByIdAbsent:
    !after.includes(
      "&order=id.asc"
    ),

  fileChanged:
    after !== before
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) => !value
    )
    .map(
      ([key]) => key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_KILL_SWITCH_PREFLIGHT_GLOBAL_QUERY_FIX_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_PREFLIGHT_GLOBAL_QUERY_FIX_V1_REVIEW",

      patchedFile:
        preflightRel,

      checks,
      failed,

      expectedQuery:
        "/rest/v1/trading_system_controls?select=control_key,emergency_stop&control_key=eq.global&limit=1",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0
      },

      nextAction:
        failed.length === 0
          ? "RERUN_STATIC_PREFLIGHT_DB_PUSH_AND_DB_VERIFY"
          : "REVIEW_PREFLIGHT_PATCH"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
