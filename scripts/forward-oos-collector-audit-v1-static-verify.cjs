'use strict';
const fs = require('node:fs');
const path = require('node:path');
const p = path.join(process.cwd(), 'scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts');
const s = fs.existsSync(p) ? fs.readFileSync(p,'utf8') : '';
const checks = {
  sourceExists: Boolean(s),
  auditMarker: s.includes('FORWARD_OOS_COLLECTOR_COVERAGE_AUDIT_V1'),
  auditFile: s.includes('alpha-v3-entry-v3-forward-oos-collector-audit-v1.json'),
  noEligibleHandled: s.includes('NO_ELIGIBLE_SESSION'),
  partialDeferredHandled: s.includes('PARTIAL_OR_FULL_DEFERRED'),
  deferredReasonsPreserved: s.includes('reason: row.reason'),
  completeAccounted: s.includes('UNACCOUNTED_BATCH_ITEMS'),
  oldCollectorStatusPreserved: s.includes('ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_COLLECTION_COMPLETE'),
  originalCoverageRulePreserved: s.includes('minute.snapshots.length ===') && s.includes('381'),
};
const failed = Object.keys(checks).filter(k=>!checks[k]);
console.log(JSON.stringify({
 status: failed.length ? 'OOS_COLLECTOR_AUDIT_STATIC_FAIL' : 'OOS_COLLECTOR_AUDIT_STATIC_PASS',
 checks,failed,
 safety:{staticOnly:true,collectorRun:false,ordersCreated:0,realTradingChanged:false}
}, null, 2));
if(failed.length) process.exitCode=2;
