'use strict';
// V9.7.5 read-only market-adjustment probe.
// Resolves the effective market adjustment date for dividend candidates that
// V9.7.3 intentionally left pending. Source: KRX KIND market-action disclosures.
// NEVER writes Supabase/events and NEVER promotes coverage.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_5_DIVIDEND_MARKET_ADJUSTMENT_PROBE';
const INPUT_PARSE_VERSION = 'V9_7_3_PARSE_PROBE';
const INPUT_CHAIN_VERSION = 'V9_7_4_1_CHAIN_REPAIR_PROBE';
const KIND_BASE = 'https://kind.krx.co.kr';
const MAX_RESPONSE = 4 * 1024 * 1024;
const DELAY_MS = 450;
const SEARCH_DAYS_BEFORE = 14;
const SEARCH_DAYS_AFTER = 3;
const TARGET_TYPES = new Set(['CASH_DIVIDEND', 'STOCK_DIVIDEND']);
const KNOWN_DOCNOS = ['99311', '99335', '71987', '70767'];

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);

function safeError(error) {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'KIND_REQUEST_FAILED';
}

function save(file, state) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const tmp=file+'.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state,null,2),'utf8');
  fs.renameSync(tmp,file);
}

function parseIsoDate(v) {
  if (typeof v!=='string') return null;
  const m=v.match(/\b(20\d{2})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})\s*(?:일)?/);
  if (!m) return null;
  const iso=`${m[1]}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[3])).padStart(2,'0')}`;
  const d=new Date(iso+'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===iso ? iso : null;
}

function shiftDays(iso, days) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(iso??'')) throw new Error('INVALID_ISO_DATE');
  const d=new Date(iso+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}

function dayDistance(a,b) {
  const aa=Date.parse(a+'T00:00:00Z'), bb=Date.parse(b+'T00:00:00Z');
  if (!Number.isFinite(aa)||!Number.isFinite(bb)) return Infinity;
  return Math.round((bb-aa)/86400000);
}

function decodeEntities(s) {
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(m,k)=>{
    if (k[0]==='#') {
      const n=k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):parseInt(k.slice(1),10);
      return Number.isFinite(n)&&n>=0&&n<=0x10FFFF?String.fromCodePoint(n):m;
    }
    return named[k.toLowerCase()]??m;
  });
}

function stripTags(html) {
  return decodeEntities(String(html??'')
    .replace(/<script\b[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/p\s*>/gi,'\n')
    .replace(/<\/tr\s*>/gi,'\n')
    .replace(/<\/t[dh]\s*>/gi,'\t')
    .replace(/<[^>]+>/g,' '))
    .replace(/\u00a0/g,' ')
    .replace(/[ \t]+/g,' ')
    .replace(/ *\n */g,'\n')
    .trim();
}

function attr(tag,name) {
  const m=String(tag??'').match(new RegExp(`${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,'i'));
  return m?decodeEntities(m[2]).trim():'';
}

function normalizeTitle(v) { return stripTags(v).replace(/\s+/g,'').replace(/[ㆍ·]/g,'ㆍ'); }
function normalizeCompany(v) { return stripTags(v).replace(/\s+/g,'').replace(/\(주\)|주식회사/g,''); }

function parseKindDetailRows(html) {
  const table=(String(html).match(/<table\b[^>]*class=["'][^"']*\blist\b[^"']*\btype-00\b[^"']*\bmt10\b[^"']*["'][^>]*>[\s\S]*?<\/table>/i)||[])[0]
    || (String(html).match(/<table\b[^>]*>[\s\S]*?<\/table>/i)||[])[0];
  if (!table) throw new Error('KIND_DETAIL_TABLE_NOT_FOUND');
  const body=(table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)||[])[1]||table;
  const rows=[];
  for (const trm of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tr=trm[0], cells=[...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
    if (cells.length<5) continue;
    const companyCell=cells[2], titleCell=cells[3];
    const corpCode=(companyCell.match(/companysummary_open\s*\(\s*['"]([A-Za-z0-9]+)['"]/i)||[])[1]||'';
    const marketImg=(companyCell.match(/<img\b[^>]*class=["'][^"']*\blegend\b[^"']*["'][^>]*>/i)||[])[0]||'';
    const market=attr(marketImg,'alt');
    const a=(titleCell.match(/<a\b[^>]*>[\s\S]*?<\/a>/i)||[])[0]||'';
    const title=attr(a,'title')||stripTags(titleCell);
    const acptno=(titleCell.match(/openDisclsViewer\s*\(\s*['"](\d{14})['"]/i)||[])[1]||'';
    const time=stripTags(cells[1]);
    const companyName=stripTags(companyCell);
    if (!acptno || !/배당락/.test(normalizeTitle(title))) continue;
    rows.push({time,market,corpCode,companyName,title,acptno});
  }
  return rows;
}

function kindSearchDefaults() {
  const p={
    method:'searchDetailsSub', forward:'details_sub', currentPageSize:'100', pageIndex:'1', orderMode:'1', orderStat:'D',
    searchCodeType:'', repIsuSrtCd:'', allRepIsuSrtCd:'', oldSearchCorpName:'', disclosureType:'', disTypevalue:'',
    reportNm:'배당락', reportCd:'', searchCorpName:'', business:'', marketType:'', kosdaqSegment:'', settlementMonth:'',
    securities:'1', submitOblgNm:'', enterprise:'', reportNmTemp:'', reportNmPop:'', bfrDsclsType:'on', fromDate:'2000-01-01',
    toDate:'', lastReport:''
  };
  for (const cat of ['01','02','03','04','05','06','07','08','09','10','11','13','14','20']) {
    p['disclosureType'+cat]=''; p['pDisclosureType'+cat]='';
  }
  return p;
}

async function fetchText(url, options={}, fetcher=fetch) {
  const response=await fetcher(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000),...options});
  if (!response.ok) {
    if (response.status===404) throw new Error('HTTP_404');
    throw new Error(`HTTP_${response.status}`);
  }
  const declared=Number(response.headers.get('content-length')||0);
  if (declared>MAX_RESPONSE) throw new Error('RESPONSE_TOO_LARGE');
  const bytes=Buffer.from(await response.arrayBuffer());
  if (bytes.length>MAX_RESPONSE) throw new Error('RESPONSE_TOO_LARGE');
  // KIND detail and external document pages used here are UTF-8. The viewer shell
  // may advertise EUC-KR, but content-id extraction below is ASCII-only and remains safe.
  return {text:bytes.toString('utf8'),sha256:sha256(bytes),byteLength:bytes.length};
}

async function searchKindDividendNotices(stockCode, recordDate, options={}) {
  if (!/^[0-9A-Z]{6}$/.test(stockCode??'')) throw new Error('INVALID_STOCK_CODE');
  const fetcher=options.fetcher??fetch;
  const params=kindSearchDefaults();
  params.searchCorpName=stockCode;
  params.fromDate=shiftDays(recordDate,-SEARCH_DAYS_BEFORE);
  params.toDate=shiftDays(recordDate,SEARCH_DAYS_AFTER);
  const body=new URLSearchParams(params).toString();
  const out=await fetchText(`${KIND_BASE}/disclosure/details.do`,{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8','user-agent':'Mozilla/5.0'},body
  },fetcher);
  return {rows:parseKindDetailRows(out.text),query:{searchCorpName:stockCode,reportNm:'배당락',fromDate:params.fromDate,toDate:params.toDate},sha256:out.sha256};
}

function contentIdsFromViewerShell(html) {
  const opts=[...String(html).matchAll(/option\s+value=['"](\d{14})\|([YN])/gi)].map(m=>({id:m[1],flag:m[2].toUpperCase()}));
  if (!opts.length) throw new Error('KIND_CONTENT_ID_NOT_FOUND');
  return [...opts.filter(x=>x.flag==='Y').map(x=>x.id),...opts.filter(x=>x.flag!=='Y').reverse().map(x=>x.id)];
}

async function getContentIds(acptno, options={}) {
  if (!/^\d{14}$/.test(acptno)) throw new Error('INVALID_KIND_ACPTNO');
  const fetcher=options.fetcher??fetch;
  const u=`${KIND_BASE}/common/disclsviewer.do?method=search&acptno=${encodeURIComponent(acptno)}&docno=&viewerhost=&viewerport=`;
  const out=await fetchText(u,{headers:{'user-agent':'Mozilla/5.0'}},fetcher);
  return {ids:contentIdsFromViewerShell(out.text),sha256:out.sha256};
}

function docnoPriority(row) {
  const title=normalizeTitle(row.title), market=String(row.market??'');
  const priority=[];
  if (/중간\(분기\)배당락/.test(title)) {
    if (/코스닥/.test(market)) priority.push('71987');
    if (/유가|코스피/.test(market)) priority.push('99335');
  } else if (/배당락/.test(title)) {
    if (/코스닥/.test(market)) priority.push('70767');
    if (/유가|코스피/.test(market)) priority.push('99311');
  }
  for (const d of KNOWN_DOCNOS) if (!priority.includes(d)) priority.push(d);
  return priority;
}

function externalUrl(acptno,contentId,docno) {
  const y=acptno.slice(0,4),m=acptno.slice(4,6),d=acptno.slice(6,8),seq=acptno.slice(8,14);
  return `${KIND_BASE}/external/${y}/${m}/${d}/${seq}/${contentId}/${docno}.htm`;
}

function parseMarketAdjustmentDocument(html, docno) {
  const text=stripTags(html);
  const title=(text.split(/\n+/).find(line=>/배당락/.test(line))||'').trim();
  let effectiveDate=null;
  for (const re of [
    /(?:적용일|배당락\s*실시일)\s*[:：]?\s*(20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?)/,
    /(?:적용일|배당락\s*실시일)[\s\S]{0,80}?(20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?)/
  ]) { const m=text.match(re); if(m){effectiveDate=parseIsoDate(m[1]); if(effectiveDate) break;} }
  const companyName=((text.match(/(?:회사명)\s*[:：]?\s*([^\n\t]+)/)||[])[1]||'').trim();
  const shortCode=((text.match(/(?:단축코드)\s*[:：]?\s*A?([0-9A-Z]{6})/)||[])[1]||'').trim();
  const shareClass=((text.match(/(?:주권종류(?:와\s*가격)?)\s*(?:주권종류)?\s*[:：]?\s*(보통주식|\d*우선주\w*|우선주\w*)/)||[])[1]||'').trim();
  let reason='';
  const rm=text.match(/(?:사유)\s*[:：]?\s*([^\n\t]+)/);
  if (rm) reason=rm[1].trim();
  if (!reason && /주식배당/.test(text)) reason='주식배당';
  const basisPrice=((text.match(/(?:기준가격\(원\)|기준가\(원\)|배당락\s*기준가격)\s*[:：]?\s*([0-9,]+)/)||[])[1]||'').replace(/,/g,'')||null;
  return {docno,title,effectiveDate,companyName,shortCode,shareClass,reason,basisPrice,textHash:sha256(Buffer.from(text,'utf8'))};
}

async function fetchNoticeDocument(row, options={}) {
  const fetcher=options.fetcher??fetch;
  const shell=await getContentIds(row.acptno,{fetcher});
  const attempts=[];
  for (const cid of shell.ids.slice(0,4)) {
    for (const docno of docnoPriority(row)) {
      const url=externalUrl(row.acptno,cid,docno);
      try {
        const out=await fetchText(url,{headers:{'user-agent':'Mozilla/5.0'}},fetcher);
        const parsed=parseMarketAdjustmentDocument(out.text,docno);
        attempts.push({contentId:cid,docno,status:'OK',url,sha256:out.sha256});
        if (parsed.effectiveDate && /배당락/.test(parsed.title||stripTags(out.text))) {
          return {status:'FOUND',parsed,url,contentId:cid,sha256:out.sha256,shellSha256:shell.sha256,attempts};
        }
      } catch(error) {
        const reason=safeError(error);
        attempts.push({contentId:cid,docno,status:reason});
        if (reason!=='HTTP_404') throw error;
      }
    }
  }
  return {status:'NOT_FOUND',attempts,shellSha256:shell.sha256};
}

function validateAdjustment(candidate, row, document) {
  const event=candidate.event||{};
  const recordDate=event.recordDate;
  const p=document.parsed;
  if (!p?.effectiveDate || !recordDate) return {status:'UNRESOLVED',reason:'KIND_EFFECTIVE_DATE_MISSING'};
  const days=dayDistance(p.effectiveDate,recordDate);
  if (!(days>=1 && days<=10)) return {status:'UNRESOLVED',reason:'KIND_EFFECTIVE_DATE_OUTSIDE_RECORD_WINDOW'};
  if (p.shortCode && p.shortCode!==candidate.candidate.stockCode) return {status:'UNRESOLVED',reason:'KIND_STOCK_CODE_MISMATCH'};
  const rowTitle=normalizeTitle(row.title);
  if (!/배당락/.test(rowTitle)) return {status:'UNRESOLVED',reason:'KIND_NOTICE_TITLE_MISMATCH'};

  if (candidate.candidate.candidateActionType==='STOCK_DIVIDEND') {
    if (!/주식배당/.test(p.reason||'')) {
      return {status:'UNRESOLVED',reason:'KIND_STOCK_DIVIDEND_REASON_NOT_PROVEN'};
    }
    if (p.shareClass && !/보통주/.test(p.shareClass)) return {status:'UNRESOLVED',reason:'KIND_NON_COMMON_SHARE_NOTICE'};
  } else {
    // The KOSDAQ market notice may only say "중간(분기)배당락 안내" and omit
    // "현금" in the body. Require the dedicated interim/quarterly ex-dividend
    // notice when the body does not separately prove cash.
    const titleProof=/중간\(분기\)배당락/.test(rowTitle);
    const bodyProof=/중간\(분기\)배당락/.test(normalizeTitle(p.title)) || /현금배당/.test(p.reason||'');
    if (!titleProof && !bodyProof) return {status:'UNRESOLVED',reason:'KIND_CASH_DIVIDEND_NOTICE_NOT_PROVEN'};
    if (p.shareClass && !/보통주/.test(p.shareClass)) return {status:'UNRESOLVED',reason:'KIND_NON_COMMON_SHARE_NOTICE'};
  }

  return {status:'RESOLVED',reason:'EFFECTIVE_DATE_CONFIRMED_BY_KRX_KIND',effectiveDate:p.effectiveDate,
    marketNoticeReceiptNo:row.acptno,marketNoticeTitle:row.title,market:row.market||null,docno:p.docno,
    basisPrice:p.basisPrice,kindReason:p.reason||null,kindCompanyName:p.companyName||row.companyName||null,
    sourceUrl:document.url};
}

function chooseResolved(results) {
  const resolved=results.filter(r=>r.validation?.status==='RESOLVED');
  if (!resolved.length) return null;
  resolved.sort((a,b)=>{
    const da=dayDistance(a.validation.effectiveDate,a.candidate.event.recordDate);
    const db=dayDistance(b.validation.effectiveDate,b.candidate.event.recordDate);
    return da-db || b.row.acptno.localeCompare(a.row.acptno);
  });
  const best=resolved[0];
  const equallyBest=resolved.filter(r=>dayDistance(r.validation.effectiveDate,r.candidate.event.recordDate)===dayDistance(best.validation.effectiveDate,best.candidate.event.recordDate));
  const dates=new Set(equallyBest.map(r=>r.validation.effectiveDate));
  if (dates.size>1) return {ambiguous:true,candidates:equallyBest};
  return best;
}

function validateInputs(parsed, chain) {
  if (!isObject(parsed)||parsed.version!==INPUT_PARSE_VERSION||!Array.isArray(parsed.records)) throw new Error('INVALID_V9_7_3_REPORT');
  if (!isObject(chain)||chain.version!==INPUT_CHAIN_VERSION||!Array.isArray(chain.records)) throw new Error('INVALID_V9_7_4_1_REPORT');
  if (parsed.sampleHash!==chain.sampleHash) throw new Error('INPUT_SAMPLE_HASH_MISMATCH');
  const s=chain.summary||{};
  if (s.correctionChainsUnresolved!==0 || s.withdrawalLinksUnresolved!==0 || s.errors!==0) throw new Error('CHAIN_PROBE_NOT_CLOSED');
}

async function runProbe(parsed, chain, options={}) {
  validateInputs(parsed,chain);
  const fetcher=options.fetcher??fetch, delay=options.delay??DELAY_MS;
  const targets=parsed.records.filter(r=>r.parseStatus==='PARSED_NEEDS_EFFECTIVE_DATE' && TARGET_TYPES.has(r.candidate?.candidateActionType));
  const state={version:VERSION,inputVersions:[parsed.version,chain.version],sampleHash:parsed.sampleHash,inventoryRunId:parsed.inventoryRunId,
    sourceCoverageWindowId:parsed.sourceCoverageWindowId,scope:'SAMPLE_ONLY_NOT_COVERAGE',eventImportComplete:false,coveragePromoted:false,status:'RUNNING',records:[]};

  for (const candidate of targets) {
    let out;
    try {
      const recordDate=candidate.event?.recordDate;
      if (!recordDate) throw new Error('DIVIDEND_RECORD_DATE_MISSING');
      const search=await searchKindDividendNotices(candidate.candidate.stockCode,recordDate,{fetcher});
      const candidates=[];
      for (const row of search.rows) {
        if (!/배당락/.test(normalizeTitle(row.title))) continue;
        let document;
        try { document=await fetchNoticeDocument(row,{fetcher}); }
        catch(error) { candidates.push({row,documentStatus:'ERROR',error:safeError(error)}); continue; }
        if (document.status!=='FOUND') { candidates.push({row,documentStatus:'NOT_FOUND',attempts:document.attempts}); continue; }
        const validation=validateAdjustment(candidate,row,document);
        candidates.push({candidate,row,documentStatus:'FOUND',document:{parsed:document.parsed,url:document.url,sha256:document.sha256,contentId:document.contentId},validation});
        if (delay) await wait(delay);
      }
      const chosen=chooseResolved(candidates);
      if (!chosen) {
        out={status:'UNRESOLVED',reason:search.rows.length?'NO_VALID_KIND_MARKET_ADJUSTMENT':'KIND_MARKET_ADJUSTMENT_NOT_FOUND',search,candidates};
      } else if (chosen.ambiguous) {
        out={status:'UNRESOLVED',reason:'KIND_MARKET_ADJUSTMENT_AMBIGUOUS',search,candidates};
      } else {
        out={status:'RESOLVED',reason:chosen.validation.reason,effectiveDate:chosen.validation.effectiveDate,
          event:{...candidate.event,effectiveDate:chosen.validation.effectiveDate,adjustmentSource:'KRX_KIND',marketNoticeReceiptNo:chosen.validation.marketNoticeReceiptNo,
            marketNoticeTitle:chosen.validation.marketNoticeTitle,market:chosen.validation.market,docno:chosen.validation.docno,basisPrice:chosen.validation.basisPrice},
          evidence:{...chosen.validation,sha256:chosen.document.sha256,contentId:chosen.document.contentId},search,candidates};
      }
    } catch(error) {
      out={status:'ERROR',reason:safeError(error)};
    }
    state.records.push({candidate:candidate.candidate,parseStatus:candidate.parseStatus,priorReason:candidate.reason,originalEvent:candidate.event,...out,eventInsertAllowed:false});
    console.log(`${candidate.candidate.candidateActionType} ${candidate.candidate.receiptNo}: ${out.status} ${out.reason}${out.effectiveDate?' '+out.effectiveDate:''}`);
    if (delay) await wait(delay);
  }

  const resolved=state.records.filter(r=>r.status==='RESOLVED').length;
  const unresolved=state.records.filter(r=>r.status==='UNRESOLVED').length;
  const errors=state.records.filter(r=>r.status==='ERROR').length;
  state.status=errors?'HAS_ERRORS':'MARKET_ADJUSTMENT_PROBE_FINISHED';
  state.summary={samples:parsed.records.length,targetDividendEvents:targets.length,marketAdjustmentDatesResolved:resolved,
    marketAdjustmentDatesUnresolved:unresolved,errors,source:'KRX_KIND_MARKET_ACTION_DISCLOSURES',
    effectiveDatePolicy:'EXPLICIT_KRX_KIND_APPLY_DATE_OR_EX_DIVIDEND_DATE_ONLY',eventRowsInserted:0,coveragePromoted:false};
  return state;
}

async function main() {
  if (typeof fetch!=='function') throw new Error('NODE_18_OR_NEWER_REQUIRED');
  const root=path.resolve(__dirname,'..');
  const args=process.argv.slice(2);
  if (args.some(a=>!a.startsWith('--parsed=')&&!a.startsWith('--chain=')&&!a.startsWith('--output='))) throw new Error('UNKNOWN_OPTION');
  const get=(prefix,def)=>{const a=args.find(x=>x.startsWith(prefix)); return a?path.resolve(a.slice(prefix.length)):def;};
  const parsedFile=get('--parsed=',path.join(root,'logs','corporate-action-parse-probe-v9-7-3.json'));
  const chainFile=get('--chain=',path.join(root,'logs','corporate-action-chain-repair-probe-v9-7-4-1.json'));
  const outputFile=get('--output=',path.join(root,'logs','corporate-action-dividend-market-adjustment-probe-v9-7-5.json'));
  const parsed=JSON.parse(fs.readFileSync(parsedFile,'utf8').replace(/^\uFEFF/,''));
  const chain=JSON.parse(fs.readFileSync(chainFile,'utf8').replace(/^\uFEFF/,''));
  const state=await runProbe(parsed,chain);
  save(outputFile,state);
  console.log(JSON.stringify({status:state.status,...state.summary},null,2));
  console.log('Upload only this report (no .env files): '+outputFile);
  if (state.status==='HAS_ERRORS') process.exitCode=1;
}

module.exports={parseIsoDate,shiftDays,decodeEntities,stripTags,parseKindDetailRows,kindSearchDefaults,contentIdsFromViewerShell,
  docnoPriority,externalUrl,parseMarketAdjustmentDocument,validateAdjustment,chooseResolved,validateInputs,runProbe};
if (require.main===module) main().catch(error=>{console.error(safeError(error));process.exitCode=1;});
