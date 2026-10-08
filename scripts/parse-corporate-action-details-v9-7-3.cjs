'use strict';
// V9.7.3 offline parse probe.
// Reads the V9.7.2 captured report, validates/decompresses DART ZIP/XML in memory,
// extracts conservative corporate-action fields, and NEVER writes Supabase/events.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const VERSION = 'V9_7_3_PARSE_PROBE';
const INPUT_VERSION = 'V9_7_2_DETAIL_PROBE';
const MAX_ZIP_ENTRIES = 32;
const MAX_XML_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 32 * 1024 * 1024;
const TYPES = new Set(['STOCK_SPLIT','REVERSE_SPLIT','CASH_DIVIDEND','STOCK_DIVIDEND','RIGHTS_ISSUE','SPIN_OFF','MERGER']);

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const isObject = v => v && typeof v === 'object' && !Array.isArray(v);

function safeError(error) {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PARSE_FAILED';
}

function save(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function crc32Table() {
  const t = new Uint32Array(256);
  for (let n=0;n<256;n++) {
    let c=n;
    for (let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n]=c >>> 0;
  }
  return t;
}
const CRC32_TABLE = crc32Table();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = CRC32_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function findEocd(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) throw new Error('INVALID_ZIP');
  for (let p=bytes.length-22; p>=Math.max(0,bytes.length-65557); p--) {
    if (bytes.readUInt32LE(p) !== 0x06054b50) continue;
    const commentLen=bytes.readUInt16LE(p+20);
    if (p+22+commentLen !== bytes.length) continue;
    const disk=bytes.readUInt16LE(p+4), cdDisk=bytes.readUInt16LE(p+6);
    const countDisk=bytes.readUInt16LE(p+8), count=bytes.readUInt16LE(p+10);
    const cdSize=bytes.readUInt32LE(p+12), cdOffset=bytes.readUInt32LE(p+16);
    if (disk!==0 || cdDisk!==0 || countDisk!==count) throw new Error('MULTIDISK_ZIP_UNSUPPORTED');
    if (!count || count>MAX_ZIP_ENTRIES || count===0xFFFF || cdSize===0xFFFFFFFF || cdOffset===0xFFFFFFFF) throw new Error('ZIP64_OR_ENTRY_LIMIT');
    if (cdOffset+cdSize !== p) throw new Error('INVALID_CENTRAL_DIRECTORY');
    return {count,cdOffset,cdSize};
  }
  throw new Error('ZIP_EOCD_NOT_FOUND');
}

function readZipEntries(bytes) {
  const eocd=findEocd(bytes), entries=[];
  let p=eocd.cdOffset;
  for (let i=0;i<eocd.count;i++) {
    if (p+46>bytes.length || bytes.readUInt32LE(p)!==0x02014b50) throw new Error('INVALID_CENTRAL_ENTRY');
    const flags=bytes.readUInt16LE(p+8), method=bytes.readUInt16LE(p+10), expectedCrc=bytes.readUInt32LE(p+16)>>>0;
    const compressedSize=bytes.readUInt32LE(p+20), uncompressedSize=bytes.readUInt32LE(p+24);
    const nameLen=bytes.readUInt16LE(p+28), extraLen=bytes.readUInt16LE(p+30), commentLen=bytes.readUInt16LE(p+32);
    const localOffset=bytes.readUInt32LE(p+42);
    if ([compressedSize,uncompressedSize,localOffset].includes(0xFFFFFFFF)) throw new Error('ZIP64_UNSUPPORTED');
    if (flags & 0x0001) throw new Error('ENCRYPTED_ZIP_UNSUPPORTED');
    if (![0,8].includes(method)) throw new Error('ZIP_METHOD_UNSUPPORTED');
    if (uncompressedSize>MAX_XML_BYTES) throw new Error('XML_TOO_LARGE');
    const nameStart=p+46, nameEnd=nameStart+nameLen;
    if (nameEnd+extraLen+commentLen>bytes.length) throw new Error('INVALID_CENTRAL_ENTRY');
    const name=bytes.subarray(nameStart,nameEnd).toString((flags&0x0800)?'utf8':'utf8');
    if (name.includes('\0')) throw new Error('INVALID_ZIP_NAME');
    if (localOffset+30>bytes.length || bytes.readUInt32LE(localOffset)!==0x04034b50) throw new Error('INVALID_LOCAL_ENTRY');
    const localNameLen=bytes.readUInt16LE(localOffset+26), localExtraLen=bytes.readUInt16LE(localOffset+28);
    const dataStart=localOffset+30+localNameLen+localExtraLen, dataEnd=dataStart+compressedSize;
    if (dataEnd>bytes.length) throw new Error('TRUNCATED_ZIP_ENTRY');
    const compressed=bytes.subarray(dataStart,dataEnd);
    const raw=method===0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed,{maxOutputLength:MAX_XML_BYTES});
    if (raw.length!==uncompressedSize) throw new Error('ZIP_SIZE_MISMATCH');
    if (crc32(raw)!==expectedCrc) throw new Error('ZIP_CRC_MISMATCH');
    entries.push({name,method,compressedSize,uncompressedSize,sha256:hash(raw),bytes:raw});
    p=nameEnd+extraLen+commentLen;
  }
  if (p!==eocd.cdOffset+eocd.cdSize) throw new Error('CENTRAL_DIRECTORY_SIZE_MISMATCH');
  return entries;
}

function extractXml(documentResult) {
  if (!documentResult || documentResult.status!=='DOCUMENT_ZIP_RECEIVED') throw new Error('DOCUMENT_NOT_AVAILABLE');
  if (typeof documentResult.rawBase64!=='string' || !/^[A-Za-z0-9+/=]+$/.test(documentResult.rawBase64)) throw new Error('INVALID_DOCUMENT_BASE64');
  const zip=Buffer.from(documentResult.rawBase64,'base64');
  if (hash(zip)!==documentResult.sha256) throw new Error('DOCUMENT_HASH_MISMATCH');
  const entries=readZipEntries(zip);
  const xmlEntries=entries.filter(e=>/\.xml$/i.test(e.name));
  if (xmlEntries.length!==1) throw new Error('XML_ENTRY_COUNT_UNEXPECTED');
  const entry=xmlEntries[0];
  let text=entry.bytes.toString('utf8').replace(/^\uFEFF/,'');
  if (!/^\s*<\?xml\b|^\s*</i.test(text)) throw new Error('INVALID_XML_TEXT');
  return {entryName:entry.name,byteLength:entry.bytes.length,sha256:entry.sha256,text};
}

function decodeEntities(s) {
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(m,k)=>{
    if (k[0]==='#') {
      const n=k[1].toLowerCase()==='x'?parseInt(k.slice(2),16):parseInt(k.slice(1),10);
      return Number.isFinite(n) && n>=0 && n<=0x10FFFF ? String.fromCodePoint(n) : m;
    }
    return named[k.toLowerCase()] ?? m;
  });
}
function xmlTextNodes(xml) {
  const cleaned=xml.replace(/<!--[\s\S]*?-->/g,' ').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'>$1<');
  const out=[];
  for (const m of cleaned.matchAll(/>([^<>]+)</g)) {
    const s=decodeEntities(m[1]).replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
    if (s) out.push(s);
  }
  if (!out.length) throw new Error('NO_XML_TEXT_NODES');
  return out;
}

function parseDate(v) {
  if (typeof v!=='string') return null;
  const s=v.trim();
  let m=s.match(/\b(20\d{2})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\b/);
  if (!m) m=s.match(/\b(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!m) return null;
  const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
  const iso=`${String(y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const dt=new Date(iso+'T00:00:00Z');
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0,10)===iso ? iso : null;
}
function parseNumber(v) {
  if (typeof v!=='string') return null;
  const s=v.replace(/,/g,'').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const n=Number(s); return Number.isFinite(n)?n:null;
}
function parseIntegerString(v) {
  if (typeof v!=='string') return null;
  const s=v.replace(/,/g,'').trim();
  return /^-?\d+$/.test(s)?s:null;
}
function findIndex(nodes, matcher, start=0) {
  for(let i=start;i<nodes.length;i++) if (typeof matcher==='string'?nodes[i]===matcher:matcher.test(nodes[i])) return i;
  return -1;
}
function findLastIndex(nodes, matcher) {
  for(let i=nodes.length-1;i>=0;i--) if (typeof matcher==='string'?nodes[i]===matcher:matcher.test(nodes[i])) return i;
  return -1;
}
function firstAfter(nodes, matcher, opts={}) {
  const i=findIndex(nodes,matcher,opts.start??0); if(i<0) return null;
  const max=opts.maxLookahead??8;
  for(let j=i+1;j<nodes.length && j<=i+max;j++) {
    const v=nodes[j];
    if (opts.test ? opts.test(v) : (v!=='-' && v!=='')) return v;
  }
  return null;
}
function dateAfter(nodes, matcher, opts={}) { const v=firstAfter(nodes,matcher,{...opts,test:x=>!!parseDate(x)}); return parseDate(v); }
function numberAfter(nodes, matcher, opts={}) { const v=firstAfter(nodes,matcher,{...opts,test:x=>parseNumber(x)!==null}); return parseNumber(v); }
function intStringAfter(nodes, matcher, opts={}) { const v=firstAfter(nodes,matcher,{...opts,test:x=>parseIntegerString(x)!==null}); return parseIntegerString(v); }
function valueAfterSubLabel(nodes, heading, subLabel, parser, maxWindow=20, start=0) {
  const h=findIndex(nodes,heading,start); if(h<0) return null;
  const end=Math.min(nodes.length,h+maxWindow);
  for(let i=h+1;i<end;i++) {
    if ((typeof subLabel==='string' && nodes[i]===subLabel) || (subLabel instanceof RegExp && subLabel.test(nodes[i]))) {
      for(let j=i+1;j<end;j++) { const v=parser(nodes[j]); if(v!==null) return v; }
    }
  }
  return null;
}
function structuredRow(record) {
  return record.structured?.status==='EXACT_RECEIPT_MATCH' && Array.isArray(record.structured.matchingRows) && record.structured.matchingRows.length===1
    ? record.structured.matchingRows[0] : null;
}
function titleCompact(record) { return String(record.candidate.reportName||'').replace(/\s+/g,''); }
function hasFlag(record, flag) { return Array.isArray(record.reviewFlags) && record.reviewFlags.includes(flag); }

function parseCashDividend(record,nodes) {
  const main=findLastIndex(nodes,/^현금ㆍ현물배당 결정$/);
  const start=main>=0?main:0;
  const kind=firstAfter(nodes,/^2\.\s*배당종류$/,{start,maxLookahead:3});
  if (!kind || !/현금배당/.test(kind)) return {status:'REJECTED',reason:'NOT_PURE_CASH_DIVIDEND'};
  const perShare=valueAfterSubLabel(nodes,/^3\.\s*1주당 배당금\(원\)$/, '보통주식', parseNumber, 12, start);
  const recordDate=dateAfter(nodes,/^6\.\s*배당기준일$/,{start,maxLookahead:3});
  const paymentDate=dateAfter(nodes,/^7\.\s*배당금지급 예정일자$/,{start,maxLookahead:3});
  const total=intStringAfter(nodes,/^5\.\s*배당금총액\(원\)$/,{start,maxLookahead:3});
  if (perShare===null || !recordDate) return {status:'UNRESOLVED',reason:'CASH_DIVIDEND_REQUIRED_FIELD_MISSING'};
  return {status:'PARSED_NEEDS_EFFECTIVE_DATE',reason:'EX_DATE_NOT_PROVEN_BY_SOURCE',event:{actionType:'CASH_DIVIDEND',recordDate,paymentDate,cashPerShare:perShare,totalCashAmount:total,currency:'KRW'}};
}

function parseStockDividend(record,nodes) {
  const main=findLastIndex(nodes,/^주식배당 결정$/);
  const start=main>=0?main:0;
  const perShare=valueAfterSubLabel(nodes,/^1\.\s*1주당 배당주식수\s*\(주\)$/, '보통주식', parseNumber, 12, start);
  const recordDate=dateAfter(nodes,/^4\.\s*배당기준일$/,{start,maxLookahead:3});
  const total=valueAfterSubLabel(nodes,/^2\.\s*배당주식총수\s*\(주\)$/, '보통주식', parseIntegerString, 12, start);
  if (perShare===null || !recordDate) return {status:'UNRESOLVED',reason:'STOCK_DIVIDEND_REQUIRED_FIELD_MISSING'};
  return {status:'PARSED_NEEDS_EFFECTIVE_DATE',reason:'LISTING_OR_ADJUSTMENT_DATE_NOT_PROVEN_BY_SOURCE',event:{actionType:'STOCK_DIVIDEND',recordDate,stockPerShare:perShare,totalDividendShares:total}};
}

function parseSplit(record,nodes) {
  if (hasFlag(record,'FOLLOWUP_NOTICE_NOT_NEW_EVENT')) return {status:'REJECTED',reason:'FOLLOWUP_NOTICE_NOT_NEW_EVENT'};
  const heading=record.candidate.candidateActionType==='STOCK_SPLIT'?/^1\.\s*주식분할 내용$/:/^1\.\s*주식병합 내용$/;
  const h=findIndex(nodes,heading); if(h<0) return {status:'UNRESOLVED',reason:'SPLIT_MAIN_TABLE_NOT_FOUND'};
  let parBefore=null,parAfter=null,sharesBefore=null,sharesAfter=null;
  const par=findIndex(nodes,/^1주당 가액 \(원\)$/,h);
  if(par>=0){ parBefore=parseNumber(nodes[par+1]); parAfter=parseNumber(nodes[par+2]); }
  const issued=findIndex(nodes,/^발행주식총수$/,h);
  if(issued>=0){ const common=findIndex(nodes,/^보통주식\(주\)$/,issued); if(common>=0){sharesBefore=parseIntegerString(nodes[common+1]);sharesAfter=parseIntegerString(nodes[common+2]);} }
  const effectiveDate=dateAfter(nodes,/^신주의 효력발생일$/,{start:h,maxLookahead:4});
  const listingDate=dateAfter(nodes,/^신주권상장예정일$/,{start:h,maxLookahead:4}) || dateAfter(nodes,/^신주의 상장예정일$/,{start:h,maxLookahead:4});
  if (parBefore===null || parAfter===null || parBefore<=0 || parAfter<=0 || !effectiveDate) return {status:'UNRESOLVED',reason:'SPLIT_REQUIRED_FIELD_MISSING'};
  const factor=parBefore/parAfter;
  const expected=record.candidate.candidateActionType==='STOCK_SPLIT' ? factor>1 : factor<1;
  if (!expected) return {status:'UNRESOLVED',reason:'SPLIT_DIRECTION_MISMATCH'};
  return {status:'VALIDATED',reason:'EXPLICIT_EFFECTIVE_DATE_AND_RATIO',event:{actionType:record.candidate.candidateActionType,effectiveDate,listingDate,factor,parValueBefore:parBefore,parValueAfter:parAfter,commonSharesBefore:sharesBefore,commonSharesAfter:sharesAfter}};
}

function numericRatio(v) {
  if (typeof v!=='string') return null;
  const m=v.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
  return m?{left:Number(m[1]),right:Number(m[2]),text:`${m[1]}:${m[2]}`}:null;
}

function parseMerger(record,nodes) {
  if (record.document?.status!=='DOCUMENT_ZIP_RECEIVED') return {status:'UNRESOLVED',reason:'MERGER_DOCUMENT_UNAVAILABLE'};
  const sr=structuredRow(record);
  const main=findIndex(nodes,/^회사합병 결정$/);
  const start=main>=0?main:0;
  let ratio=null,effectiveDate=null,listingDate=null,source='document.xml';
  if (sr) {
    ratio=numericRatio(sr.mg_rt);
    effectiveDate=parseDate(sr.mgsc_mgdt);
    listingDate=parseDate(sr.mgsc_nstklstprd);
    source='structured+document';
  }
  ratio ||= numericRatio(firstAfter(nodes,/^4\.\s*합병비율$/,{start,maxLookahead:5}));
  effectiveDate ||= dateAfter(nodes,/^합병기일$/,{start,maxLookahead:4});
  listingDate ||= dateAfter(nodes,/^신주의 상장예정일$/,{start,maxLookahead:4}) || dateAfter(nodes,/^합병신주 상장 예정일$/,{start,maxLookahead:4});
  if (!ratio || !effectiveDate) return {status:'UNRESOLVED',reason:'MERGER_REQUIRED_FIELD_MISSING'};
  return {status:'VALIDATED',reason:'EXPLICIT_MERGER_DATE_AND_RATIO',event:{actionType:'MERGER',effectiveDate,listingDate,ratio,detailSource:source}};
}

function parseSpinOff(record,nodes) {
  if (hasFlag(record,'OTHER_ENTITY_SCOPE')) return {status:'REJECTED',reason:'OTHER_ENTITY_SCOPE'};
  if (hasFlag(record,'WITHDRAWAL_MUST_LINK_ORIGINAL')) return {status:'UNRESOLVED',reason:'WITHDRAWAL_REQUIRES_ORIGINAL_LINK'};
  const sr=structuredRow(record);
  const main=findIndex(nodes,/^회사분할 결정$/);
  const start=main>=0?main:0;
  let ratio=null,capitalReductionPercent=null,recordDate=null,effectiveDate=null,listingDate=null,source='document.xml';
  if (sr) {
    const dvNums=typeof sr.dv_rt==='string'?[...sr.dv_rt.matchAll(/0\.\d+/g)].map(m=>Number(m[0])):[];
    ratio=dvNums.length?dvNums[dvNums.length-1]:null;
    capitalReductionPercent=parseNumber(sr.abcr_crrt);
    recordDate=parseDate(sr.abcr_nstkasstd);
    effectiveDate=parseDate(sr.dvdt);
    listingDate=parseDate(sr.abcr_nstklstprd);
    source='structured+document';
  }
  if (ratio===null) {
    const ratioText=firstAfter(nodes,/^4\.\s*분할비율$/,{start,maxLookahead:4});
    const nums=ratioText ? [...ratioText.matchAll(/0\.\d+/g)].map(m=>Number(m[0])) : [];
    ratio=nums.length?nums[nums.length-1]:null;
  }
  recordDate ||= dateAfter(nodes,/^신주배정기준일$/,{start,maxLookahead:4});
  effectiveDate ||= dateAfter(nodes,/^분할기일$/,{start,maxLookahead:4});
  listingDate ||= dateAfter(nodes,/^신주의 상장예정일$/,{start,maxLookahead:4});
  if (ratio===null || !effectiveDate) return {status:'UNRESOLVED',reason:'SPIN_OFF_REQUIRED_FIELD_MISSING'};
  return {status:'VALIDATED',reason:'EXPLICIT_SPIN_OFF_DATE_AND_RATIO',event:{actionType:'SPIN_OFF',effectiveDate,recordDate,listingDate,newCompanySharesPerOldShare:ratio,capitalReductionPercent,detailSource:source}};
}

function parseRightsIssue(record,nodes) {
  if (hasFlag(record,'OTHER_ENTITY_SCOPE')) return {status:'REJECTED',reason:'OTHER_ENTITY_SCOPE'};
  if (hasFlag(record,'FOLLOWUP_NOTICE_NOT_NEW_EVENT')) return {status:'REJECTED',reason:'FOLLOWUP_NOTICE_NOT_NEW_EVENT'};
  const method=firstAfter(nodes,/^5\.\s*증자방식$/,{maxLookahead:3}) || firstAfter(nodes,/^2\.\s*발행방법$/,{maxLookahead:3});
  if (!method || !/주주배정/.test(method)) return {status:'REJECTED',reason:'NOT_SHAREHOLDER_RIGHTS_OFFERING'};
  const recordDate=dateAfter(nodes,/신주배정기준일/,{maxLookahead:5});
  const paymentDate=dateAfter(nodes,/납입일/,{maxLookahead:5});
  if (!recordDate) return {status:'UNRESOLVED',reason:'RIGHTS_ISSUE_RECORD_DATE_MISSING'};
  return {status:'PARSED_NEEDS_EFFECTIVE_DATE',reason:'EX_RIGHTS_DATE_NOT_PROVEN_BY_SOURCE',event:{actionType:'RIGHTS_ISSUE',recordDate,paymentDate,method}};
}

function parseRecord(record) {
  const candidate=record.candidate;
  if (!candidate || !TYPES.has(candidate.candidateActionType)) throw new Error('INVALID_CANDIDATE_TYPE');
  if (candidate.candidateActionType==='MERGER' && record.document?.status!=='DOCUMENT_ZIP_RECEIVED') {
    return {parseStatus:'UNRESOLVED',reason:'MERGER_DOCUMENT_UNAVAILABLE',xml:null,event:null};
  }
  if (record.document?.status!=='DOCUMENT_ZIP_RECEIVED') {
    return {parseStatus:'UNRESOLVED',reason:'DOCUMENT_UNAVAILABLE',xml:null,event:null};
  }
  const extracted=extractXml(record.document), nodes=xmlTextNodes(extracted.text);
  let result;
  switch(candidate.candidateActionType) {
    case 'CASH_DIVIDEND': result=parseCashDividend(record,nodes); break;
    case 'STOCK_DIVIDEND': result=parseStockDividend(record,nodes); break;
    case 'STOCK_SPLIT':
    case 'REVERSE_SPLIT': result=parseSplit(record,nodes); break;
    case 'MERGER': result=parseMerger(record,nodes); break;
    case 'SPIN_OFF': result=parseSpinOff(record,nodes); break;
    case 'RIGHTS_ISSUE': result=parseRightsIssue(record,nodes); break;
    default: throw new Error('INVALID_CANDIDATE_TYPE');
  }
  return {
    parseStatus:result.status,
    reason:result.reason,
    xml:{validated:true,entryName:extracted.entryName,byteLength:extracted.byteLength,sha256:extracted.sha256,textNodeCount:nodes.length},
    event:result.event??null,
    correctionDocument:hasFlag(record,'CORRECTION_CHAIN_REQUIRED'),
    correctionChainResolved:false,
    eventInsertAllowed:false
  };
}

function validateInput(input) {
  if (!isObject(input) || input.version!==INPUT_VERSION || !Array.isArray(input.records) || !input.records.length) throw new Error('INVALID_V9_7_2_REPORT');
  if (input.scope!=='SAMPLE_ONLY_NOT_COVERAGE' || input.eventImportComplete!==false) throw new Error('UNEXPECTED_INPUT_SCOPE');
  for (const r of input.records) {
    if (!isObject(r) || !isObject(r.candidate) || !/^\d{14}$/.test(r.candidate.receiptNo??'') || !TYPES.has(r.candidate.candidateActionType)) throw new Error('INVALID_V9_7_2_RECORD');
  }
}

function parseProbe(input) {
  validateInput(input);
  let totalXml=0;
  const state={version:VERSION,inputVersion:input.version,sampleHash:input.sampleHash,inventoryRunId:input.inventoryRunId,
    sourceCoverageWindowId:input.sourceCoverageWindowId,scope:'SAMPLE_ONLY_NOT_COVERAGE',eventImportComplete:false,
    coveragePromoted:false,status:'RUNNING',records:[]};
  for (const record of input.records) {
    let parsed;
    try { parsed=parseRecord(record); }
    catch(error) { parsed={parseStatus:'ERROR',reason:safeError(error),xml:null,event:null,correctionDocument:hasFlag(record,'CORRECTION_CHAIN_REQUIRED'),correctionChainResolved:false,eventInsertAllowed:false}; }
    totalXml += parsed.xml?.byteLength||0;
    if (totalXml>MAX_TOTAL_XML_BYTES) throw new Error('TOTAL_XML_LIMIT');
    state.records.push({candidate:record.candidate,source:{documentStatus:record.document?.status??null,structuredStatus:record.structured?.status??null},...parsed});
    console.log(`${record.candidate.candidateActionType} ${record.candidate.receiptNo}: ${parsed.parseStatus} ${parsed.reason}`);
  }
  const c=s=>state.records.filter(r=>r.parseStatus===s).length;
  state.status=c('ERROR')?'HAS_ERRORS':'PARSE_PROBE_FINISHED';
  state.summary={samples:state.records.length,xmlValidated:state.records.filter(r=>r.xml?.validated).length,
    validatedEvents:c('VALIDATED'),parsedNeedsEffectiveDate:c('PARSED_NEEDS_EFFECTIVE_DATE'),rejectedCandidates:c('REJECTED'),
    unresolvedCandidates:c('UNRESOLVED'),errors:c('ERROR'),correctionDocuments:state.records.filter(r=>r.correctionDocument).length,
    correctionChainsResolved:0,eventRowsInserted:0,coveragePromoted:false};
  return state;
}

function main() {
  const root=path.resolve(__dirname,'..');
  const args=process.argv.slice(2);
  if (args.some(a=>!a.startsWith('--input=')&&!a.startsWith('--output='))) throw new Error('UNKNOWN_OPTION');
  const inputArg=args.find(a=>a.startsWith('--input='));
  const outputArg=args.find(a=>a.startsWith('--output='));
  const inputFile=inputArg?path.resolve(inputArg.slice(8)):path.join(root,'logs','corporate-action-detail-probe-v9-7-2.json');
  const outputFile=outputArg?path.resolve(outputArg.slice(9)):path.join(root,'logs','corporate-action-parse-probe-v9-7-3.json');
  const input=JSON.parse(fs.readFileSync(inputFile,'utf8').replace(/^\uFEFF/,''));
  const state=parseProbe(input); save(outputFile,state);
  console.log(JSON.stringify({status:state.status,...state.summary},null,2));
  console.log('Upload only this report (no .env files): '+outputFile);
  if (state.status==='HAS_ERRORS') process.exitCode=1;
}

module.exports={hash,safeError,crc32,findEocd,readZipEntries,extractXml,decodeEntities,xmlTextNodes,parseDate,parseNumber,parseRecord,parseProbe};
if(require.main===module){try{main();}catch(error){console.error(safeError(error));process.exitCode=1;}}
