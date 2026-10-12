import { createSupabaseServerClient } from "@/lib/supabase";

type Experiment = { id:string; alpha_name:string; alpha_version:string; status:string; market_date:string|null; signal_count:number };
type Outcome = {
  signal_id:string; experiment_id:string; stock_code:string; signal_date:string; signal_rank:number; selected:boolean;
  horizon_trading_days:number; entry_date:string|null; entry_open:number|string|null; exit_date:string|null;
  exit_close:number|string|null; raw_return:number|string|null; outcome_status:"PENDING_FUTURE_DATA"|"COMPLETED"|"INVALID_PRICE";
};

const n=(v:unknown):number|null=>{ if(v===null||v===undefined||v==="") return null; const x=Number(v); return Number.isFinite(x)?x:null; };
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const median=(a:number[])=>{ if(!a.length)return null; const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
const summary=(rows:{rawReturn:number}[])=>({
  count:rows.length,
  averageReturn:mean(rows.map(x=>x.rawReturn)),
  medianReturn:median(rows.map(x=>x.rawReturn)),
  positiveRate:rows.length?rows.filter(x=>x.rawReturn>0).length/rows.length:null,
});

async function resolveExperiment(experimentId?:string){
  const supabase=createSupabaseServerClient();
  let q=supabase.from("alpha_research_experiments").select("id,alpha_name,alpha_version,status,market_date,signal_count");
  q=experimentId?q.eq("id",experimentId):q.eq("status","COMPLETED");
  const {data,error}=await q.order("started_at",{ascending:false}).limit(1).maybeSingle();
  if(error) throw new Error(`v9.1 experiment lookup failed: ${error.message}`);
  return (data??null) as Experiment|null;
}

export async function evaluateAlphaForwardOutcomesV91(input:{experimentId?:string}={}){
  const supabase=createSupabaseServerClient();
  const experiment=await resolveExperiment(input.experimentId?.trim());
  if(!experiment) return {version:"ALPHA_FORWARD_EVALUATOR_V9_1",status:"WAITING_FOR_ALPHA_EXPERIMENT",message:"No completed alpha experiment exists yet.",productionApplied:false};
  if(experiment.status!=="COMPLETED") return {version:"ALPHA_FORWARD_EVALUATOR_V9_1",experimentId:experiment.id,status:"WAITING_FOR_ALPHA_EXPERIMENT",experimentStatus:experiment.status,productionApplied:false};

  const {data:run,error:runError}=await supabase.from("alpha_forward_evaluation_runs").insert({
    experiment_id:experiment.id,status:"RUNNING",signal_count:experiment.signal_count,
    expected_outcome_count:experiment.signal_count*5,production_applied:false
  }).select("id").single();
  if(runError||!run) throw new Error(`v9.1 evaluation run create failed: ${runError?.message??"NO_RUN"}`);
  const evaluationRunId=String(run.id);

  try{
    const {data,error}=await supabase.rpc("compute_alpha_forward_outcomes_v9_1",{p_experiment_id:experiment.id});
    if(error) throw new Error(`v9.1 outcome RPC failed: ${error.message}`);
    const rows=(data??[]) as Outcome[];
    const now=new Date().toISOString();
    const upserts=rows.map(r=>({
      experiment_id:r.experiment_id,signal_id:r.signal_id,stock_code:r.stock_code,signal_date:r.signal_date,
      signal_rank:r.signal_rank,selected:r.selected,horizon_trading_days:r.horizon_trading_days,
      entry_date:r.entry_date,entry_open:n(r.entry_open),exit_date:r.exit_date,exit_close:n(r.exit_close),raw_return:n(r.raw_return),
      status:r.outcome_status,evaluation_version:"ALPHA_FORWARD_EVALUATOR_V9_1",
      metadata:{entryConvention:"NEXT_TRADING_DAY_OPEN",exitConvention:"HORIZON_TRADING_DAY_CLOSE",futureBarRequired:true},
      production_applied:false,updated_at:now
    }));
    for(let i=0;i<upserts.length;i+=500){
      const {error:e}=await supabase.from("alpha_forward_outcomes").upsert(upserts.slice(i,i+500),{onConflict:"signal_id,horizon_trading_days"});
      if(e) throw new Error(`v9.1 outcome upsert failed: ${e.message}`);
    }

    const completed=rows.filter(r=>r.outcome_status==="COMPLETED"&&n(r.raw_return)!==null).map(r=>({rank:r.signal_rank,selected:r.selected,horizon:r.horizon_trading_days,rawReturn:Number(r.raw_return)}));
    const horizons=[1,3,5,10,20].map(h=>{
      const bucket=completed.filter(x=>x.horizon===h).sort((a,b)=>a.rank-b.rank);
      const q=Math.max(1,Math.floor(bucket.length/4));
      const top=bucket.slice(0,q),bottom=bucket.slice(Math.max(0,bucket.length-q));
      const ts=summary(top),bs=summary(bottom);
      return {
        horizonTradingDays:h,
        all:summary(bucket),
        selected:summary(bucket.filter(x=>x.selected)),
        unselected:summary(bucket.filter(x=>!x.selected)),
        rankSpread:{topQuartile:ts,bottomQuartile:bs,averageReturnSpread:ts.averageReturn!==null&&bs.averageReturn!==null?ts.averageReturn-bs.averageReturn:null}
      };
    });

    const pending=rows.filter(r=>r.outcome_status==="PENDING_FUTURE_DATA").length;
    const invalid=rows.filter(r=>r.outcome_status==="INVALID_PRICE").length;
    const completionRate=rows.length?completed.length/rows.length:0;
    const status=completed.length===0?"WAITING_FOR_FORWARD_DATA":completionRate>=0.95?"MATURE":"DEVELOPING";
    const resultSummary={
      experiment:{id:experiment.id,alphaName:experiment.alpha_name,alphaVersion:experiment.alpha_version,signalDate:experiment.market_date},
      counts:{signals:experiment.signal_count,expectedOutcomes:rows.length,completedOutcomes:completed.length,pendingOutcomes:pending,invalidOutcomes:invalid,completionRate},
      horizons,
      interpretation:{performanceClaimAllowed:false,reason:"Forward evidence accumulation only; one cohort is not proof of Alpha."},
      safety:{signalDateEntryUsed:false,nextTradingDayOpenEntry:true,futureBarsFabricated:false,productionApplied:false}
    };
    const {error:finishError}=await supabase.from("alpha_forward_evaluation_runs").update({
      status,completed_outcome_count:completed.length,pending_outcome_count:pending,invalid_outcome_count:invalid,
      summary:resultSummary,finished_at:now
    }).eq("id",evaluationRunId);
    if(finishError) throw new Error(`v9.1 evaluation finish failed: ${finishError.message}`);
    return {version:"ALPHA_FORWARD_EVALUATOR_V9_1",evaluationRunId,experimentId:experiment.id,status,summary:resultSummary,safety:{productionApplied:false,ordersCreated:false,riskChanged:false,usesOnlyBarsAfterSignalDate:true,entryAtNextTradingDayOpen:true}};
  }catch(error){
    const message=error instanceof Error?error.message:"UNKNOWN_V9_1_FORWARD_ERROR";
    await supabase.from("alpha_forward_evaluation_runs").update({status:"FAILED",error_message:message,finished_at:new Date().toISOString()}).eq("id",evaluationRunId);
    throw error;
  }
}
