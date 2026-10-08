import {
  refreshCorporateActionHistoryV9726,
} from "../lib/market/refresh-corporate-action-history-v9-7-26";

async function main() {
  const result =
    await refreshCorporateActionHistoryV9726({
      dryRun:
        true,
      includeValidationEvents:
        true,
      detectionLookbackCalendarDays:
        366,
      throughDate:
        "2026-10-01",
    });

  console.log(
    JSON.stringify(
      {
        status:
          "V9_7_27_VALIDATION_DRY_RUN_COMPLETE",
        version:
          result.version,
        dryRun:
          result.dryRun,
        includeValidationEvents:
          result.includeValidationEvents,
        throughDate:
          result.throughDate,
        detectionStartDate:
          result.detectionStartDate,
        refreshEligibleThroughDate:
          result.refreshEligibleThroughDate,
        actionTypes:
          result.actionTypes,
        counts:
          result.counts,
        targets:
          result.targets.map(
            (target) => ({
              stockCode:
                target.stockCode,
              actionType:
                target.actionType,
              effectiveDate:
                target.effectiveDate,
              staleEvidence:
                target.staleEvidence,
              earliestStoredDate:
                target.earliestStoredDate,
              refreshStartDate:
                target.refreshStartDate,
              refreshEndDate:
                target.refreshEndDate,
              status:
                target.status,
            }),
          ),
        writesPerformed:
          0,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      error instanceof Error
        ? error.message
        : error,
    );

    process.exitCode =
      1;
  },
);
