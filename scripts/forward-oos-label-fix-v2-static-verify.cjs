'use strict';
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(process.cwd(), 'scripts');
const files = {
  summary: fs.readFileSync(path.join(base,'alpha-v3-true-forward-oos-summary.ts'),'utf8'),
  evaluator: fs.readFileSync(path.join(base,'alpha-v3-true-forward-oos-evaluator-v1.ts'),'utf8'),
  collector: fs.readFileSync(path.join(base,'alpha-v3-true-entry-forward-oos-collector-v1.ts'),'utf8'),
};
const checks = {
  summarySelectedPolicy: files.summary.includes('OOS_SELECTED_POLICY_BINDING_V2'),
  summaryMaturityGated: files.summary.includes('OOS_V2_MATURITY_GUARD'),
  evaluatorRejectsNull: files.evaluator.includes('OOS_NULL_MATURITY_GUARD_V2') && !/const x\s*=\s*Number\(value\)/.test(files.evaluator),
  evaluatorMaturityGated: files.evaluator.includes('row.maturity?.labelDefinition !== "KRX_T_PLUS_N_CLOSE_V2"'),
  exactKrxCalendar: files.collector.includes('nextKrxTradingDate(cursor)') && files.collector.includes('bar.date === horizonTradingDates.r3'),
  noLegacyIndexing: !/const b3\s*=\s*bars\[2\]/.test(files.collector),
  legacyEvidenceSaved: files.collector.includes('legacyHorizonLabelSnapshot'),
  frozenThresholdUnchanged: files.collector.includes('0.66') && files.collector.includes('0.01'),
  collectorCoverageAuditStillPresent: files.collector.includes('FORWARD_OOS_COLLECTOR_COVERAGE_AUDIT_V1'),
};
const failed = Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k);
console.log(JSON.stringify({status:failed.length?'OOS_LABEL_FIX_V2_STATIC_FAIL':'OOS_LABEL_FIX_V2_STATIC_PASS',checks,failed,safety:{staticOnly:true,ordersCreated:0,realTradingChanged:false}},null,2));
if(failed.length) process.exitCode=1;
