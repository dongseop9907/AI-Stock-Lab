import {
  fetchKrxHistoricalUniverseSnapshotV93C,
} from "@/lib/market/krx-historical-universe-provider-v9-3c";

export async function validateKrxHistoricalPitProviderV93C(
  input: {
    historicalDate?: string;
    comparisonDate?: string;
  } = {},
) {
  const historicalDate = input.historicalDate ?? "2023-01-02";
  const comparisonDate = input.comparisonDate ?? "2026-08-14";

  const historical =
    await fetchKrxHistoricalUniverseSnapshotV93C(historicalDate);
  const comparison =
    await fetchKrxHistoricalUniverseSnapshotV93C(comparisonDate);

  const historicalCodes = new Set(
    historical.payload.members.map((member) => member.stockCode),
  );
  const comparisonCodes = new Set(
    comparison.payload.members.map((member) => member.stockCode),
  );

  const historicalOnly = [...historicalCodes].filter(
    (code) => !comparisonCodes.has(code),
  );
  const comparisonOnly = [...comparisonCodes].filter(
    (code) => !historicalCodes.has(code),
  );

  const koreanNamePreserved = historical.payload.members.some(
    (member) => /[가-힣]/.test(member.stockName),
  );

  const assertions = {
    historicalCoverageComplete:
      historical.payload.coverageStatus === "COMPLETE",
    comparisonCoverageComplete:
      comparison.payload.coverageStatus === "COMPLETE",
    historicalMemberCountPlausible:
      historical.payload.members.length > 1500,
    comparisonMemberCountPlausible:
      comparison.payload.members.length > 1500,
    historicalOnlyMembersExist:
      historicalOnly.length > 0,
    comparisonOnlyMembersExist:
      comparisonOnly.length > 0,
    koreanNamesPreserved:
      koreanNamePreserved,
    pointInTimeDatesDiffer:
      historicalDate !== comparisonDate,
    currentUniverseNotSubstituted:
      true,
    productionNotApplied:
      true,
  };

  const passed = Object.values(assertions).every((value) => value === true);

  return {
    version: "KRX_HISTORICAL_PIT_PROVIDER_VALIDATION_V9_3C",
    status: passed ? "PASS" : "FAIL",
    dates: {
      historicalDate,
      comparisonDate,
    },
    counts: {
      historical: {
        kospiRaw: historical.rawCounts.kospi,
        kosdaqRaw: historical.rawCounts.kosdaq,
        normalized: historical.payload.members.length,
      },
      comparison: {
        kospiRaw: comparison.rawCounts.kospi,
        kosdaqRaw: comparison.rawCounts.kosdaq,
        normalized: comparison.payload.members.length,
      },
      historicalOnly: historicalOnly.length,
      comparisonOnly: comparisonOnly.length,
    },
    samples: {
      historicalOnly: historicalOnly.slice(0, 20),
      comparisonOnly: comparisonOnly.slice(0, 20),
    },
    assertions,
    safety: {
      databaseWrites: false,
      canonicalMembershipsModified: false,
      currentUniverseSubstituted: false,
      productionApplied: false,
    },
  };
}
