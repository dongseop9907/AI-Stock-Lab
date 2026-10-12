'use strict';
// Dependency-free, read-only source probe. Does not write to Supabase or events.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const TYPES = new Set(['STOCK_SPLIT','REVERSE_SPLIT','CASH_DIVIDEND','STOCK_DIVIDEND','RIGHTS_ISSUE','SPIN_OFF','MERGER']);
const ENDPOINTS = new Set(['document.xml','piicDecsn.json','pifricDecsn.json','cmpMgDecsn.json','cmpDvDecsn.json','cmpDvmgDecsn.json']);
const MAX_RESPONSE = 8 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function validSample(s) {
  if (!s || typeof s !== 'object' || !/^\d{14}$/.test(s.receiptNo ?? '') || !/^\d{8}$/.test(s.corpCode ?? '') ||
      !/^\d{8}$/.test(s.receiptDate ?? '') || !TYPES.has(s.candidateActionType) || typeof s.reportName !== 'string' ||
      (s.stockCode !== null && s.stockCode !== '' && !/^[0-9A-Z]{6}$/.test(s.stockCode ?? ''))) throw new Error('INVALID_SAMPLE');
  const d = `${s.receiptDate.slice(0,4)}-${s.receiptDate.slice(4,6)}-${s.receiptDate.slice(6,8)}`;
  const time = new Date(d + 'T00:00:00Z');
  if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0,10) !== d) throw new Error('INVALID_SAMPLE_DATE');
  return s;
}
function flags(s) {
  const title = s.reportName.replace(/\s/g,'');
  const out = ['DETAIL_NOT_YET_VERIFIED','EFFECTIVE_DATE_NOT_PROVEN','NO_EVENT_INSERT'];
  if (/종속회사|자회사/.test(title)) out.push('OTHER_ENTITY_SCOPE');
  if (/철회/.test(title)) out.push('WITHDRAWAL_MUST_LINK_ORIGINAL');
  if (/정정|첨부추가/.test(title)) out.push('CORRECTION_CHAIN_REQUIRED');
  if (/거래정지|거래재개|최종발행가액|발행결과/.test(title)) out.push('FOLLOWUP_NOTICE_NOT_NEW_EVENT');
  if (/제3자배정|일반공모/.test(title)) out.push('ALLOCATION_METHOD_NOT_PROVEN_RIGHTS_ISSUE');
  if (/현금.*현물/.test(title)) out.push('CASH_OR_IN_KIND_REQUIRES_DETAIL');
  if (/[A-Z]/.test(s.stockCode ?? '')) out.push('ALPHANUMERIC_STOCK_CODE_PRESERVED');
  return out;
}
function structuredEndpoint(s) {
  if (/회사분할합병/.test(s.reportName)) return 'cmpDvmgDecsn.json';
  if (s.candidateActionType === 'MERGER') return 'cmpMgDecsn.json';
  if (s.candidateActionType === 'SPIN_OFF') return 'cmpDvDecsn.json';
  if (s.candidateActionType === 'RIGHTS_ISSUE') return /유무상증자/.test(s.reportName) ? 'pifricDecsn.json' : 'piicDecsn.json';
  return null; // Never substitute annual dividend data for a per-event record.
}
function readKey(root, env = process.env) {
  const parsed = {};
  const file = path.join(root,'.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let value = m[2];
      if (/^['"]/.test(value)) {
        const quote = value[0], end = value.indexOf(quote,1);
        if (end < 0 || !/^\s*(?:#.*)?$/.test(value.slice(end+1))) continue;
        value = value.slice(1,end);
      } else value = value.replace(/\s*#.*$/,'').trim();
      parsed[m[1]] = value;
    }
  }
  for (const name of ['OPENDART_API_KEY','OPEN_DART_API_KEY','DART_API_KEY','DART_KEY','OPEN_DART_KEY']) {
    const key = String(env[name] ?? parsed[name] ?? '').trim();
    if (key) return key;
  }
  throw new Error('DART_API_KEY_NOT_FOUND');
}
function safeError(error) {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'REQUEST_FAILED';
}
async function requestBytes(endpoint, params, key, fetcher = fetch) {
  if (!ENDPOINTS.has(endpoint)) throw new Error('INVALID_ENDPOINT');
  const url = new URL('https://opendart.fss.or.kr/api/' + endpoint);
  url.search = new URLSearchParams({ ...params, crtfc_key: key }).toString();
  try {
    const response = await fetcher(url, { redirect:'error', cache:'no-store', signal:AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE) throw new Error('RESPONSE_TOO_LARGE');
    if (!response.body) throw new Error('EMPTY_RESPONSE');
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_RESPONSE) { await reader.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
        chunks.push(Buffer.from(part.value));
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
  } catch (error) { throw new Error(safeError(error)); }
}
function dartStatus(bytes) {
  const s = bytes.toString('utf8').replace(/^\uFEFF/,'').trim();
  if (s.startsWith('{')) {
    try { const code = JSON.parse(s).status; if (/^\d{3}$/.test(code)) return code; } catch {}
  }
  const code = s.match(/<status>\s*(\d{3})\s*<\/status>/i);
  return code ? code[1] : null;
}
function zipEnvelope(bytes) {
  // Container inspection only, not XML validation. No extraction or filesystem paths from ZIP.
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) return false;
  for (let p=bytes.length-22; p>=Math.max(0,bytes.length-65557); p--) {
    if (bytes.readUInt32LE(p) !== 0x06054b50) continue;
    if (p+22+bytes.readUInt16LE(p+20) !== bytes.length) continue;
    const count=bytes.readUInt16LE(p+10), offset=bytes.readUInt32LE(p+16), size=bytes.readUInt32LE(p+12);
    return bytes.readUInt16LE(p+4)===0 && bytes.readUInt16LE(p+6)===0 && count>0 && count<65535 &&
      bytes.readUInt16LE(p+8)===count && offset+size===p && offset+4<=p && bytes.readUInt32LE(offset)===0x02014b50;
  }
  return false;
}
function classifyDocument(bytes) {
  if (zipEnvelope(bytes)) return { status:'DOCUMENT_ZIP_RECEIVED', byteLength:bytes.length, sha256:hash(bytes), rawBase64:bytes.toString('base64'), xmlValidated:false };
  const code = dartStatus(bytes);
  if (code === '013' || code === '014') return { status:'SOURCE_UNAVAILABLE', providerStatus:code, provesNoEvent:false };
  if (code) throw new Error('DART_STATUS_' + code);
  throw new Error('UNEXPECTED_DOCUMENT_RESPONSE');
}
function classifyStructured(bytes, sample, key) {
  // Provider error messages are never persisted; they might echo request details.
  let b;
  try { b=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')); } catch { throw new Error('INVALID_STRUCTURED_JSON'); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('INVALID_STRUCTURED_JSON');
  if (b.status === '013') return { status:'NO_STRUCTURED_DATA', providerStatus:'013', provesNoEvent:false };
  if (b.status !== '000') throw new Error(/^\d{3}$/.test(b.status) ? 'DART_STATUS_'+b.status : 'INVALID_PROVIDER_STATUS');
  if (!Array.isArray(b.list) || !b.list.length) throw new Error('INVALID_STRUCTURED_LIST');
  if (key && bytes.includes(Buffer.from(key))) throw new Error('SECRET_IN_PROVIDER_RESPONSE');
  if (b.list.some(r => !r || typeof r !== 'object' || r.corp_code !== sample.corpCode || !/^\d{14}$/.test(r.rcept_no ?? ''))) throw new Error('STRUCTURED_IDENTITY_MISMATCH');
  const matched = b.list.filter(r => r.rcept_no === sample.receiptNo);
  return { status:matched.length ? 'EXACT_RECEIPT_MATCH' : 'NO_EXACT_RECEIPT_MATCH', matchingRows:matched,
    responseRows:b.list.length, sha256:hash(bytes), rawBase64:bytes.toString('base64'), byteLength:bytes.length,
    provesNoEvent:false, historicalAvailabilityProven:false };
}
function reusable(result) {
  if (!result || !['DOCUMENT_ZIP_RECEIVED','SOURCE_UNAVAILABLE','NO_STRUCTURED_DATA','EXACT_RECEIPT_MATCH','NO_EXACT_RECEIPT_MATCH','NO_DOCUMENTED_ENDPOINT'].includes(result.status)) return false;
  if (result.rawBase64) return hash(Buffer.from(result.rawBase64,'base64'))===result.sha256;
  return !['DOCUMENT_ZIP_RECEIVED','EXACT_RECEIPT_MATCH','NO_EXACT_RECEIPT_MATCH'].includes(result.status);
}
function save(file, state) {
  const tmp=file+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(state,null,2),'utf8'); fs.renameSync(tmp,file);
}
function byteTotal(records) {
  return records.reduce((sum,r)=>sum+(r.document?.byteLength||0)+(r.structured?.byteLength||0),0);
}
function shouldStop(code) { return /^DART_STATUS_(010|011|012|020|901)$/.test(code); }
async function collect(config, output, key, options={}) {
  const fetcher=options.fetcher ?? fetch, delay=options.delay ?? 500, refresh=options.refresh ?? false;
  const sampleHash=hash(Buffer.from(JSON.stringify(config.samples)));
  config.samples.forEach(validSample);
  if (new Set(config.samples.map(s=>s.receiptNo+'|'+s.candidateActionType)).size!==config.samples.length) throw new Error('DUPLICATE_SAMPLE');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  let state={version:'V9_7_2_DETAIL_PROBE',sampleHash,inventoryRunId:config.inventoryRunId,
    sourceCoverageWindowId:config.sourceCoverageWindowId,scope:'SAMPLE_ONLY_NOT_COVERAGE',
    eventImportComplete:false,records:[],status:'RUNNING'};
  if (fs.existsSync(output)) {
    state=JSON.parse(fs.readFileSync(output,'utf8'));
    if (state.sampleHash!==sampleHash || state.version!=='V9_7_2_DETAIL_PROBE') throw new Error('PROBE_STATE_MISMATCH');
    if (!Array.isArray(state.records)) throw new Error('INVALID_PROBE_STATE');
  }
  state.status='RUNNING'; save(output,state);
  for (const sample of config.samples) {
    let record=state.records.find(r=>r.candidate.receiptNo===sample.receiptNo && r.candidate.candidateActionType===sample.candidateActionType);
    if (!record) { record={candidate:sample,reviewFlags:flags(sample)}; state.records.push(record); }
    for (const kind of ['document','structured']) {
      if (!refresh && reusable(record[kind])) continue;
      const endpoint=kind==='document'?'document.xml':structuredEndpoint(sample);
      if (!endpoint) { record[kind]={status:'NO_DOCUMENTED_ENDPOINT'}; save(output,state); continue; }
      try {
        // Structured query is indexed by FIRST filing date, not correction date.
        // Query documented historical availability and require an exact receipt match.
        const params=kind==='document'?{rcept_no:sample.receiptNo}:{corp_code:sample.corpCode,bgn_de:'20150101',end_de:sample.receiptDate};
        const bytes=await requestBytes(endpoint,params,key,fetcher);
        const result=kind==='document'?classifyDocument(bytes):classifyStructured(bytes,sample,key);
        if (byteTotal(state.records)-(record[kind]?.byteLength||0)+(result.byteLength||0)>MAX_TOTAL) throw new Error('BUNDLE_SIZE_LIMIT');
        record[kind]={...result,endpoint,fetchedAt:new Date().toISOString(),query:params};
      } catch(error) {
        const code=safeError(error); record[kind]={status:'ERROR',code,endpoint,fetchedAt:new Date().toISOString()};
        state.status='HAS_ERRORS'; save(output,state);
        if (shouldStop(code) || code==='BUNDLE_SIZE_LIMIT') { state.status='STOPPED'; save(output,state); throw new Error(code); }
      }
      save(output,state);
      if (delay) await wait(delay);
    }
    console.log(`${sample.candidateActionType} ${sample.receiptNo}: document=${record.document.status} structured=${record.structured.status}`);
  }
  state.status=state.records.some(r=>r.document?.status==='ERROR'||r.structured?.status==='ERROR')?'HAS_ERRORS':'PROBE_FINISHED';
  state.summary={samples:state.records.length,documentZips:state.records.filter(r=>r.document?.status==='DOCUMENT_ZIP_RECEIVED').length,
    documentUnavailable:state.records.filter(r=>r.document?.status==='SOURCE_UNAVAILABLE').length,
    structuredExactMatches:state.records.filter(r=>r.structured?.status==='EXACT_RECEIPT_MATCH').length,
    eventRowsInserted:0,coveragePromoted:false};
  save(output,state); return state;
}
async function main() {
  if (typeof fetch!=='function') throw new Error('NODE_18_OR_NEWER_REQUIRED');
  const allowed=new Set(['--refresh']);
  if (process.argv.slice(2).some(a=>!allowed.has(a))) throw new Error('UNKNOWN_OPTION');
  const root=path.resolve(__dirname,'..');
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'corporate-action-detail-samples-v9-7-2.json'),'utf8'));
  const output=path.join(root,'logs','corporate-action-detail-probe-v9-7-2.json');
  const state=await collect(config,output,readKey(root),{refresh:process.argv.includes('--refresh')});
  console.log(JSON.stringify({status:state.status,...state.summary},null,2));
  console.log('Upload only this report (no .env files): '+output);
  if(state.status==='HAS_ERRORS') process.exitCode=1;
}
module.exports={validSample,flags,structuredEndpoint,readKey,safeError,requestBytes,dartStatus,zipEnvelope,classifyDocument,classifyStructured,reusable,collect,hash,shouldStop};
if(require.main===module) main().catch(error=>{console.error(safeError(error));console.error('Progress saved when available. Fix the error and rerun the same command.');process.exitCode=1;});
