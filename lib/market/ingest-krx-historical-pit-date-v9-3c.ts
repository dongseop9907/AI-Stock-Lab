import {
  createSupabaseServerClient,
} from "@/lib/supabase";
import {
  ingestHistoricalUniverseSnapshotV93A,
} from "@/lib/market/ingest-historical-universe-snapshot-v9-3a";
import {
  fetchKrxHistoricalUniverseSnapshotV93C,
  KRX_HISTORICAL_PIT_PROVIDER_NAME_V93C,
} from "@/lib/market/krx-historical-universe-provider-v9-3c";

export async function ingestKrxHistoricalPitDateV93C(asOfDate: string) {
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("historical_universe_snapshot_imports")
    .select("id,observed_member_count")
    .eq("universe_code", "KRX_ALL_LISTED")
    .eq("as_of_date", asOfDate)
    .eq("provider", KRX_HISTORICAL_PIT_PROVIDER_NAME_V93C)
    .eq("coverage_status", "COMPLETE")
    .eq("status", "IMPORTED")
    .eq("is_validation", false)
    .limit(2);

  if (error) {
    throw new Error(`v9.3C existing-import lookup failed: ${error.message}`);
  }

  const existing = data ?? [];
  if (existing.length > 1) {
    throw new Error(`V9_3C_DUPLICATE_COMPLETE_IMPORTS_EXIST_${asOfDate}`);
  }

  if (existing.length === 1) {
    return {
      version: "KRX_HISTORICAL_PIT_DATE_INGEST_V9_3C",
      status: "REUSED_EXISTING_IMPORT",
      asOfDate,
      importId: existing[0].id,
      reused: true,
      observedMemberCount: existing[0].observed_member_count,
      apiRequestCount: 0,
      rawCounts: null,
      safety: {
        duplicateCompleteImportCreated: false,
        canonicalMembershipsModified: false,
        currentUniverseSubstituted: false,
        productionApplied: false,
      },
    };
  }

  const fetched = await fetchKrxHistoricalUniverseSnapshotV93C(asOfDate);
  const imported = await ingestHistoricalUniverseSnapshotV93A(fetched.payload);

  return {
    version: "KRX_HISTORICAL_PIT_DATE_INGEST_V9_3C",
    status: imported.status,
    asOfDate,
    importId: imported.importId,
    reused: false,
    observedMemberCount: imported.observedMemberCount,
    apiRequestCount: fetched.apiRequestCount,
    rawCounts: fetched.rawCounts,
    safety: {
      duplicateCompleteImportCreated: false,
      canonicalMembershipsModified: false,
      currentUniverseSubstituted: false,
      productionApplied: false,
    },
  };
}
