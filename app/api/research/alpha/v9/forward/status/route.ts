import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const experimentId=url.searchParams.get("experimentId");
    const supabase=createSupabaseServerClient();
    let q=supabase.from("alpha_forward_evaluation_runs").select("id,experiment_id,evaluation_version,status,signal_count,expected_outcome_count,completed_outcome_count,pending_outcome_count,invalid_outcome_count,summary,started_at,finished_at,error_message,production_applied");
    if(experimentId) q=q.eq("experiment_id",experimentId);
    const {data,error}=await q.order("started_at",{ascending:false}).limit(1).maybeSingle();
    if(error) throw new Error(error.message);
    return NextResponse.json({ok:true,result:{version:"ALPHA_FORWARD_STATUS_V9_1",latestEvaluation:data??null,productionApplied:false}});
  }catch(error){
    return NextResponse.json({ok:false,message:error instanceof Error?error.message:"v9.1 forward status failed."},{status:500});
  }
}
