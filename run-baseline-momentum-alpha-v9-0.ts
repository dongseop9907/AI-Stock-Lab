import { createSupabaseServerClient } from "@/lib/supabase";

type ScreenRow = {
  id: string;
  universe_code: string;
  as_of_date: string;
  market_date: string;
  status: string;
  total_members: number;
  master_eligible_count: number;
  data_ready_count: number;
  final_eligible_count: number;
  data_coverage_rate: number | string | null;
};

type FeatureRow = {
  stock_code: string;
  stock_name: string;
  market: string | null;
  latest_bar_date: string | null;
  latest_close: number | string | null;
  bar_count: number | string;
  return_5d: number | string | null;
  return_20d: number | string | null;
  avg_trading_value_20d: number | string | null;
  volume_ratio_5_to_20: number | string | null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pct = (items: {key:string; value:number}[]) => {
  const out = new Map<string, number>();
  const sorted = [...items].sort((a,b)=>a.value-b.value);
  if (sorted.length === 1) out.set(sorted[0].key, 1);
  else sorted.forEach((x,i)=>out.set(x.key, sorted.length ? i/(sorted.length-1) : 0));
  return out;
};

export async function runBaselineMomentumAlphaV90(input:{
  universeCode?: string;
  minimumCoverageRate?: number;
  topN?: number;
} = {}) {
  const supabase = createSupabaseServerClient();
  const universeCode = input.universeCode?.trim() || "KRX_ALL_LISTED";
  const minimumCoverageRate = Math.min(1, Math.max(0, input.minimumCoverageRate ?? 0.8));
  const topN = Math.min(200, Math.max(1, Math.floor(input.topN ?? 50)));

  const {data:screenData,error:screenError} = await supabase
    .from("stock_universe_screening_runs")
    .select("id,universe_code,as_of_date,market_date,status,total_members,master_eligible_count,data_ready_count,final_eligible_count,data_coverage_rate")
    .eq("universe_code", universeCode)
    .order("started_at",{ascending:false})
    .limit(1)
    .maybeSingle();

  if (screenError) throw new Error(`v9.0 screening load failed: ${screenError.message}`);
  const screen = (screenData ?? null) as ScreenRow | null;

  const hypothesis =
    "Within the point-in-time tradable/liquid universe, stronger recent cross-sectional momentum plus non-collapsing volume may have positive forward relative expectancy. This is a baseline hypothesis, not a production claim.";

  const validationPlan = {
    historicalBacktestAllowedNow: false,
    reason: "Historical point-in-time KRX membership including delisted securities is not yet complete.",
    requiredBeforeClaim: [
      "historical PIT universe",
      "corporate-action normalization",
      "purged/embargoed validation",
      "walk-forward OOS",
      "fees/slippage",
      "benchmark comparison",
      "forward shadow outcomes"
    ],
    automaticPromotion: false
  };

  const {data:exp,error:expError} = await supabase
    .from("alpha_research_experiments")
    .insert({
      alpha_name:"BASELINE_CROSS_SECTIONAL_MOMENTUM",
      alpha_version:"v9.0",
      hypothesis,
      research_mode:"FORWARD_BASELINE",
      universe_code:universeCode,
      universe_as_of_date:screen?.as_of_date ?? new Date().toISOString().slice(0,10),
      market_date:screen?.market_date ?? null,
      screening_run_id:screen?.id ?? null,
      status:"RUNNING",
      config:{
        formula:"0.60*pct(return20d)+0.20*pct(return5d)+0.20*pct(volumeRatio5To20)",
        rules:["return20d>0","return5d>0","volumeRatio5To20>=0.8"],
        topN,
        minimumCoverageRate,
        llmUsed:false,
        complexEnsembleUsed:false
      },
      validation_plan:validationPlan,
      screened_member_count:screen?.total_members ?? 0,
      data_ready_count:screen?.data_ready_count ?? 0,
      eligible_input_count:screen?.final_eligible_count ?? 0,
      production_applied:false
    })
    .select("id")
    .single();

  if (expError || !exp) throw new Error(`v9.0 experiment create failed: ${expError?.message ?? "NO_EXPERIMENT"}`);
  const experimentId = String(exp.id);

  try {
    const coverageRate = Number(screen?.data_coverage_rate ?? 0);
    const gatePassed = !!screen && screen.status === "SUCCESS" && coverageRate >= minimumCoverageRate;
    const dataGate = {
      passed:gatePassed,
      screeningRunId:screen?.id ?? null,
      screeningStatus:screen?.status ?? null,
      totalMembers:screen?.total_members ?? 0,
      dataReady:screen?.data_ready_count ?? 0,
      eligibleInput:screen?.final_eligible_count ?? 0,
      coverageRate,
      minimumCoverageRate,
      productionApplied:false
    };

    if (!gatePassed || !screen) {
      await supabase.from("alpha_research_experiments").update({
        status:"BLOCKED_DATA_COVERAGE",
        data_gate:dataGate,
        finished_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      }).eq("id",experimentId);

      return {
        version:"ALPHA_RESEARCH_FOUNDATION_V9_0",
        experimentId,
        status:"BLOCKED_DATA_COVERAGE",
        hypothesis,
        dataGate,
        validationPlan,
        message:"Finish v8.3 backfill and rerun v8.2.1. Alpha generation is intentionally blocked until coverage is sufficient.",
        safety:{productionApplied:false,ordersCreated:false,riskChanged:false,llmLiveSignalUsed:false}
      };
    }

    const rows:FeatureRow[] = [];
    const pageSize = 500;
    for (let offset=0;;offset+=pageSize) {
      const {data,error} = await supabase.rpc("compute_baseline_momentum_features_v9_0",{
        p_screen_run_id:screen.id,
        p_market_date:screen.market_date,
        p_offset:offset,
        p_limit:pageSize
      });
      if (error) throw new Error(`v9.0 feature RPC failed at ${offset}: ${error.message}`);
      const page = (data ?? []) as FeatureRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }

    const valid = rows.map(r=>({
      stockCode:r.stock_code,
      stockName:r.stock_name,
      market:r.market,
      latestBarDate:r.latest_bar_date,
      latestClose:num(r.latest_close),
      barCount:Number(r.bar_count ?? 0),
      return5d:num(r.return_5d),
      return20d:num(r.return_20d),
      avgTv20:num(r.avg_trading_value_20d),
      volumeRatio:num(r.volume_ratio_5_to_20)
    })).filter(r =>
      r.latestBarDate === screen.market_date &&
      r.latestClose !== null &&
      r.barCount >= 21 &&
      r.return5d !== null &&
      r.return20d !== null &&
      r.avgTv20 !== null &&
      r.volumeRatio !== null
    ) as Array<{
      stockCode:string; stockName:string; market:string|null; latestBarDate:string;
      latestClose:number; barCount:number; return5d:number; return20d:number;
      avgTv20:number; volumeRatio:number;
    }>;

    const p20 = pct(valid.map(r=>({key:r.stockCode,value:r.return20d})));
    const p5 = pct(valid.map(r=>({key:r.stockCode,value:r.return5d})));
    const pv = pct(valid.map(r=>({key:r.stockCode,value:r.volumeRatio})));

    const ranked = valid
      .filter(r=>r.return20d>0 && r.return5d>0 && r.volumeRatio>=0.8)
      .map(r=>({
        ...r,
        score: Math.min(1,Math.max(0,
          (p20.get(r.stockCode)??0)*0.60 +
          (p5.get(r.stockCode)??0)*0.20 +
          (pv.get(r.stockCode)??0)*0.20
        ))
      }))
      .sort((a,b)=> b.score-a.score || b.avgTv20-a.avgTv20)
      .map((r,i)=>({...r,rank:i+1,selected:i<topN}));

    for (let i=0;i<ranked.length;i+=500) {
      const chunk = ranked.slice(i,i+500).map(r=>({
        experiment_id:experimentId,
        stock_code:r.stockCode,
        stock_name:r.stockName,
        market:r.market,
        signal_date:screen.market_date,
        score:r.score,
        rank:r.rank,
        selected:r.selected,
        features:{
          latestClose:r.latestClose,
          return5d:r.return5d,
          return20d:r.return20d,
          averageTradingValue20d:r.avgTv20,
          volumeRatio5To20:r.volumeRatio,
          momentum20Percentile:p20.get(r.stockCode)??0,
          momentum5Percentile:p5.get(r.stockCode)??0,
          volumePercentile:pv.get(r.stockCode)??0
        },
        reasons:["POSITIVE_20D_MOMENTUM","POSITIVE_5D_MOMENTUM","RECENT_VOLUME_NOT_COLLAPSING"],
        production_applied:false
      }));
      const {error} = await supabase.from("alpha_research_signals").insert(chunk);
      if (error) throw new Error(`v9.0 signal insert failed: ${error.message}`);
    }

    await supabase.from("alpha_research_experiments").update({
      status:"COMPLETED",
      data_gate:dataGate,
      eligible_input_count:valid.length,
      signal_count:ranked.length,
      finished_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("id",experimentId);

    return {
      version:"ALPHA_RESEARCH_FOUNDATION_V9_0",
      experimentId,
      status:"COMPLETED",
      hypothesis,
      dataGate,
      validationPlan,
      counts:{
        screenEligible:screen.final_eligible_count,
        featureReady:valid.length,
        ruleEligible:ranked.length,
        selected:ranked.filter(x=>x.selected).length
      },
      topSignals:ranked.filter(x=>x.selected).slice(0,50),
      safety:{
        productionApplied:false,
        ordersCreated:false,
        riskChanged:false,
        llmLiveSignalUsed:false,
        complexEnsembleUsed:false,
        historicalBacktestClaimed:false
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_V9_0_ALPHA_ERROR";
    await supabase.from("alpha_research_experiments").update({
      status:"FAILED",
      error_message:message,
      finished_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("id",experimentId);
    throw error;
  }
}
