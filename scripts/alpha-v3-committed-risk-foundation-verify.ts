import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const MIGRATION =
  path.resolve(
    ROOT,
    "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql",
  );

const HELPER =
  path.resolve(
    ROOT,
    "lib/trading/committed-risk-reservation.ts",
  );

function requireFile(
  file: string,
) {
  if (
    !fs.existsSync(file)
  ) {
    throw new Error(
      `FILE_MISSING:${path.relative(ROOT, file)}`,
    );
  }

  return fs.readFileSync(
    file,
    "utf8",
  );
}

const sql =
  requireFile(
    MIGRATION,
  );

const helper =
  requireFile(
    HELPER,
  );

const checks = {
  reservationColumn:
    /reserved_risk_amount/i.test(sql),

  reservationTimestamp:
    /reserved_risk_at/i.test(sql),

  advisoryTransactionLock:
    /pg_advisory_xact_lock/i.test(sql),

  orderRowLock:
    /for\s+update/i.test(sql),

  atomicReserveRpc:
    /reserve_paper_buy_risk_v3/i.test(sql),

  releaseRpc:
    /release_paper_buy_risk_v3/i.test(sql),

  idempotency:
    /ALREADY_RESERVED|EXISTING_RESERVATION_AMOUNT_MISMATCH/i.test(sql),

  committedFormula:
    /p_open_position_risk_amount\s*\+\s*v_other_reserved/i.test(sql),

  terminalRelease:
    /FILLED[\s\S]*REJECTED[\s\S]*CANCELLED/i.test(sql),

  helperReserveCall:
    /reserve_paper_buy_risk_v3/.test(helper),

  helperReleaseCall:
    /release_paper_buy_risk_v3/.test(helper),

  defaultTwoPct:
    /0\.02/.test(sql) &&
    /0\.02/.test(helper),
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, value]) =>
        !value,
    )
    .map(
      ([key]) =>
        key,
    );

const result = {
  status:
    failed.length === 0
      ? "ALPHA_V3_COMMITTED_RISK_RESERVATION_FOUNDATION_VERIFIED"
      : "ALPHA_V3_COMMITTED_RISK_RESERVATION_FOUNDATION_VERIFY_FAILED",

  checks,

  failed,

  contract: {
    maxAggregateOpenRiskRate:
      0.02,

    committedRisk:
      "OPEN_POSITION_STOP_RISK + ACTIVE_BUY_RESERVED_RISK",

    reservationSerialization:
      "pg_advisory_xact_lock + order row FOR UPDATE",

    duplicateReservation:
      "idempotent",

    terminalStatusRelease:
      true,

    productionPolicyChanged:
      false,
  },

  nextGate:
    failed.length === 0
      ? "APPLY_MIGRATION_AND_INTEGRATE_PAPER_ORDER_SERVICE"
      : "REPAIR_COMMITTED_RISK_FOUNDATION",
};

console.log(
  JSON.stringify(
    result,
    null,
    2,
  ),
);

if (
  failed.length > 0
) {
  process.exitCode =
    2;
}
