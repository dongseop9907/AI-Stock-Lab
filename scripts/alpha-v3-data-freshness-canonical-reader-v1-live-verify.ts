import fs from "node:fs";
import path from "node:path";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  readCanonicalDataFreshnessState,
} from "../lib/trading/data-freshness-canonical-reader";

import {
  evaluateDataFreshnessProductionAction,
} from "../lib/trading/data-freshness-production-contract";

const root =
  process.cwd();

const supabaseUrl =
  String(
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "",
  )
    .trim()
    .replace(/\/+$/, "");

const serviceRoleKey =
  String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    "",
  ).trim();

if (
  !supabaseUrl ||
  !serviceRoleKey
) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_CONFIG_MISSING",
  );
}

const supabase =
  createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

const state =
  await readCanonicalDataFreshnessState(
    supabase as never,
  );

const createDecision =
  evaluateDataFreshnessProductionAction(
    state,
    "PAPER_BUY_CREATE",
  );

const executeDecision =
  evaluateDataFreshnessProductionAction(
    state,
    "PAPER_BUY_EXECUTE",
  );

const checks = {
  canonicalVersion:
    state.version ===
      "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1",

  freshnessObserved:
    Boolean(
      state.freshnessObservedAt,
    ),

  qualityObserved:
    Boolean(
      state.qualityObservedAt,
    ),

  expectedMarketDatePresent:
    Boolean(
      state.expectedMarketDate,
    ),

  decisionConsistent:
    createDecision.allowed ===
      executeDecision.allowed,

  failClosedIfNotUsable:
    state.usableForProduction ===
      true ||
    (
      createDecision.allowed ===
        false &&
      executeDecision.allowed ===
        false
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) => !value,
    )
    .map(
      ([key]) => key,
    );

const report = {
  status:
    failed.length === 0
      ? "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1_LIVE_VERIFIED"
      : "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1_LIVE_REVIEW",

  checks,
  failed,

  state,

  decisions: {
    paperBuyCreate: {
      allowed:
        createDecision.allowed,

      reason:
        createDecision.reason,
    },

    paperBuyExecute: {
      allowed:
        executeDecision.allowed,

      reason:
        executeDecision.reason,
    },
  },

  safety: {
    databaseReads:
      2,

    databaseWrites:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,
  },

  nextGate:
    failed.length === 0
      ? "BIND_CANONICAL_FRESHNESS_GUARD_TO_ENTRY_CREATE_AND_FILL_V1"
      : "REVIEW_CANONICAL_FRESHNESS_LIVE_STATE",
};

const logFile =
  path.resolve(
    root,
    "logs/alpha-v3-data-freshness-canonical-reader-v1-live.json",
  );

fs.mkdirSync(
  path.dirname(
    logFile,
  ),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  logFile,
  JSON.stringify(
    report,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      checks:
        report.checks,

      failed:
        report.failed,

      state: {
        freshnessStatus:
          state.freshnessStatus,

        qualityStatus:
          state.qualityStatus,

        usableForProduction:
          state.usableForProduction,

        expectedMarketDate:
          state.expectedMarketDate,

        latestCommonDate:
          state.latestCommonDate,

        businessWeekdayLag:
          state.businessWeekdayLag,

        allSourceDatesAligned:
          state.allSourceDatesAligned,

        freshnessObservedAt:
          state.freshnessObservedAt,

        qualityObservedAt:
          state.qualityObservedAt,
      },

      decisions:
        report.decisions,

      safety:
        report.safety,

      logFile:
        "logs/alpha-v3-data-freshness-canonical-reader-v1-live.json",

      nextGate:
        report.nextGate,
    },
    null,
    2,
  ),
);

if (
  failed.length > 0
) {
  process.exitCode = 2;
}
