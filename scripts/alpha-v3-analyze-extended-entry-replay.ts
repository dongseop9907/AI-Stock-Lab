import fs from "node:fs";
import path from "node:path";

type Horizon = "r1" | "r3" | "r5";
const HORIZONS: Horizon[] = ["r1", "r3", "r5"];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function mean(values: number[]): number | null {
  return values.length ? values.reduce((a,b)=>a+b,0) / values.length : null;
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const s=[...values].sort((a,b)=>a-b);
  const m=Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}
function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m=mean(values)!;
  const v=values.reduce((sum,x)=>sum+(x-m)**2,0)/(values.length-1);
  return Math.sqrt(v);
}
function positiveRate(values: number[]): number | null {
  return values.length ? values.filter(v=>v>0).length/values.length : null;
}
function summarizeValues(values: number[]) {
  return {
    count: values.length,
    mean: mean(values),
    median: median(values),
    stdev: stdev(values),
    positiveRate: positiveRate(values),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
  };
}
function returnsFrom(rows:any[], getter:(row:any,h:Horizon)=>unknown) {
  const out: Record<Horizon, number[]> = {r1:[],r3:[],r5:[]};
  for (const row of rows) {
    for (const h of HORIZONS) {
      const v=getter(row,h);
      if (finite(v)) out[h].push(v);
    }
  }
  return out;
}
function summarizeReturnMap(map: Record<Horizon, number[]>) {
  return {
    r1: summarizeValues(map.r1),
    r3: summarizeValues(map.r3),
    r5: summarizeValues(map.r5),
  };
}
function policyForCap(row:any, cap:number) {
  return (row.limitPolicies ?? []).find((p:any)=>Number(p.maxPremium)===cap);
}
function quarterKey(date:string) {
  const y=date.slice(0,4);
  const m=Number(date.slice(5,7));
  return `${y}-Q${Math.floor((m-1)/3)+1}`;
}
function analyzeSubset(rows:any[], caps:number[]) {
  const qualified=rows.filter(r=>r.correctedEntry?.qualified===true);
  const directMap=returnsFrom(qualified,(r,h)=>r.correctedEntry?.directReturns?.[h]);

  const policies=caps.map(cap=>{
    const candidates=qualified.map(row=>({row,policy:policyForCap(row,cap)})).filter(x=>x.policy);
    const filled=candidates.filter(x=>x.policy.filled===true);
    const policyMap=returnsFrom(filled,(x,h)=>x.policy?.returns?.[h]);

    const paired: Record<Horizon, number[]> = {r1:[],r3:[],r5:[]};
    const directSame: Record<Horizon, number[]> = {r1:[],r3:[],r5:[]};
    const limitSame: Record<Horizon, number[]> = {r1:[],r3:[],r5:[]};
    const fillDelays:number[]=[];

    for (const {row,policy} of filled) {
      for (const h of HORIZONS) {
        const d=row.correctedEntry?.directReturns?.[h];
        const l=policy?.returns?.[h];
        if (finite(d) && finite(l)) {
          directSame[h].push(d);
          limitSame[h].push(l);
          paired[h].push(l-d);
        }
      }
      const s=row.correctedEntry?.observedAt;
      const f=policy?.observedAt;
      if (s && f) {
        const mins=(new Date(f).getTime()-new Date(s).getTime())/60000;
        if (Number.isFinite(mins) && mins>=0) fillDelays.push(mins);
      }
    }

    return {
      maxPremium: cap,
      candidateSessions: candidates.length,
      filledSessions: filled.length,
      fillRate: candidates.length ? filled.length/candidates.length : null,
      returns: summarizeReturnMap(policyMap),
      pairedVsDirect: {
        r1: summarizeValues(paired.r1),
        r3: summarizeValues(paired.r3),
        r5: summarizeValues(paired.r5),
      },
      directOnSameFilledSessions: summarizeReturnMap(directSame),
      limitOnSameFilledSessions: summarizeReturnMap(limitSame),
      fillDelayMinutes: summarizeValues(fillDelays),
    };
  });

  return {
    sessionCount: rows.length,
    correctedQualifiedSessions: qualified.length,
    qualificationRate: rows.length ? qualified.length/rows.length : null,
    direct: summarizeReturnMap(directMap),
    policies,
  };
}
function policyScore(policy:any) {
  const means=HORIZONS.map(h=>policy.returns?.[h]?.mean);
  if (means.some(v=>!finite(v))) return -Infinity;
  const pairedMeans=HORIZONS.map(h=>policy.pairedVsDirect?.[h]?.mean);
  const positivePaired=pairedMeans.filter(v=>finite(v) && v>0).length;
  const returnScore=means[0]*0.30 + means[1]*0.35 + means[2]*0.35;
  const fillRate=finite(policy.fillRate) ? policy.fillRate : 0;
  const pairedBonus=(positivePaired/3)*0.002;
  const fillPenalty=Math.max(0,0.85-fillRate)*0.02;
  return returnScore + pairedBonus - fillPenalty;
}
function main() {
  const root=process.cwd();
  const checkpointPath=path.join(root,"logs","alpha-v3-extended-entry-v3-replay-checkpoint.json");
  if (!fs.existsSync(checkpointPath)) throw new Error("ENTRY_V3_REPLAY_CHECKPOINT_NOT_FOUND");
  const checkpoint=JSON.parse(fs.readFileSync(checkpointPath,"utf8"));
  const rows=(checkpoint.results ?? []).sort((a:any,b:any)=>`${a.targetSessionDate}|${a.stockCode}`.localeCompare(`${b.targetSessionDate}|${b.stockCode}`));
  if (rows.length!==251) throw new Error(`EXPECTED_251_RESULTS_GOT_${rows.length}`);

  const keys=new Set(rows.map((r:any)=>`${r.targetSessionDate}|${r.stockCode}`));
  if (keys.size!==rows.length) throw new Error(`DUPLICATE_SESSION_KEYS:${rows.length-keys.size}`);

  const full=rows.filter((r:any)=>r.minuteCoverage?.fullCoverage===true && r.minuteCoverage?.sourceRows===381);
  const incomplete=rows.filter((r:any)=>!(r.minuteCoverage?.fullCoverage===true && r.minuteCoverage?.sourceRows===381));
  const caps=(checkpoint.premiumCaps ?? [0.0025,0.005,0.0075,0.01]).map(Number);

  const all=analyzeSubset(full,caps);

  const qmap=new Map<string, any[]>();
  for (const row of full) {
    const k=quarterKey(String(row.targetSessionDate));
    const arr=qmap.get(k) ?? [];
    arr.push(row);
    qmap.set(k,arr);
  }
  const byQuarter=[...qmap.entries()].map(([period,periodRows])=>({period,...analyzeSubset(periodRows,caps)}));

  const split=Math.floor(full.length/2);
  const firstHalf=analyzeSubset(full.slice(0,split),caps);
  const secondHalf=analyzeSubset(full.slice(split),caps);

  const ranked=all.policies.map((p:any)=>({...p,compositeScore:policyScore(p)})).sort((a:any,b:any)=>b.compositeScore-a.compositeScore);
  const best=ranked[0] ?? null;
  const bestCap=best?.maxPremium ?? null;

  function findCap(subset:any, cap:number) {
    return subset.policies.find((p:any)=>Number(p.maxPremium)===Number(cap));
  }
  const bestFirst=bestCap!==null ? findCap(firstHalf,bestCap) : null;
  const bestSecond=bestCap!==null ? findCap(secondHalf,bestCap) : null;
  const robustAcrossHalves=Boolean(
    bestFirst && bestSecond &&
    HORIZONS.every(h =>
      finite(bestFirst.pairedVsDirect?.[h]?.mean) &&
      finite(bestSecond.pairedVsDirect?.[h]?.mean) &&
      bestFirst.pairedVsDirect[h].mean > 0 &&
      bestSecond.pairedVsDirect[h].mean > 0
    )
  );

  const result={
    status:"ALPHA_V3_EXTENDED_ENTRY_V3_ANALYSIS_COMPLETE",
    counts:{
      totalSessions:rows.length,
      uniqueSessionKeys:keys.size,
      full381Sessions:full.length,
      incompleteSessions:incomplete.length,
      correctedQualifiedSessions:all.correctedQualifiedSessions,
      correctedQualificationRate:all.qualificationRate,
    },
    directCorrectedEntry:all.direct,
    limitPolicies:ranked,
    robustness:{
      firstHalf:{sessionCount:firstHalf.sessionCount,direct:firstHalf.direct,policies:firstHalf.policies},
      secondHalf:{sessionCount:secondHalf.sessionCount,direct:secondHalf.direct,policies:secondHalf.policies},
      byQuarter,
      bestPolicyPairedImprovementPositiveAcrossBothHalves:robustAcrossHalves,
    },
    decision:{
      bestObservedPremiumCap:bestCap,
      exactProductionCapLocked:false,
      structuralDirection:
        best &&
        best.fillRate >= 0.80 &&
        HORIZONS.filter(h=>finite(best.pairedVsDirect?.[h]?.mean) && best.pairedVsDirect[h].mean>0).length>=2
          ? "CORRECTED_ENTRY_GATE_PLUS_POST_SIGNAL_ANTI_CHASE_LIMIT"
          : "REVIEW_ENTRY_V3_BEFORE_PRODUCTION",
      rationale:"Use extended 251-session evidence to choose Entry V3 structural direction. Do not treat the best same-sample grid point as an immutable production optimum."
    },
    caveats:{
      universe:"5 active stocks only",
      costs:"gross returns; commissions, taxes, spread and slippage are not applied here",
      selection:"priceVolume Top1 universe selection",
      lookahead:"limit orders are simulated only at/after the actual corrected Entry signal time",
    },
    safety:{databaseReads:0,databaseWrites:0,ordersCreated:0,positionsChanged:0,productionChanged:false},
    nextGate:"DECIDE_ENTRY_V3_STRUCTURAL_DIRECTION_FROM_251_SESSION_ANALYSIS",
  };

  fs.writeFileSync(path.join(root,"logs","alpha-v3-extended-entry-v3-analysis.json"),JSON.stringify(result,null,2)+"\n","utf8");

  console.log(JSON.stringify({
    status:result.status,
    counts:result.counts,
    directCorrectedEntry:result.directCorrectedEntry,
    limitPolicies:result.limitPolicies.map((p:any)=>({
      maxPremium:p.maxPremium,
      candidateSessions:p.candidateSessions,
      filledSessions:p.filledSessions,
      fillRate:p.fillRate,
      returns:p.returns,
      pairedVsDirect:p.pairedVsDirect,
      fillDelayMinutes:p.fillDelayMinutes,
      compositeScore:p.compositeScore,
    })),
    robustness:{
      bestPolicyPairedImprovementPositiveAcrossBothHalves:result.robustness.bestPolicyPairedImprovementPositiveAcrossBothHalves,
      firstHalfSessionCount:result.robustness.firstHalf.sessionCount,
      secondHalfSessionCount:result.robustness.secondHalf.sessionCount,
    },
    decision:result.decision,
    nextGate:result.nextGate,
    outputFile:"logs/alpha-v3-extended-entry-v3-analysis.json",
  },null,2));
}
try { main(); }
catch (error) {
  console.error(JSON.stringify({
    status:"ALPHA_V3_EXTENDED_ENTRY_V3_ANALYSIS_FAILED",
    error:String(error instanceof Error ? error.message : error),
    databaseWrites:0,
    ordersCreated:0,
  },null,2));
  process.exitCode=2;
}
