'use strict';
// V9.7.5.1 read-only dividend effective-date repair probe.
// Primary evidence remains V9.7.5 direct KRX KIND market-action disclosures.
// For unresolved CASH_DIVIDEND only, a deterministic fallback is allowed when:
//   1) DART already proved an explicit record date,
//   2) KRX official holiday calendar can be fetched for the relevant years, and
//   3) the ex-dividend date is derived from KRX T+2 settlement mechanics.
// NEVER writes Supabase/events and NEVER promotes coverage.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_5_1_DIVIDEND_MARKET_ADJUSTMENT_REPAIR_PROBE';
const INPUT_PARSE_VERSION = 'V9_7_3_PARSE_PROBE';
const INPUT_MARKET_VERSION = 'V9_7_5_DIVIDEND_MARKET_ADJUSTMENT_PROBE';
const KRX_OPEN = 'https://open.krx.co.kr';
const HOLIDAY_PAGE = '/contents/MKD/01/0110/01100305/MKD01100305.jsp';
const HOLIDAY_OTP_BLD = 'MKD/01/0110/01100305/mkd01100305_01';
const HOLIDAY_QUERY_URL = `${KRX_OPEN}/contents/OPN/99/OPN99000001.jspx`;
const MAX_RESPONSE = 4 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'KRX_HOLIDAY_REQUEST_FAILED';
}

function save(file, state) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function assertIso(v) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(v ?? '')) throw new Error('INVALID_ISO_DATE');
  const d = new Date(v + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== v) throw new Error('INVALID_ISO_DATE');
  return v;
}

function shiftCalendarDays(iso, days) {
  assertIso(iso);
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

function compareIso(a,b) { return a < b ? -1 : a > b ? 1 : 0; }
function yearOf(iso) { return Number(assertIso(iso).slice(0,4)); }

function isWeekend(iso) {
  const d = new Date(assertIso(iso) + 'T00:00:00Z');
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}

function normalizeHolidayDate(v) {
  if (typeof v !== 'string') return null;
  const m = v.match(/(20\d{2})[-./]?(\d{2})[-./]?(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  try { return assertIso(iso); } catch { return null; }
}

async function fetchBytes(url, options={}, fetcher=fetch) {
  const response = await fetcher(url, {redirect:'follow', cache:'no-store', signal:AbortSignal.timeout(45000), ...options});
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_RESPONSE) throw new Error('RESPONSE_TOO_LARGE');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE) throw new Error('RESPONSE_TOO_LARGE');
  return {bytes, text:bytes.toString('utf8'), sha256:sha256(bytes)};
}

async function generateHolidayOtp(fetcher=fetch) {
  const bld = encodeURIComponent(HOLIDAY_OTP_BLD);
  const url = `${KRX_OPEN}/contents/COM/GenerateOTP.jspx?bld=${bld}&name=form&_=${Date.now()}`;
  const out = await fetchBytes(url, {headers:{'user-agent':UA,'referer':`${KRX_OPEN}${HOLIDAY_PAGE}`}}, fetcher);
  const otp = out.text.trim();
  if (!otp || otp.length > 500 || /<html/i.test(otp)) throw new Error('KRX_HOLIDAY_OTP_INVALID');
  return {otp, sha256:out.sha256};
}

function extractHolidayRows(json) {
  if (!isObject(json)) throw new Error('KRX_HOLIDAY_JSON_INVALID');
  const arrays = [];
  for (const [k,v] of Object.entries(json)) if (Array.isArray(v)) arrays.push([k,v]);
  const rows = (json.block1 && Array.isArray(json.block1)) ? json.block1 : (arrays.sort((a,b)=>b[1].length-a[1].length)[0]?.[1] ?? []);
  const dates = new Set();
  for (const row of rows) {
    if (!isObject(row)) continue;
    for (const [k,v] of Object.entries(row)) {
      if (!/(calnd|date|dd)/i.test(k)) continue;
      const iso = normalizeHolidayDate(String(v));
      if (iso) { dates.add(iso); break; }
    }
  }
  return {rows, dates};
}

async function fetchKrxHolidays(year, options={}) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('INVALID_YEAR');
  const fetcher = options.fetcher ?? fetch;
  const otp = await generateHolidayOtp(fetcher);
  const body = new URLSearchParams({
    search_bas_yy:String(year), gridTp:'KRX', pagePath:HOLIDAY_PAGE, code:otp.otp, pageFirstCall:'Y'
  }).toString();
  const out = await fetchBytes(HOLIDAY_QUERY_URL, {
    method:'POST',
    headers:{'user-agent':UA,'referer':`${KRX_OPEN}${HOLIDAY_PAGE}`,'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body
  }, fetcher);
  let json;
  try { json = JSON.parse(out.text); } catch { throw new Error('KRX_HOLIDAY_JSON_INVALID'); }
  const parsed = extractHolidayRows(json);
  if (!parsed.rows.length || !parsed.dates.size) throw new Error('KRX_HOLIDAY_ROWS_EMPTY');
  return {year, dates:parsed.dates, rowCount:parsed.rows.length, sha256:out.sha256, otpSha256:otp.sha256};
}

function isTradingDay(iso, holidaySet) {
  return !isWeekend(iso) && !holidaySet.has(iso);
}

function nextTradingDay(iso, holidaySet) {
  let d = shiftCalendarDays(iso, 1);
  for (let i=0;i<20;i++,d=shiftCalendarDays(d,1)) if (isTradingDay(d,holidaySet)) return d;
  throw new Error('TRADING_DAY_NOT_FOUND');
}

function settlementDateT2(tradeDate, holidaySet) {
  let d = tradeDate;
  for (let i=0;i<2;i++) d = nextTradingDay(d, holidaySet);
  return d;
}

function deriveExDividendDate(recordDate, holidaySet) {
  assertIso(recordDate);
  // Find the latest trade whose T+2 settlement occurs on or before record date.
  let d = shiftCalendarDays(recordDate, -1);
  let cumDate = null;
  for (let i=0;i<25;i++,d=shiftCalendarDays(d,-1)) {
    if (!isTradingDay(d, holidaySet)) continue;
    const settlement = settlementDateT2(d, holidaySet);
    if (compareIso(settlement, recordDate) <= 0) { cumDate = d; break; }
  }
  if (!cumDate) throw new Error('CUM_DIVIDEND_DATE_NOT_FOUND');
  const exDate = nextTradingDay(cumDate, holidaySet);
  if (compareIso(exDate, recordDate) >= 0 && isTradingDay(recordDate, holidaySet)) {
    // For a normal trading-day record date, ex-date must precede record date.
    throw new Error('DERIVED_EX_DATE_INVALID');
  }
  return {cumDividendLastBuyDate:cumDate, effectiveDate:exDate, cumSettlementDate:settlementDateT2(cumDate, holidaySet)};
}

function validateInputs(parsed, market) {
  if (!isObject(parsed) || parsed.version !== INPUT_PARSE_VERSION || !Array.isArray(parsed.records)) throw new Error('INVALID_V9_7_3_REPORT');
  if (!isObject(market) || market.version !== INPUT_MARKET_VERSION || !Array.isArray(market.records)) throw new Error('INVALID_V9_7_5_REPORT');
  if (parsed.sampleHash !== market.sampleHash) throw new Error('INPUT_SAMPLE_HASH_MISMATCH');
  if ((market.summary?.errors ?? 0) !== 0) throw new Error('V9_7_5_HAS_ERRORS');
}

async function runRepair(parsed, market, options={}) {
  validateInputs(parsed, market);
  const fetcher = options.fetcher ?? fetch;
  const state = {
    version:VERSION,
    inputVersions:[parsed.version, market.version],
    sampleHash:parsed.sampleHash,
    inventoryRunId:parsed.inventoryRunId,
    sourceCoverageWindowId:parsed.sourceCoverageWindowId,
    scope:'SAMPLE_ONLY_NOT_COVERAGE',
    eventImportComplete:false,
    coveragePromoted:false,
    status:'RUNNING',
    records:[]
  };

  const holidayCache = new Map();
  async function ensureYears(recordDate) {
    const y = yearOf(recordDate);
    const years = [y-1,y,y+1];
    const all = new Set();
    const evidence = [];
    for (const yr of years) {
      if (!holidayCache.has(yr)) holidayCache.set(yr, await fetchKrxHolidays(yr,{fetcher}));
      const h = holidayCache.get(yr);
      for (const d of h.dates) all.add(d);
      evidence.push({year:yr,rowCount:h.rowCount,sha256:h.sha256,otpSha256:h.otpSha256});
    }
    return {holidays:all,evidence};
  }

  for (const prior of market.records) {
    if (prior.status === 'RESOLVED') {
      state.records.push({...prior,repairStatus:'NOT_NEEDED',eventInsertAllowed:false});
      continue;
    }
    if (prior.status !== 'UNRESOLVED' || prior.candidate?.candidateActionType !== 'CASH_DIVIDEND') {
      state.records.push({...prior,repairStatus:'UNRESOLVED',repairReason:'RULE_FALLBACK_NOT_ALLOWED_FOR_THIS_CASE',eventInsertAllowed:false});
      continue;
    }

    let repaired;
    try {
      const recordDate = prior.originalEvent?.recordDate ?? prior.event?.recordDate;
      if (!recordDate) throw new Error('DIVIDEND_RECORD_DATE_MISSING');
      const cal = await ensureYears(recordDate);
      const derivation = deriveExDividendDate(recordDate, cal.holidays);
      repaired = {
        repairStatus:'RESOLVED',
        repairReason:'EFFECTIVE_DATE_DERIVED_FROM_KRX_T2_AND_OFFICIAL_HOLIDAY_CALENDAR',
        effectiveDate:derivation.effectiveDate,
        event:{...(prior.event ?? prior.originalEvent),effectiveDate:derivation.effectiveDate,
          adjustmentSource:'KRX_RULE_DERIVED',
          adjustmentDerivation:'DART_RECORD_DATE_PLUS_KRX_T2_PLUS_KRX_HOLIDAY_CALENDAR'},
        evidence:{
          recordDate,
          cumDividendLastBuyDate:derivation.cumDividendLastBuyDate,
          cumSettlementDate:derivation.cumSettlementDate,
          effectiveDate:derivation.effectiveDate,
          settlementCycle:'T+2',
          exDividendRule:'KRX_EX_DIVIDEND_MECHANICS',
          holidayCalendarSource:'KRX_OPEN_MARKET_HOLIDAY_CALENDAR',
          holidayCalendar:cal.evidence
        },
        eventInsertAllowed:false
      };
    } catch (error) {
      repaired={repairStatus:'ERROR',repairReason:safeError(error),eventInsertAllowed:false};
    }
    state.records.push({...prior,...repaired});
    console.log(`${prior.candidate.candidateActionType} ${prior.candidate.receiptNo}: ${repaired.repairStatus} ${repaired.repairReason}${repaired.effectiveDate?' '+repaired.effectiveDate:''}`);
  }

  const direct = state.records.filter(r=>r.status==='RESOLVED').length;
  const ruleDerived = state.records.filter(r=>r.repairStatus==='RESOLVED').length;
  const unresolved = state.records.filter(r=>r.status!=='RESOLVED' && r.repairStatus!=='RESOLVED' && r.repairStatus!=='ERROR').length;
  const errors = state.records.filter(r=>r.repairStatus==='ERROR').length;
  const totalResolved = direct + ruleDerived;
  state.status = errors ? 'HAS_ERRORS' : (unresolved ? 'MARKET_ADJUSTMENT_REPAIR_INCOMPLETE' : 'MARKET_ADJUSTMENT_REPAIR_FINISHED');
  state.summary = {
    samples:parsed.records.length,
    targetDividendEvents:market.summary?.targetDividendEvents ?? state.records.length,
    directKindResolved:direct,
    krxRuleDerivedResolved:ruleDerived,
    marketAdjustmentDatesResolved:totalResolved,
    marketAdjustmentDatesUnresolved:unresolved,
    errors,
    primarySource:'KRX_KIND_MARKET_ACTION_DISCLOSURES',
    fallbackPolicy:'CASH_DIVIDEND_ONLY_DART_RECORD_DATE_PLUS_KRX_T2_PLUS_OFFICIAL_KRX_HOLIDAY_CALENDAR',
    eventRowsInserted:0,
    coveragePromoted:false
  };
  return state;
}

async function main() {
  if (typeof fetch !== 'function') throw new Error('NODE_18_OR_NEWER_REQUIRED');
  const root = path.resolve(__dirname,'..');
  const args = process.argv.slice(2);
  if (args.some(a=>!a.startsWith('--parsed=')&&!a.startsWith('--market=')&&!a.startsWith('--output='))) throw new Error('UNKNOWN_OPTION');
  const get=(prefix,def)=>{const a=args.find(x=>x.startsWith(prefix)); return a?path.resolve(a.slice(prefix.length)):def;};
  const parsedFile=get('--parsed=',path.join(root,'logs','corporate-action-parse-probe-v9-7-3.json'));
  const marketFile=get('--market=',path.join(root,'logs','corporate-action-dividend-market-adjustment-probe-v9-7-5.json'));
  const outputFile=get('--output=',path.join(root,'logs','corporate-action-dividend-market-adjustment-repair-v9-7-5-1.json'));
  const parsed=JSON.parse(fs.readFileSync(parsedFile,'utf8').replace(/^\uFEFF/,''));
  const market=JSON.parse(fs.readFileSync(marketFile,'utf8').replace(/^\uFEFF/,''));
  const state=await runRepair(parsed,market);
  save(outputFile,state);
  console.log(JSON.stringify({status:state.status,...state.summary},null,2));
  console.log('Upload only this report (no .env files): '+outputFile);
  if (state.status==='HAS_ERRORS') process.exitCode=1;
}

module.exports={normalizeHolidayDate,extractHolidayRows,isTradingDay,nextTradingDay,settlementDateT2,deriveExDividendDate,validateInputs,runRepair};
if (require.main===module) main().catch(error=>{console.error(safeError(error));process.exitCode=1;});
