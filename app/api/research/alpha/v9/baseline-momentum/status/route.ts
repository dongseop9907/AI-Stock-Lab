import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const experimentId = url.searchParams.get("experimentId");
    const supabase = createSupabaseServerClient();

    let query = supabase
      .from("alpha_research_experiments")
      .select(`
        id,alpha_name,alpha_version,hypothesis,research_mode,
        universe_code,universe_as_of_date,market_date,screening_run_id,
        status,config,data_gate,validation_plan,
        screened_member_count,data_ready_count,eligible_input_count,signal_count,
        started_at,finished_at,error_message,production_applied
      `);

    if (experimentId) query = query.eq("id", experimentId);

    const {data:experiment,error} = await query
      .order("started_at",{ascending:false})
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);

    let selectedSignals: unknown[] = [];
    if (experiment?.id) {
      const {data,error:signalError} = await supabase
        .from("alpha_research_signals")
        .select("stock_code,stock_name,market,signal_date,score,rank,selected,features,reasons")
        .eq("experiment_id",experiment.id)
        .eq("selected",true)
        .order("rank",{ascending:true})
        .limit(50);
      if (signalError) throw new Error(signalError.message);
      selectedSignals = data ?? [];
    }

    return NextResponse.json({
      ok:true,
      result:{
        version:"ALPHA_RESEARCH_STATUS_V9_0",
        experiment:experiment ?? null,
        selectedSignals,
        productionApplied:false
      }
    });
  } catch (error) {
    return NextResponse.json(
      {ok:false,message:error instanceof Error ? error.message : "v9.0 alpha status failed."},
      {status:500},
    );
  }
}
