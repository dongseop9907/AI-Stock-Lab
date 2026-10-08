import fs from "node:fs";
import path from "node:path";

const VERSION =
  "ALPHA_V3_TRUE_FORWARD_OOS_READINESS_AUDIT_V1";

const FILES = {
  entry:
    path.resolve(
      process.cwd(),
      "scripts/alpha-v3-entry-v3-forward-shadow-oos.ts",
    ),

  exit:
    path.resolve(
      process.cwd(),
      "scripts/alpha-v3-exit-v3-forward-shadow-oos.ts",
    ),
};

function read(
  file: string,
): string {
  return fs.existsSync(file)
    ? fs.readFileSync(
        file,
        "utf8",
      )
    : "";
}

function hasAny(
  source: string,
  patterns: RegExp[],
): boolean {
  return patterns.some(
    (pattern) =>
      pattern.test(
        source,
      ),
  );
}

function main() {
  const entry =
    read(
      FILES.entry,
    );

  const exit =
    read(
      FILES.exit,
    );

  const entryChecks = {
    fileExists:
      entry.length >
      0,

    hasFrozenCutoffConcept:
      hasAny(
        entry,
        [
          /cutoff/i,
          /2026-10-07/,
        ],
      ),

    hasFrozenEntryCap:
      hasAny(
        entry,
        [
          /0\.01/,
          /entryPremiumCap/i,
        ],
      ),

    hasFrozenThreshold:
      hasAny(
        entry,
        [
          /0\.66/,
          /threshold/i,
        ],
      ),

    readsHistoricalCheckpoint:
      hasAny(
        entry,
        [
          /replay-checkpoint/i,
          /checkpoint/i,
        ],
      ),

    filtersPostCutoff:
      hasAny(
        entry,
        [
          /targetSessionDate[\s\S]{0,120}>[\s\S]{0,120}cutoff/i,
          /targetSessionDate[\s\S]{0,120}cutoff/i,
          /unseenSessions/i,
        ],
      ),

    persistsShadowState:
      hasAny(
        entry,
        [
          /writeFileSync/i,
          /state/i,
        ],
      ),

    hasLiveOrFutureDataSource:
      hasAny(
        entry,
        [
          /kis/i,
          /market_snapshots/i,
          /market_minute/i,
          /minute.*bar/i,
          /fetch/i,
          /supabase/i,
        ],
      ),

    appearsToAppendNewEntrySessions:
      hasAny(
        entry,
        [
          /checkpoint\.results\.push/i,
          /results\.push/i,
          /append.*checkpoint/i,
          /collect.*session/i,
          /generate.*session/i,
          /save.*session/i,
        ],
      ),

    appearsToWriteBackCheckpointOrFutureDataset:
      hasAny(
        entry,
        [
          /writeFileSync[\s\S]{0,500}checkpoint/i,
          /checkpoint[\s\S]{0,500}writeFileSync/i,
          /upsert/i,
          /insert/i,
        ],
      ),
  };

  const entryTrueCollectorEvidence =
    (
      entryChecks
        .hasLiveOrFutureDataSource &&
      entryChecks
        .appearsToAppendNewEntrySessions &&
      entryChecks
        .appearsToWriteBackCheckpointOrFutureDataset
    );

  const exitChecks = {
    fileExists:
      exit.length >
      0,

    hasFrozenPolicySet:
      (
        /BASELINE/.test(
          exit,
        ) &&
        /TREND_FOLLOW/.test(
          exit,
        ) &&
        /FIXED_STOP_4PCT/.test(
          exit,
        )
      ),

    hasFrozenCutoffConcept:
      hasAny(
        exit,
        [
          /cutoff/i,
          /2026-10-07/,
        ],
      ),

    readsFutureDailyBars:
      hasAny(
        exit,
        [
          /market_daily_bars/i,
          /supabase/i,
        ],
      ),

    dependsOnEntryForwardData:
      hasAny(
        exit,
        [
          /entry.*forward/i,
          /checkpoint/i,
          /unseen/i,
        ],
      ),

    persistsShadowState:
      hasAny(
        exit,
        [
          /writeFileSync/i,
          /state/i,
        ],
      ),
  };

  const trueForwardReady =
    (
      entryChecks
        .fileExists &&
      entryChecks
        .hasFrozenCutoffConcept &&
      entryChecks
        .hasFrozenEntryCap &&
      entryChecks
        .hasFrozenThreshold &&
      entryChecks
        .filtersPostCutoff &&
      entryChecks
        .persistsShadowState &&
      entryTrueCollectorEvidence &&
      exitChecks
        .fileExists &&
      exitChecks
        .hasFrozenPolicySet &&
      exitChecks
        .hasFrozenCutoffConcept
    );

  const report = {
    status:
      "ALPHA_V3_TRUE_FORWARD_OOS_READINESS_AUDIT_COMPLETE",

    version:
      VERSION,

    entryChecks,

    entryTrueCollectorEvidence,

    exitChecks,

    decision: {
      trueForwardReady,

      historicalForwardScriptsCanBeTrustedAsTrueOOSCollector:
        trueForwardReady,

      likelyStaticCheckpointProblem:
        !entryTrueCollectorEvidence,

      productionPolicyLocked:
        false,

      nextUse:
        trueForwardReady
          ? "START_TRUE_FORWARD_OOS_COLLECTION"
          : "BUILD_TRUE_ENTRY_V3_FORWARD_OOS_COLLECTOR",
    },

    safety: {
      databaseReads:
        0,
      databaseWrites:
        0,
      kisRequests:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
      productionChanged:
        false,
    },

    nextGate:
      trueForwardReady
        ? "START_TRUE_FORWARD_OOS_COLLECTION"
        : "BUILD_TRUE_ENTRY_V3_FORWARD_OOS_COLLECTOR",
  };

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );
}

try {
  main();
} catch (
  error
) {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_TRUE_FORWARD_OOS_READINESS_AUDIT_FAILED",

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
      null,
      2,
    ),
  );

  process.exitCode =
    1;
}
