'use strict';
// V9.7.6 read-only canonical sample finalization probe.
// Combines V9.7.2 detail, V9.7.3 parsing, V9.7.4.1 chain resolution,
// and V9.7.5.1 dividend market-adjustment resolution.
// It also repairs a source-unavailable ATTACHMENT correction by resolving the
// original receipt and requiring an exact DART structured row for that original.
// NEVER writes Supabase/events and NEVER promotes coverage.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_6_CANONICAL_SAMPLE_FINALIZATION_PROBE';
const DETAIL_VERSION = 'V9_7_2_DETAIL_PROBE';
const PARSE_VERSION = 'V9_7_3_PARSE_PROBE';
const CHAIN_VERSION = 'V9_7_4_1_CHAIN_REPAIR_PROBE';
const DIVIDEND_REPAIR_VERSION = 'V9_7_5_1_DIVIDEND_MARKET_ADJUSTMENT_REPAIR_PROBE';
const MAX_ORIGINAL_DOCUMENT = 8 * 1024 * 1024;

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'FINALIZATION_FAILED';
}

function save(file,state) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(state,null,2),'utf8');
  fs.renameSync(tmp,file);
}

function readKey(root, env=process.env) {
  const parsed={};
  const file=path.join(root,'.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)) {
      const m=line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let value=m[2];
      if (/^['"]/.test(value)) {
        const q=value[0], end=value.indexOf(q,1);
        if (end<0 || !/^\s*(?:#.*)?$/.test(value.slice(end+1))) continue;
        value=value.slice(1,end);
      } else value=value.replace(/\s*#.*$/,'').trim();
      parsed[m[1]]=value;
    }
  }
  for (const n of ['OPENDART_API_KEY','OPEN_DART_API_KEY','DART_API_KEY','DART_KEY','OPEN_DART_KEY']) {
    const key=String(env[n] ?? parsed[n] ?? '').trim();
    if (key) return key;
  }
  throw new Error('DART_API_KEY_NOT_FOUND');
}

function parseDartDate(v) {
  if (typeof v!=='string') return null;
  const m=v.match(/(20\d{2})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})/);
  if (!m) return null;
  const iso=`${m[1]}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[3])).padStart(2,'0')}`;
  const d=new Date(iso+'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===iso ? iso : null;
}

function parseRatio(v) {
  if (typeof v!=='string') return null;
  const m=v.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
  return m ? {left:Number(m[1]),right:Number(m[2]),text:`${m[1]}:${m[2]}`} : null;
}

function stripCorrectionPrefix(name) {
  return String(name??'').replace(/^\s*\[(?:기재정정|첨부정정|첨부추가|변경등록|발행조건확정|정정명령부과|정정제출요구)\]\s*/,'').trim();
}

function keyOf(candidate) { return `${candidate.receiptNo}|${candidate.candidateActionType}`; }

function decodeStructuredBody(detailRecord) {
  const raw=detailRecord?.structured?.rawBase64;
  if (!raw) return null;
  let body;
  try { body=JSON.parse(Buffer.from(raw,'base64').toString('utf8').replace(/^\uFEFF/,'')); }
  catch { throw new Error('INVALID_STORED_STRUCTURED_JSON'); }
  if (!isObject(body) || body.status!=='000' || !Array.isArray(body.list)) throw new Error('INVALID_STORED_STRUCTURED_BODY');
  return body;
}

function exactStructuredOriginal(detailRecord, originalReceiptNo) {
  const body=decodeStructuredBody(detailRecord);
  if (!body) return null;
  const rows=body.list.filter(r=>isObject(r) && r.rcept_no===originalReceiptNo && r.corp_code===detailRecord.candidate.corpCode);
  if (rows.length!==1) return null;
  return rows[0];
}

function eventFromMergerStructured(row) {
  const ratio=parseRatio(row?.mg_rt);
  const effectiveDate=parseDartDate(row?.mgsc_mgdt);
  const listingDate=parseDartDate(row?.mgsc_nstklstprd);
  if (!ratio || !effectiveDate) return null;
  return {actionType:'MERGER',effectiveDate,listingDate,ratio,detailSource:'DART_STRUCTURED_ORIGINAL_VIA_RESOLVED_CHAIN'};
}

function validateInputs(detail,parsed,chain,dividend) {
  if (!isObject(detail)||detail.version!==DETAIL_VERSION||!Array.isArray(detail.records)) throw new Error('INVALID_V9_7_2_REPORT');
  if (!isObject(parsed)||parsed.version!==PARSE_VERSION||!Array.isArray(parsed.records)) throw new Error('INVALID_V9_7_3_REPORT');
  if (!isObject(chain)||chain.version!==CHAIN_VERSION||!Array.isArray(chain.records)) throw new Error('INVALID_V9_7_4_1_REPORT');
  if (!isObject(dividend)||dividend.version!==DIVIDEND_REPAIR_VERSION||!Array.isArray(dividend.records)) throw new Error('INVALID_V9_7_5_1_REPORT');
  const hashes=[detail.sampleHash,parsed.sampleHash,chain.sampleHash,dividend.sampleHash].filter(Boolean);
  if (new Set(hashes).size>1) throw new Error('INPUT_SAMPLE_HASH_MISMATCH');
  if ((chain.summary?.correctionChainsUnresolved??0)!==0 || (chain.summary?.withdrawalLinksUnresolved??0)!==0 || (chain.summary?.errors??0)!==0) throw new Error('CHAIN_STAGE_NOT_CLOSED');
  if ((dividend.summary?.marketAdjustmentDatesUnresolved??0)!==0 || (dividend.summary?.errors??0)!==0) throw new Error('DIVIDEND_STAGE_NOT_CLOSED');
}

async function fetchOriginalDocument(receiptNo,key,options={}) {
  const fetcher=options.fetcher??fetch;
  const url=new URL('https://opendart.fss.or.kr/api/document.xml');
  url.search=new URLSearchParams({crtfc_key:key,rcept_no:receiptNo}).toString();
  const response=await fetcher(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const declared=Number(response.headers.get('content-length')||0);
  if (declared>MAX_ORIGINAL_DOCUMENT) throw new Error('RESPONSE_TOO_LARGE');
  const bytes=Buffer.from(await response.arrayBuffer());
  if (bytes.length>MAX_ORIGINAL_DOCUMENT) throw new Error('RESPONSE_TOO_LARGE');
  const text=bytes.toString('utf8').replace(/^\uFEFF/,'').trim();
  if (text.startsWith('{')) {
    try {
      const b=JSON.parse(text);
      if (b?.status==='013'||b?.status==='014') return {status:'SOURCE_UNAVAILABLE',providerStatus:b.status};
      if (/^\d{3}$/.test(b?.status??'')) throw new Error('DART_STATUS_'+b.status);
    } catch(error) { if (safeError(error)!=='FINALIZATION_FAILED') throw error; }
  }
  if (bytes.length>=4 && bytes.readUInt32LE(0)===0x04034b50) return {status:'DOCUMENT_ZIP_RECEIVED',byteLength:bytes.length,sha256:sha256(bytes),rawBase64:bytes.toString('base64')};
  const xmlStatus=(text.match(/<status>\s*(\d{3})\s*<\/status>/i)||[])[1];
  if (xmlStatus==='013'||xmlStatus==='014') return {status:'SOURCE_UNAVAILABLE',providerStatus:xmlStatus};
  if (xmlStatus) throw new Error('DART_STATUS_'+xmlStatus);
  throw new Error('UNEXPECTED_DOCUMENT_RESPONSE');
}

async function corroborateMergerOriginal(detailRecord,originalReceiptNo,structuredRow,key,options={}) {
  if (options.corroborate===false) return {status:'SKIPPED'};
  let document;
  try { document=await fetchOriginalDocument(originalReceiptNo,key,options); }
  catch(error) { return {status:'ERROR',reason:safeError(error)}; }
  if (document.status!=='DOCUMENT_ZIP_RECEIVED') return {status:document.status,providerStatus:document.providerStatus??null};
  try {
    const parser=options.parser??require(path.join(__dirname,'parse-corporate-action-details-v9-7-3.cjs'));
    const synthetic={
      candidate:{...detailRecord.candidate,receiptNo:originalReceiptNo,receiptDate:originalReceiptNo.slice(0,8),reportName:stripCorrectionPrefix(detailRecord.candidate.reportName),correctionOrWithdrawalHint:false},
      reviewFlags:(detailRecord.reviewFlags||[]).filter(f=>f!=='CORRECTION_CHAIN_REQUIRED'),
      document:{...document,xmlValidated:false,endpoint:'document.xml',query:{rcept_no:originalReceiptNo}},
      structured:{status:'EXACT_RECEIPT_MATCH',matchingRows:[structuredRow]}
    };
    const parsed=parser.parseRecord(synthetic);
    if (parsed.parseStatus!=='VALIDATED'||parsed.event?.actionType!=='MERGER') return {status:'PARSE_NOT_VALIDATED',parseStatus:parsed.parseStatus,reason:parsed.reason};
    return {status:'CORROBORATED',xml:parsed.xml,event:parsed.event,documentSha256:document.sha256};
  } catch(error) { return {status:'ERROR',reason:safeError(error)}; }
}

async function finalize(detail,parsed,chain,dividend,key,options={}) {
  validateInputs(detail,parsed,chain,dividend);
  const detailMap=new Map(detail.records.map(r=>[keyOf(r.candidate),r]));
  const chainMap=new Map(chain.records.map(r=>[keyOf(r.candidate),r]));
  const dividendMap=new Map(dividend.records.map(r=>[keyOf(r.candidate),r]));
  const state={version:VERSION,inputVersions:[detail.version,parsed.version,chain.version,dividend.version],sampleHash:detail.sampleHash,
    inventoryRunId:detail.inventoryRunId,sourceCoverageWindowId:detail.sourceCoverageWindowId,scope:'SAMPLE_ONLY_NOT_COVERAGE',
    eventImportComplete:false,coveragePromoted:false,status:'RUNNING',records:[]};

  for (const p of parsed.records) {
    const keyId=keyOf(p.candidate);
    const d=detailMap.get(keyId);
    const c=chainMap.get(keyId);
    const dv=dividendMap.get(keyId);
    let out;
    try {
      if (p.parseStatus==='VALIDATED') {
        out={finalStatus:'VALIDATED',finalReason:p.reason,event:p.event,evidencePolicy:'V9_7_3_EXPLICIT_SOURCE_FIELDS'};
      } else if (p.parseStatus==='REJECTED') {
        out={finalStatus:'REJECTED',finalReason:p.reason,event:null,evidencePolicy:'V9_7_3_SCOPE_OR_FOLLOWUP_REJECTION'};
      } else if (p.parseStatus==='PARSED_NEEDS_EFFECTIVE_DATE') {
        const resolved = dv && (dv.status==='RESOLVED' || dv.repairStatus==='RESOLVED') && dv.event?.effectiveDate;
        if (!resolved) out={finalStatus:'UNRESOLVED',finalReason:'DIVIDEND_EFFECTIVE_DATE_NOT_CLOSED',event:null};
        else out={finalStatus:'VALIDATED',finalReason:dv.repairStatus==='RESOLVED'?dv.repairReason:dv.reason,event:dv.event,
          evidencePolicy:dv.repairStatus==='RESOLVED'?'DART_RECORD_DATE_PLUS_KRX_T2_PLUS_OFFICIAL_KRX_HOLIDAY_CALENDAR':'EXPLICIT_KRX_KIND_MARKET_ACTION'};
      } else if (p.parseStatus==='UNRESOLVED' && (d?.reviewFlags||[]).includes('WITHDRAWAL_MUST_LINK_ORIGINAL')) {
        if (c?.chainType==='WITHDRAWAL' && c.status==='RESOLVED' && /^\d{14}$/.test(c.originalReceiptNo??'')) {
          out={finalStatus:'REJECTED',finalReason:'WITHDRAWAL_CONFIRMED_SUPPRESS_ORIGINAL_EVENT',event:null,
            suppressOriginalReceiptNo:c.originalReceiptNo,evidencePolicy:'RESOLVED_DART_WITHDRAWAL_CHAIN'};
        } else out={finalStatus:'UNRESOLVED',finalReason:'WITHDRAWAL_CHAIN_NOT_CLOSED',event:null};
      } else if (p.parseStatus==='UNRESOLVED' && p.candidate.candidateActionType==='MERGER' && d?.document?.status==='SOURCE_UNAVAILABLE') {
        if (!/^\s*\[첨부정정\]/.test(d.candidate.reportName??'')) {
          out={finalStatus:'UNRESOLVED',finalReason:'SOURCE_UNAVAILABLE_NON_ATTACHMENT_CORRECTION',event:null};
        } else if (!(c?.chainType==='CORRECTION' && c.status==='RESOLVED' && /^\d{14}$/.test(c.originalReceiptNo??''))) {
          out={finalStatus:'UNRESOLVED',finalReason:'CORRECTION_CHAIN_NOT_CLOSED',event:null};
        } else {
          const sr=exactStructuredOriginal(d,c.originalReceiptNo);
          const event=sr?eventFromMergerStructured(sr):null;
          if (!sr || !event) {
            out={finalStatus:'UNRESOLVED',finalReason:sr?'ORIGINAL_STRUCTURED_REQUIRED_FIELD_MISSING':'EXACT_ORIGINAL_STRUCTURED_ROW_NOT_FOUND',event:null};
          } else {
            const corroboration=await corroborateMergerOriginal(d,c.originalReceiptNo,sr,key,options);
            if (corroboration.status==='CORROBORATED') {
              const sameDate=corroboration.event?.effectiveDate===event.effectiveDate;
              const a=corroboration.event?.ratio, b=event.ratio;
              const sameRatio=!!a && Math.abs(a.left-b.left)<1e-12 && Math.abs(a.right-b.right)<1e-12;
              if (!sameDate || !sameRatio) {
                out={finalStatus:'UNRESOLVED',finalReason:'ORIGINAL_DOCUMENT_STRUCTURED_MISMATCH',event:null,corroboration};
              } else {
                out={finalStatus:'VALIDATED',finalReason:'ATTACHMENT_CORRECTION_RECOVERED_FROM_RESOLVED_ORIGINAL',event,
                  canonicalReceiptNo:c.originalReceiptNo,currentCorrectionReceiptNo:d.candidate.receiptNo,
                  evidencePolicy:'RESOLVED_CHAIN_PLUS_EXACT_DART_STRUCTURED_ORIGINAL_PLUS_DOCUMENT_CORROBORATION',corroboration};
              }
            } else if (['SOURCE_UNAVAILABLE','SKIPPED'].includes(corroboration.status)) {
              out={finalStatus:'VALIDATED',finalReason:'ATTACHMENT_CORRECTION_RECOVERED_FROM_EXACT_DART_STRUCTURED_ORIGINAL',event,
                canonicalReceiptNo:c.originalReceiptNo,currentCorrectionReceiptNo:d.candidate.receiptNo,
                evidencePolicy:'RESOLVED_ATTACHMENT_CORRECTION_CHAIN_PLUS_EXACT_DART_STRUCTURED_ORIGINAL',corroboration};
            } else {
              out={finalStatus:'UNRESOLVED',finalReason:'ORIGINAL_DOCUMENT_CORROBORATION_ERROR',event:null,corroboration};
            }
          }
        }
      } else {
        out={finalStatus:p.parseStatus==='ERROR'?'ERROR':'UNRESOLVED',finalReason:p.reason||'UNHANDLED_FINALIZATION_CASE',event:null};
      }
    } catch(error) {
      out={finalStatus:'ERROR',finalReason:safeError(error),event:null};
    }
    state.records.push({candidate:p.candidate,priorParseStatus:p.parseStatus,priorReason:p.reason,...out,eventInsertAllowed:false});
    console.log(`${p.candidate.candidateActionType} ${p.candidate.receiptNo}: ${out.finalStatus} ${out.finalReason}`);
  }

  const count=s=>state.records.filter(r=>r.finalStatus===s).length;
  const errors=count('ERROR'), unresolved=count('UNRESOLVED');
  state.status=errors?'HAS_ERRORS':unresolved?'CANONICAL_SAMPLE_INCOMPLETE':'CANONICAL_SAMPLE_FINALIZED';
  state.summary={samples:state.records.length,validatedEvents:count('VALIDATED'),rejectedCandidates:count('REJECTED'),
    unresolvedCandidates:unresolved,errors,withdrawnOriginalsSuppressed:state.records.filter(r=>r.suppressOriginalReceiptNo).length,
    sourceUnavailableCorrectionsRecovered:state.records.filter(r=>r.finalReason?.startsWith('ATTACHMENT_CORRECTION_RECOVERED_')).length,
    expectedSampleInvariant:'VALIDATED_15_REJECTED_6_UNRESOLVED_0',eventRowsInserted:0,coveragePromoted:false};
  return state;
}

async function main() {
  if (typeof fetch!=='function') throw new Error('NODE_18_OR_NEWER_REQUIRED');
  const root=path.resolve(__dirname,'..');
  const args=process.argv.slice(2);
  if (args.some(a=>!a.startsWith('--detail=')&&!a.startsWith('--parsed=')&&!a.startsWith('--chain=')&&!a.startsWith('--dividend=')&&!a.startsWith('--output='))) throw new Error('UNKNOWN_OPTION');
  const get=(prefix,def)=>{const a=args.find(x=>x.startsWith(prefix)); return a?path.resolve(a.slice(prefix.length)):def;};
  const detailFile=get('--detail=',path.join(root,'logs','corporate-action-detail-probe-v9-7-2.json'));
  const parsedFile=get('--parsed=',path.join(root,'logs','corporate-action-parse-probe-v9-7-3.json'));
  const chainFile=get('--chain=',path.join(root,'logs','corporate-action-chain-repair-probe-v9-7-4-1.json'));
  const dividendFile=get('--dividend=',path.join(root,'logs','corporate-action-dividend-market-adjustment-repair-v9-7-5-1.json'));
  const outputFile=get('--output=',path.join(root,'logs','corporate-action-canonical-sample-v9-7-6.json'));
  const load=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
  const state=await finalize(load(detailFile),load(parsedFile),load(chainFile),load(dividendFile),readKey(root));
  save(outputFile,state);
  console.log(JSON.stringify({status:state.status,...state.summary},null,2));
  console.log('Upload only this report (no .env files): '+outputFile);
  if (state.status!=='CANONICAL_SAMPLE_FINALIZED') process.exitCode=1;
}

module.exports={safeError,parseDartDate,parseRatio,stripCorrectionPrefix,decodeStructuredBody,exactStructuredOriginal,eventFromMergerStructured,
  validateInputs,fetchOriginalDocument,corroborateMergerOriginal,finalize};
if (require.main===module) main().catch(error=>{console.error(safeError(error));process.exitCode=1;});
