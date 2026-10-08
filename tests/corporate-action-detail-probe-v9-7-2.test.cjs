const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const p=require('../scripts/collect-corporate-action-details-v9-7-2.cjs');
const sample={corpCode:'00123456',receiptNo:'20260731000001',receiptDate:'20260731',stockCode:'0001A0',reportName:'[기재정정]주요사항보고서(회사합병결정)',candidateActionType:'MERGER'};
const zip=Buffer.from(fs.readFileSync(path.join(__dirname,'document-fixture-base64.txt'),'utf8'),'base64');
const json=b=>Buffer.from(JSON.stringify(b));
function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'stock-detail-test-'));}
function config(){return {inventoryRunId:'test',sourceCoverageWindowId:'test',samples:[sample]};}

test('alphanumeric stock codes and leading zeros are preserved',()=>assert.equal(p.validSample(sample).stockCode,'0001A0'));
test('invalid receipt/corp/date/type blocked',()=>{
 for(const s of [{...sample,receiptNo:'../../file'},{...sample,corpCode:'123'},{...sample,receiptDate:'20260230'},{...sample,candidateActionType:'OTHER'}])assert.throws(()=>p.validSample(s));
});
test('titles identify scope, withdrawal and followup without event inference',()=>{
 assert.ok(p.flags({...sample,reportName:'회사분할결정 철회(종속회사의주요경영사항)'}).includes('OTHER_ENTITY_SCOPE'));
 assert.ok(p.flags({...sample,reportName:'회사분할결정 철회'}).includes('WITHDRAWAL_MUST_LINK_ORIGINAL'));
 assert.ok(p.flags({...sample,reportName:'증권발행결과(제3자배정 유상증자)'}).includes('ALLOCATION_METHOD_NOT_PROVEN_RIGHTS_ISSUE'));
 assert.ok(p.flags({...sample,reportName:'주권매매거래정지(주식분할)'}).includes('FOLLOWUP_NOTICE_NOT_NEW_EVENT'));
 assert.ok(p.flags(sample).includes('NO_EVENT_INSERT'));
});
test('endpoints do not map annual dividend totals to event data',()=>{
 assert.equal(p.structuredEndpoint({...sample,candidateActionType:'CASH_DIVIDEND'}),null);
 assert.equal(p.structuredEndpoint({...sample,reportName:'회사분할합병결정'}),'cmpDvmgDecsn.json');
 assert.equal(p.structuredEndpoint({...sample,candidateActionType:'RIGHTS_ISSUE',reportName:'유무상증자결정'}),'pifricDecsn.json');
});
test('actual ZIP fixture accepted but truncated/magic-only responses rejected',()=>{
 assert.equal(p.classifyDocument(zip).status,'DOCUMENT_ZIP_RECEIVED');
 assert.equal(p.classifyDocument(zip).xmlValidated,false);
 assert.throws(()=>p.classifyDocument(zip.subarray(0,30)));
 assert.throws(()=>p.classifyDocument(Buffer.from('PK\x03\x04garbage')));
});
test('missing document is unavailable, never no-action proof',()=>{
 for(const code of ['013','014']){
  const r=p.classifyDocument(Buffer.from(`<result><status>${code}</status><message>secret</message></result>`));
  assert.equal(r.provesNoEvent,false);assert.equal(r.providerStatus,code);assert.ok(!JSON.stringify(r).includes('secret'));
 }
});
test('quota error and key-bearing message are sanitized',()=>{
 assert.throws(()=>p.classifyDocument(Buffer.from('<status>020</status><message>secret</message>')),{message:'DART_STATUS_020'});
 assert.equal(p.safeError(new Error('https://host/?crtfc_key=secret')),'REQUEST_FAILED');
});
test('structured data must match exact receipt and corporation',()=>{
 const r={rcept_no:sample.receiptNo,corp_code:sample.corpCode,mg_rt:'1:0.5'};
 assert.equal(p.classifyStructured(json({status:'000',list:[r]}),sample,'TEST_KEY').status,'EXACT_RECEIPT_MATCH');
 assert.equal(p.classifyStructured(json({status:'000',list:[{...r,rcept_no:'20250731000001'}]}),sample,'TEST_KEY').status,'NO_EXACT_RECEIPT_MATCH');
 assert.throws(()=>p.classifyStructured(json({status:'000',list:[{...r,corp_code:'99999999'}]}),sample,'TEST_KEY'),/IDENTITY/);
});
test('a successful response containing a secret is not saved',()=>{
 assert.throws(()=>p.classifyStructured(json({status:'000',list:[{rcept_no:sample.receiptNo,corp_code:sample.corpCode,text:'SECRET_VALUE'}]}),sample,'SECRET_VALUE'),/SECRET_IN/);
});
test('hash tampering invalidates resume cache',()=>{
 const r=p.classifyDocument(zip);assert.equal(p.reusable(r),true);r.rawBase64=Buffer.from('bad').toString('base64');assert.equal(p.reusable(r),false);
});
test('env parser handles BOM, quotes, comments, environment precedence',()=>{
 const dir=temp();try{
  fs.writeFileSync(path.join(dir,'.env.local'),'\uFEFF DART_API_KEY = "file-value" # comment\n');
  assert.equal(p.readKey(dir,{}),'file-value');
  assert.equal(p.readKey(dir,{DART_API_KEY:'env-value'}),'env-value');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('network failures do not expose credential URL',async()=>{
 await assert.rejects(p.requestBytes('document.xml',{},'secret',async()=>{throw new Error('https://host?crtfc_key=secret');}),{message:'REQUEST_FAILED'});
 await assert.rejects(p.requestBytes('outside.json',{},'secret'),/INVALID_ENDPOINT/);
});
test('response byte limit enforced',async()=>{
 await assert.rejects(p.requestBytes('document.xml',{},'secret',async()=>new Response('x',{headers:{'content-length':'999999999'}})),/RESPONSE_TOO_LARGE/);
});
test('collection resumes from cache and never persists the key',async()=>{
 const dir=temp(),output=path.join(dir,'report.json');let calls=0;
 const fake=async u=>{calls++;const url=new URL(u);assert.equal(url.hostname,'opendart.fss.or.kr');
  if(url.pathname.endsWith('document.xml'))return new Response(zip);
  assert.equal(url.searchParams.get('bgn_de'),'20150101');
  return Response.json({status:'000',list:[{rcept_no:sample.receiptNo,corp_code:sample.corpCode,mgsc_mgdt:'2026-09-01'}]});
 };
 try{
  const a=await p.collect(config(),output,'SECRET_VALUE',{fetcher:fake,delay:0});
  assert.equal(a.summary.eventRowsInserted,0);assert.equal(a.summary.structuredExactMatches,1);assert.equal(calls,2);
  await p.collect(config(),output,'SECRET_VALUE',{fetcher:fake,delay:0});assert.equal(calls,2);
  assert.ok(!fs.readFileSync(output,'utf8').includes('SECRET_VALUE'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('quota stops immediately, saved failure can retry',async()=>{
 const dir=temp(),output=path.join(dir,'report.json');let calls=0;
 try{
  await assert.rejects(p.collect(config(),output,'SECRET',{delay:0,fetcher:async()=>{calls++;return new Response('<status>020</status><message>SECRET</message>');}}),/DART_STATUS_020/);
  assert.equal(calls,1);const state=JSON.parse(fs.readFileSync(output,'utf8'));assert.equal(state.status,'STOPPED');
  assert.ok(!JSON.stringify(state).includes('SECRET'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('missing documents and structured no-data complete probe without promoting coverage',async()=>{
 const dir=temp(),output=path.join(dir,'report.json');try{
  const r=await p.collect(config(),output,'SECRET',{delay:0,fetcher:async u=>String(u).includes('document.xml')?new Response('<status>014</status>'):Response.json({status:'013'})});
  assert.equal(r.status,'PROBE_FINISHED');assert.equal(r.summary.documentUnavailable,1);assert.equal(r.summary.coveragePromoted,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
