import { createHash } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase";
import type { HistoricalUniverseSnapshotPayload } from "@/lib/market/historical-universe-provider-v9-3a";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(value:string,name:string) {
  if (!dateRe.test(value)) throw new Error(`INVALID_${name}`);
  return value;
}

function clean(value:unknown) {
  return String(value ?? "").trim();
}

function makeFingerprint(input:HistoricalUniverseSnapshotPayload) {
  const members=[...input.members].map(m=>({
    stockCode:clean(m.stockCode),
    stockName:clean(m.stockName),
    market:m.market,
    securityType:clean(m.securityType ?? "UNKNOWN"),
    listed:m.listed !== false,
    tradable:m.tradable !== false,
    listingDate:m.listingDate ?? null,
    delistingDate:m.delistingDate ?? null,
  })).sort((a,b)=>a.stockCode.localeCompare(b.stockCode));

  return createHash("sha256")
    .update(JSON.stringify({
      universeCode:input.universeCode,
      asOfDate:input.asOfDate,
      provider:input.provider,
      providerVersion:input.providerVersion,
      coverageStatus:input.coverageStatus,
      members,
    }))
    .digest("hex");
}

export async function ingestHistoricalUniverseSnapshotV93A(
  input:HistoricalUniverseSnapshotPayload,
) {
  const supabase=createSupabaseServerClient();

  const universeCode=clean(input.universeCode);
  const asOfDate=requireDate(input.asOfDate,"AS_OF_DATE");
  const provider=clean(input.provider);
  const providerVersion=clean(input.providerVersion);

  if (!universeCode || !provider || !providerVersion) {
    throw new Error("V9_3A_REQUIRED_METADATA_MISSING");
  }

  if (!["COMPLETE","PARTIAL","UNKNOWN"].includes(input.coverageStatus)) {
    throw new Error("V9_3A_INVALID_COVERAGE_STATUS");
  }

  const seen=new Set<string>();
  const members=input.members.map(member=>{
    const stockCode=clean(member.stockCode);
    const stockName=clean(member.stockName);
    if (!stockCode || !stockName) throw new Error("V9_3A_EMPTY_STOCK_IDENTITY");
    if (seen.has(stockCode)) throw new Error(`V9_3A_DUPLICATE_STOCK_CODE_${stockCode}`);
    seen.add(stockCode);

    return {
      stockCode,
      stockName,
      market:member.market,
      sector:member.sector ?? null,
      securityType:clean(member.securityType ?? "UNKNOWN") || "UNKNOWN",
      listed:member.listed !== false,
      tradable:member.tradable !== false,
      listingDate:member.listingDate ? requireDate(member.listingDate,"LISTING_DATE") : null,
      delistingDate:member.delistingDate ? requireDate(member.delistingDate,"DELISTING_DATE") : null,
      sourcePayload:member.sourcePayload ?? {},
    };
  });

  const sourceFingerprint=makeFingerprint({
    ...input,
    members:members.map(m=>({
      stockCode:m.stockCode,
      stockName:m.stockName,
      market:m.market,
      sector:m.sector,
      securityType:m.securityType,
      listed:m.listed,
      tradable:m.tradable,
      listingDate:m.listingDate,
      delistingDate:m.delistingDate,
      sourcePayload:m.sourcePayload,
    })),
  });

  const {data:existing,error:existingError}=await supabase
    .from("historical_universe_snapshot_imports")
    .select("id,status,observed_member_count")
    .eq("universe_code",universeCode)
    .eq("as_of_date",asOfDate)
    .eq("provider",provider)
    .eq("source_fingerprint",sourceFingerprint)
    .eq("is_validation",input.isValidation===true)
    .maybeSingle();

  if (existingError) throw new Error(`v9.3A duplicate lookup failed: ${existingError.message}`);

  if (existing?.status==="IMPORTED") {
    return {
      version:"HISTORICAL_PIT_INGESTION_V9_3A",
      importId:existing.id,
      status:"IMPORTED",
      reused:true,
      observedMemberCount:existing.observed_member_count,
      sourceFingerprint,
      canonicalMembershipsModified:false,
      productionApplied:false,
    };
  }

  const {data:run,error:runError}=await supabase
    .from("historical_universe_snapshot_imports")
    .insert({
      universe_code:universeCode,
      as_of_date:asOfDate,
      provider,
      provider_version:providerVersion,
      coverage_status:input.coverageStatus,
      expected_member_count:input.expectedMemberCount ?? null,
      observed_member_count:0,
      source_fingerprint:sourceFingerprint,
      status:"RUNNING",
      metadata:input.metadata ?? {},
      is_validation:input.isValidation===true,
      production_applied:false,
    })
    .select("id")
    .single();

  if (runError || !run) throw new Error(`v9.3A import create failed: ${runError?.message ?? "NO_RUN"}`);
  const importId=String(run.id);

  try {
    const rows=members.map(m=>({
      import_id:importId,
      stock_code:m.stockCode,
      stock_name:m.stockName,
      market:m.market,
      sector:m.sector,
      security_type:m.securityType,
      listed:m.listed,
      tradable:m.tradable,
      listing_date:m.listingDate,
      delisting_date:m.delistingDate,
      source_payload:m.sourcePayload,
    }));

    for (let offset=0;offset<rows.length;offset+=500) {
      const {error}=await supabase
        .from("historical_universe_snapshot_rows")
        .insert(rows.slice(offset,offset+500));
      if (error) throw new Error(`v9.3A row insert failed at ${offset}: ${error.message}`);
    }

    const {error:finishError}=await supabase.rpc(
      "finish_historical_universe_import_v9_3a",
      {
        p_import_id:importId,
        p_status:"IMPORTED",
        p_observed_member_count:rows.length,
        p_error_message:null,
      },
    );
    if (finishError) throw new Error(`v9.3A finish failed: ${finishError.message}`);

    return {
      version:"HISTORICAL_PIT_INGESTION_V9_3A",
      importId,
      status:"IMPORTED",
      reused:false,
      universeCode,
      asOfDate,
      provider,
      providerVersion,
      coverageStatus:input.coverageStatus,
      observedMemberCount:rows.length,
      expectedMemberCount:input.expectedMemberCount ?? null,
      sourceFingerprint,
      safety:{
        canonicalMembershipsModified:false,
        currentUniverseBackfilledIntoPast:false,
        dbClockUsedForFinishedAt:true,
        productionApplied:false,
      },
    };
  } catch (error) {
    const message=error instanceof Error ? error.message : "UNKNOWN_V9_3A_IMPORT_ERROR";
    await supabase.rpc("finish_historical_universe_import_v9_3a",{
      p_import_id:importId,
      p_status:"FAILED",
      p_observed_member_count:0,
      p_error_message:message,
    });
    throw error;
  }
}
