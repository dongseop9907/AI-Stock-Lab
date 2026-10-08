'use strict';
// V9.7.4.1 read-only correction/withdrawal chain repair probe.
// Reads V9.7.2 + V9.7.3 reports, resolves original filings through DART list.json,
// and NEVER writes Supabase/events or promotes coverage.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_4_1_CHAIN_REPAIR_PROBE';
const INPUT_PARSE_VERSION = 'V9_7_3_PARSE_PROBE';
const INPUT_DETAIL_VERSION = 'V9_7_2_DETAIL_PROBE';
const MAX_RESPONSE = 4 * 1024 * 1024;
const MAX_PAGES = 20;
const PAGE_COUNT = 100;
const DELAY_MS = 500;
const CORRECTION_FLAGS = new Set(['CORRECTION_CHAIN_REQUIRED']);
const WITHDRAWAL_FLAG = 'WITHDRAWAL_MUST_LINK_ORIGINAL';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);

function safeError(error) {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'REQUEST_FAILED';
}

function save(file, state) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readKey(root, env=process.env) {
  const parsed = {};
  const file = path.join(root, '.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let value = m[2];
      if (/^['"]/.test(value)) {
        const quote=value[0], end=value.indexOf(quote,1);
        if (end<0 || !/^\s*(?:#.*)?$/.test(value.slice(end+1))) continue;
        value=value.slice(1,end);
      } else value=value.replace(/\s*#.*$/, '').trim();
      parsed[m[1]]=value;
    }
  }
  for (const name of ['OPENDART_API_KEY','OPEN_DART_API_KEY','DART_API_KEY','DART_KEY','OPEN_DART_KEY']) {
    const key=String(env[name] ?? parsed[name] ?? '').trim();
    if (key) return key;
  }
  throw new Error('DART_API_KEY_NOT_FOUND');
}

function stripCorrectionPrefix(name) {
  return String(name ?? '')
    .replace(/^\s*\[(?:기재정정|첨부정정|첨부추가|변경등록|발행조건확정|정정명령부과|정정제출요구)\]\s*/g, '')
    .trim();
}

function normalizeTitle(name) {
  return stripCorrectionPrefix(name)
    .replace(/\s+/g, '')
    .replace(/[ㆍ·]/g, 'ㆍ')
    .replace(/[（]/g, '(').replace(/[）]/g, ')');
}

function normalizeDate8(v) {
  if (typeof v !== 'string') return null;
  const m=v.match(/\b(20\d{2})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})\s*(?:일)?/);
  if (!m) return null;
  const y=Number(m[1]), mo=Number(m[2]), d=Number(m[3]);
  const iso=`${String(y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const dt=new Date(iso+'T00:00:00Z');
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0,10)===iso ? iso.replaceAll('-','') : null;
}

function minusDays(date8, days) {
  if (!/^\d{8}$/.test(date8)) throw new Error('INVALID_DATE8');
  const iso=`${date8.slice(0,4)}-${date8.slice(4,6)}-${date8.slice(6,8)}`;
  const d=new Date(iso+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()-days);
  return d.toISOString().slice(0,10).replaceAll('-','');
}

function plusDays(date8, days) {
  if (!/^\d{8}$/.test(date8)) throw new Error('INVALID_DATE8');
  const iso=`${date8.slice(0,4)}-${date8.slice(4,6)}-${date8.slice(6,8)}`;
  const d=new Date(iso+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10).replaceAll('-','');
}

function getNodes(detailRecord, parser) {
  if (detailRecord?.document?.status !== 'DOCUMENT_ZIP_RECEIVED') return null;
  const extracted=parser.extractXml(detailRecord.document);
  return parser.xmlTextNodes(extracted.text);
}

function firstDateAfterLabel(nodes, patterns, maxLookahead=8) {
  if (!Array.isArray(nodes)) return null;
  for (let i=0;i<nodes.length;i++) {
    if (!patterns.some(re => re.test(nodes[i]))) continue;
    for (let j=i+1;j<nodes.length && j<=i+maxLookahead;j++) {
      const d=normalizeDate8(nodes[j]);
      if (d) return d;
    }
  }
  return null;
}

function correctionOriginalDate(nodes) {
  return firstDateAfterLabel(nodes, [
    /정정대상\s*공시서류의\s*최초제출일/,
    /정정관련\s*공시서류제출일/,
    /정정대상\s*공시서류제출일/
  ], 8);
}

function correctionReferencedTitle(nodes) {
  if (!Array.isArray(nodes)) return null;
  for (let i=0;i<nodes.length;i++) {
    if (!/정정대상\s*공시서류\s*:|정정관련\s*공시서류$/.test(nodes[i])) continue;
    for (let j=i+1;j<nodes.length && j<=i+5;j++) {
      const v=String(nodes[j] ?? '').trim();
      if (v && !normalizeDate8(v) && !/^\d+\./.test(v)) return v;
    }
  }
  return null;
}

function withdrawalReference(nodes) {
  if (!Array.isArray(nodes)) return null;

  const parseReference = value => {
    const s=String(value ?? '').trim();
    const date=normalizeDate8(s);
    if (!date) return null;
    // Require an actual corporate-action filing title. This deliberately rejects
    // the current document header such as "기타 주요경영사항(회사분할결정 철회)".
    const patterns=[
      /주요사항보고서\s*\(\s*회사분할\s*결정\s*\)/,
      /주요사항보고서\s*\(\s*회사합병\s*결정\s*\)/,
      /주식분할\s*결정/,
      /주식병합\s*결정/,
      /유상증자\s*결정/,
      /주식배당\s*결정/,
      /현금\s*[ㆍ·]\s*현물배당\s*결정/
    ];
    const matched=patterns.find(re=>re.test(s));
    if (!matched) return null;
    const raw=(s.match(matched)||[])[0];
    return {date,title:raw.replace(/\s+/g,'')};
  };

  // Prefer explicit references placed under "기타 투자판단에 참고할 사항".
  for (let i=0;i<nodes.length;i++) {
    if (!/기타\s*투자판단.*참고/.test(String(nodes[i] ?? ''))) continue;
    for (let j=i+1;j<nodes.length && j<=i+12;j++) {
      const ref=parseReference(nodes[j]);
      if (ref) return ref;
    }
  }

  // Conservative fallback for other DART layouts.
  for (const node of nodes) {
    const ref=parseReference(node);
    if (ref) return ref;
  }
  return null;
}

async function requestJson(params, key, fetcher=fetch) {
  const url=new URL('https://opendart.fss.or.kr/api/list.json');
  url.search=new URLSearchParams({...params,crtfc_key:key}).toString();
  const response=await fetcher(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  if (Number(response.headers.get('content-length'))>MAX_RESPONSE) throw new Error('RESPONSE_TOO_LARGE');
  const text=await response.text();
  if (Buffer.byteLength(text,'utf8')>MAX_RESPONSE) throw new Error('RESPONSE_TOO_LARGE');
  let body;
  try { body=JSON.parse(text.replace(/^\uFEFF/,'')); } catch { throw new Error('INVALID_DART_JSON'); }
  if (!isObject(body) || !/^\d{3}$/.test(body.status ?? '')) throw new Error('INVALID_DART_JSON');
  if (body.status==='013') return {status:'013',rows:[],page_no:1,total_page:0,total_count:0};
  if (body.status!=='000') throw new Error('DART_STATUS_'+body.status);
  if (!Array.isArray(body.list)) throw new Error('INVALID_DART_LIST');
  const rows=body.list.map(r=>({
    corp_code:String(r.corp_code??''), stock_code:String(r.stock_code??''), report_nm:String(r.report_nm??''),
    rcept_no:String(r.rcept_no??''), rcept_dt:String(r.rcept_dt??''), rm:String(r.rm??'')
  }));
  if (rows.some(r=>r.corp_code!==params.corp_code || !/^\d{14}$/.test(r.rcept_no) || !/^\d{8}$/.test(r.rcept_dt))) throw new Error('DART_LIST_IDENTITY_MISMATCH');
  return {status:'000',rows,page_no:Number(body.page_no||1),total_page:Number(body.total_page||1),total_count:Number(body.total_count||rows.length),sha256:sha256(Buffer.from(text))};
}

async function fetchDisclosureHistory(corpCode, bgnDe, endDe, key, options={}) {
  if (!/^\d{8}$/.test(corpCode) || !/^\d{8}$/.test(bgnDe) || !/^\d{8}$/.test(endDe)) throw new Error('INVALID_HISTORY_QUERY');
  const fetcher=options.fetcher??fetch, delay=options.delay??DELAY_MS;
  const all=[]; let totalPage=1;
  for (let page=1;page<=totalPage;page++) {
    if (page>MAX_PAGES) throw new Error('HISTORY_PAGE_LIMIT');
    const out=await requestJson({corp_code:corpCode,bgn_de:bgnDe,end_de:endDe,last_reprt_at:'N',sort:'date',sort_mth:'asc',page_no:String(page),page_count:String(PAGE_COUNT)},key,fetcher);
    if (out.status==='013') return [];
    totalPage=Math.max(1,out.total_page);
    all.push(...out.rows);
    if (delay && page<totalPage) await wait(delay);
  }
  return all;
}

function baseTitleForRecord(record, nodes=null) {
  const current=normalizeTitle(record.candidate.reportName);
  const referenced=correctionReferencedTitle(nodes);
  if (referenced) {
    const normalized=normalizeTitle(referenced);
    // Some DART correction headers say only "주요사항보고서" even though the
    // actual chain title is "주요사항보고서(회사합병결정)". Do not broaden
    // the match and accidentally join unrelated major-event reports.
    if (/회사합병결정|회사분할결정|주식분할결정|주식병합결정|유상증자결정|주식배당결정|현금ㆍ현물배당결정/.test(normalized)) return normalized;
  }
  return current;
}

function titleEquivalent(rowTitle, baseTitle) {
  const a=normalizeTitle(rowTitle), b=normalizeTitle(baseTitle);
  if (a===b) return true;
  // Conservative fallback only for the well-known 주요사항보고서 wrapper.
  const squash=s=>s.replace(/^주요사항보고서/, '');
  return squash(a)===squash(b);
}

function receiptDateMatches(row, referenceDate) {
  if (!/^\d{8}$/.test(referenceDate ?? '')) return false;
  const receiptPrefix=/^\d{14}$/.test(row?.rcept_no ?? '') ? row.rcept_no.slice(0,8) : '';
  // DART's displayed rcept_dt can differ by one calendar day from the date encoded
  // in rcept_no / the filing's own '최초제출일' (e.g. 07:00 public release).
  return row?.rcept_dt===referenceDate || receiptPrefix===referenceDate;
}

function canonicalActionTitle(value) {
  const s=normalizeTitle(value);
  for (const title of [
    '주요사항보고서(회사합병결정)',
    '주요사항보고서(회사분할결정)',
    '주식분할결정','주식병합결정','유상증자결정','주식배당결정','현금ㆍ현물배당결정'
  ]) {
    if (s.includes(normalizeTitle(title))) return normalizeTitle(title);
  }
  return s;
}

function actionTitleEquivalent(aValue,bValue) {
  const a=canonicalActionTitle(aValue), b=canonicalActionTitle(bValue);
  return a===b || titleEquivalent(a,b);
}

function resolveChainFromRows(record, rows, originalDate, baseTitle) {
  const current=rows.find(r=>r.rcept_no===record.candidate.receiptNo);
  const matching=rows.filter(r=>actionTitleEquivalent(r.report_nm,baseTitle));
  const originals=matching.filter(r=>receiptDateMatches(r,originalDate) && !/^\s*\[/.test(r.report_nm));
  const fallbackOriginals=matching.filter(r=>receiptDateMatches(r,originalDate));
  const candidates=originals.length?originals:fallbackOriginals;
  if (!current) return {status:'UNRESOLVED',reason:'CURRENT_RECEIPT_NOT_IN_LIST',chainRows:matching};
  if (candidates.length!==1) return {status:'UNRESOLVED',reason:candidates.length?'ORIGINAL_RECEIPT_AMBIGUOUS':'ORIGINAL_RECEIPT_NOT_FOUND',chainRows:matching};
  const original=candidates[0];
  return {status:'RESOLVED',reason:'ORIGINAL_RECEIPT_CONFIRMED_BY_DART_LIST',originalReceiptNo:original.rcept_no,originalReceiptDate:original.rcept_dt,
    currentReceiptNo:current.rcept_no,chainRows:matching};
}

function resolveWithdrawalFromRows(record, rows, ref) {
  const matches=rows.filter(r=>receiptDateMatches(r,ref.date) && actionTitleEquivalent(r.report_nm,ref.title));
  if (matches.length!==1) return {status:'UNRESOLVED',reason:matches.length?'WITHDRAWAL_TARGET_AMBIGUOUS':'WITHDRAWAL_TARGET_NOT_FOUND',chainRows:matches};
  return {status:'RESOLVED',reason:'WITHDRAWAL_TARGET_CONFIRMED_BY_DART_LIST',originalReceiptNo:matches[0].rcept_no,originalReceiptDate:matches[0].rcept_dt,
    currentReceiptNo:record.candidate.receiptNo,chainRows:matches};
}

function validateInputs(detail, parsed) {
  if (!isObject(detail) || detail.version!==INPUT_DETAIL_VERSION || !Array.isArray(detail.records)) throw new Error('INVALID_V9_7_2_REPORT');
  if (!isObject(parsed) || parsed.version!==INPUT_PARSE_VERSION || !Array.isArray(parsed.records)) throw new Error('INVALID_V9_7_3_REPORT');
  if (detail.sampleHash!==parsed.sampleHash) throw new Error('INPUT_SAMPLE_HASH_MISMATCH');
}

async function runProbe(detail, parsed, key, options={}) {
  validateInputs(detail,parsed);
  const parser=options.parser ?? require(path.join(__dirname,'parse-corporate-action-details-v9-7-3.cjs'));
  const fetcher=options.fetcher??fetch, delay=options.delay??DELAY_MS;
  const parsedByKey=new Map(parsed.records.map(r=>[`${r.candidate.receiptNo}|${r.candidate.candidateActionType}`,r]));
  const state={version:VERSION,inputVersions:[detail.version,parsed.version],sampleHash:detail.sampleHash,inventoryRunId:detail.inventoryRunId,
    sourceCoverageWindowId:detail.sourceCoverageWindowId,scope:'SAMPLE_ONLY_NOT_COVERAGE',eventImportComplete:false,coveragePromoted:false,status:'RUNNING',records:[]};

  for (const record of detail.records) {
    const flags=new Set(record.reviewFlags||[]);
    const isCorrection=[...CORRECTION_FLAGS].some(f=>flags.has(f));
    const isWithdrawal=flags.has(WITHDRAWAL_FLAG);
    if (!isCorrection && !isWithdrawal) continue;
    const parsedRecord=parsedByKey.get(`${record.candidate.receiptNo}|${record.candidate.candidateActionType}`) ?? null;
    let nodes=null;
    try { nodes=getNodes(record,parser); } catch {}
    let result;
    try {
      if (isWithdrawal) {
        const ref=withdrawalReference(nodes);
        if (!ref?.date || !ref?.title) {
          result={status:'UNRESOLVED',reason:'WITHDRAWAL_REFERENCE_NOT_PARSED'};
        } else {
          const rows=await fetchDisclosureHistory(record.candidate.corpCode,minusDays(ref.date,1),plusDays(ref.date,1),key,{fetcher,delay});
          result={...resolveWithdrawalFromRows(record,rows,ref),referenceDate:ref.date,referenceTitle:ref.title};
        }
      } else {
        let originalDate=correctionOriginalDate(nodes);
        let dateSource='document.xml';
        if (!originalDate) {
          // Source-unavailable corrections get a bounded one-year list probe. We only
          // accept the chain if an uncorrected base-title filing is uniquely identified.
          originalDate=minusDays(record.candidate.receiptDate,366);
          dateSource='bounded_fallback_window';
        }
        const baseTitle=baseTitleForRecord(record,nodes);
        const rows=await fetchDisclosureHistory(record.candidate.corpCode,originalDate,record.candidate.receiptDate,key,{fetcher,delay});
        if (dateSource==='bounded_fallback_window') {
          const matching=rows.filter(r=>actionTitleEquivalent(r.report_nm,baseTitle));
          const current=matching.find(r=>r.rcept_no===record.candidate.receiptNo);
          const originals=matching.filter(r=>!/^\s*\[/.test(r.report_nm)).sort((a,b)=>a.rcept_dt.localeCompare(b.rcept_dt)||a.rcept_no.localeCompare(b.rcept_no));
          if (!current) result={status:'UNRESOLVED',reason:'CURRENT_RECEIPT_NOT_IN_LIST',chainRows:matching};
          else if (originals.length!==1) result={status:'UNRESOLVED',reason:originals.length?'BOUNDED_ORIGINAL_AMBIGUOUS':'BOUNDED_ORIGINAL_NOT_FOUND',chainRows:matching};
          else result={status:'RESOLVED',reason:'ORIGINAL_RECEIPT_CONFIRMED_BY_BOUNDED_DART_LIST',originalReceiptNo:originals[0].rcept_no,
            originalReceiptDate:originals[0].rcept_dt,currentReceiptNo:current.rcept_no,chainRows:matching};
        } else result=resolveChainFromRows(record,rows,originalDate,baseTitle);
        result={...result,referenceDate:dateSource==='document.xml'?originalDate:null,referenceTitle:baseTitle,dateSource};
      }
    } catch(error) {
      result={status:'ERROR',reason:safeError(error)};
    }
    const chainRows=(result.chainRows||[]).map(r=>({rcept_no:r.rcept_no,rcept_dt:r.rcept_dt,report_nm:r.report_nm,rm:r.rm}));
    state.records.push({candidate:record.candidate,reviewFlags:record.reviewFlags||[],parseStatus:parsedRecord?.parseStatus??null,
      chainType:isWithdrawal?'WITHDRAWAL':'CORRECTION',...result,chainRows,eventInsertAllowed:false});
    console.log(`${record.candidate.candidateActionType} ${record.candidate.receiptNo}: ${isWithdrawal?'WITHDRAWAL':'CORRECTION'} ${result.status} ${result.reason}`);
    if (delay) await wait(delay);
  }

  const corrections=state.records.filter(r=>r.chainType==='CORRECTION');
  const withdrawals=state.records.filter(r=>r.chainType==='WITHDRAWAL');
  const errors=state.records.filter(r=>r.status==='ERROR').length;
  state.status=errors?'HAS_ERRORS':'CHAIN_PROBE_FINISHED';
  state.summary={
    samples:detail.records.length,
    correctionDocuments:detail.records.filter(r=>(r.reviewFlags||[]).includes('CORRECTION_CHAIN_REQUIRED')).length,
    correctionChainsResolved:corrections.filter(r=>r.status==='RESOLVED').length,
    correctionChainsUnresolved:corrections.filter(r=>r.status==='UNRESOLVED').length,
    withdrawalDocuments:detail.records.filter(r=>(r.reviewFlags||[]).includes(WITHDRAWAL_FLAG)).length,
    withdrawalLinksResolved:withdrawals.filter(r=>r.status==='RESOLVED').length,
    withdrawalLinksUnresolved:withdrawals.filter(r=>r.status==='UNRESOLVED').length,
    errors,
    parsedNeedsEffectiveDate:parsed.records.filter(r=>r.parseStatus==='PARSED_NEEDS_EFFECTIVE_DATE').length,
    chainDatePolicy:'MATCH_DECLARED_DATE_BY_RCEPT_DT_OR_RCEPT_NO_PREFIX',
    effectiveDatePolicy:'NOT_RESOLVED_IN_V9_7_4_1_REQUIRES_MARKET_ADJUSTMENT_SOURCE',
    eventRowsInserted:0,
    coveragePromoted:false
  };
  return state;
}

async function main() {
  if (typeof fetch!=='function') throw new Error('NODE_18_OR_NEWER_REQUIRED');
  const root=path.resolve(__dirname,'..');
  const args=process.argv.slice(2);
  if (args.some(a=>!a.startsWith('--detail=')&&!a.startsWith('--parsed=')&&!a.startsWith('--output='))) throw new Error('UNKNOWN_OPTION');
  const get=(prefix,def)=>{const a=args.find(x=>x.startsWith(prefix)); return a?path.resolve(a.slice(prefix.length)):def;};
  const detailFile=get('--detail=',path.join(root,'logs','corporate-action-detail-probe-v9-7-2.json'));
  const parsedFile=get('--parsed=',path.join(root,'logs','corporate-action-parse-probe-v9-7-3.json'));
  const outputFile=get('--output=',path.join(root,'logs','corporate-action-chain-repair-probe-v9-7-4-1.json'));
  const detail=JSON.parse(fs.readFileSync(detailFile,'utf8').replace(/^\uFEFF/,''));
  const parsed=JSON.parse(fs.readFileSync(parsedFile,'utf8').replace(/^\uFEFF/,''));
  const state=await runProbe(detail,parsed,readKey(root));
  save(outputFile,state);
  console.log(JSON.stringify({status:state.status,...state.summary},null,2));
  console.log('Upload only this report (no .env files): '+outputFile);
  if (state.status==='HAS_ERRORS') process.exitCode=1;
}

module.exports={safeError,readKey,stripCorrectionPrefix,normalizeTitle,normalizeDate8,minusDays,plusDays,correctionOriginalDate,correctionReferencedTitle,
  withdrawalReference,requestJson,fetchDisclosureHistory,baseTitleForRecord,titleEquivalent,receiptDateMatches,canonicalActionTitle,actionTitleEquivalent,resolveChainFromRows,resolveWithdrawalFromRows,runProbe};
if (require.main===module) main().catch(error=>{console.error(safeError(error));process.exitCode=1;});
