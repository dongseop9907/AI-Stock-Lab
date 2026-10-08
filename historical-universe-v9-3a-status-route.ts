import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:Request) {
  try {
    const url=new URL(request.url);
    const universeCode=url.searchParams.get("universeCode") ?? "KRX_ALL_LISTED";
    const supabase=createSupabaseServerClient();

    const {data,error}=await supabase
      .from("historical_universe_snapshot_imports")
      .select(`
        id,universe_code,as_of_date,provider,provider_version,
        coverage_status,expected_member_count,observed_member_count,
        status,metadata,is_validation,started_at,finished_at,
        error_message,production_applied
      `)
      .eq("universe_code",universeCode)
      .eq("is_validation",false)
      .order("as_of_date",{ascending:false})
      .limit(30);

    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok:true,
      result:{
        version:"HISTORICAL_PIT_STATUS_V9_3A",
        universeCode,
        imports:data ?? [],
        canonicalMembershipsModified:false,
        productionApplied:false,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {ok:false,message:error instanceof Error ? error.message : "v9.3A status failed."},
      {status:500},
    );
  }
}
