import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, classifyTitle, date, fetchPage, validatePage, type Cursor } from "../lib/market/opendart-source-core-v9-7-1";

const cursor: Cursor = { chunk_start: "2024-01-01", chunk_end: "2024-01-30", corp_cls: "Y", next_page: 1 };
const row = (i = 1) => ({ rcept_no: String(20240101000000 + i), corp_code: "00123456", corp_cls: "Y", rcept_dt: "20240102", report_nm: "[기재정정]주식분할결정", stock_code: "005930" });
const body = (rows = [row()], count = rows.length, page = 1) => ({ status: "000", page_no: page, page_count: 100, total_count: count, total_page: Math.ceil(count / 100), list: rows });

test("calendar dates reject impossible dates", () => {
  for (const value of ["2023-02-29", "2024-02-30", "2024-13-01", "2024-1-01", null]) assert.throws(() => date(value));
  assert.equal(date("2024-02-29"), "2024-02-29");
  assert.equal(addDays("2024-02-28", 2), "2024-03-01");
});
test("all seven requested types have candidate hints, never event fields", () => {
  const titles = ["주식분할결정", "주식병합결정", "현금ㆍ현물배당결정", "주식배당결정", "유무상증자결정", "회사분할결정", "회사합병결정"];
  assert.equal(new Set(titles.flatMap(classifyTitle)).size, 7);
  assert.deepEqual(classifyTitle("회사분할합병결정"), ["SPIN_OFF", "MERGER"]);
  assert.deepEqual(classifyTitle("사업보고서"), []);
  const candidate = validatePage(body(), cursor).candidates[0];
  assert.equal(candidate.needsDetailReview, true);
  assert.equal(candidate.correctionOrWithdrawalHint, true);
  assert.equal("effectiveDate" in candidate, false);
});
test("empty first page is valid list evidence only", () => {
  assert.equal(validatePage({ status: "013" }, cursor).rows.length, 0);
});
test("empty later page is blocked", () => {
  assert.throws(() => validatePage({ status: "013" }, { ...cursor, next_page: 2 }), /UNEXPECTED_EMPTY/);
});
test("contradictory no-data response blocked", () => {
  assert.throws(() => validatePage({ status: "013", total_count: 1 }, cursor));
  assert.throws(() => validatePage({ status: "013", list: [row()] }, cursor));
});
test("missing page rows blocked", () => assert.throws(() => validatePage(body([row()], 101), cursor), /ROW_COUNT/));
test("wrong page number blocked", () => assert.throws(() => validatePage(body([row()], 1, 2), cursor), /PAGINATION/));
test("wrong page size blocked", () => assert.throws(() => validatePage({ ...body(), page_count: 10 }, cursor), /PAGINATION/));
test("inconsistent total pages blocked", () => assert.throws(() => validatePage({ ...body(), total_page: 2 }, cursor), /PAGINATION/));
test("duplicate receipts blocked", () => assert.throws(() => validatePage(body([row(), row()]), cursor), /DUPLICATE/));
test("market mismatch blocked", () => assert.throws(() => validatePage(body([{ ...row(), corp_cls: "K" }]), cursor), /INVALID_ROW/));
test("out of range disclosure blocked", () => assert.throws(() => validatePage(body([{ ...row(), rcept_dt: "20231231" }]), cursor), /OUTSIDE_REQUEST/));
test("all rows retained even when title is unclassified", () => {
  const result = validatePage(body([{ ...row(), report_nm: "사업보고서" }]), cursor);
  assert.equal(result.rows.length, 1); assert.equal(result.candidates.length, 0);
});
test("last page can contain fewer than 100 rows", () => {
  assert.equal(validatePage(body([row()], 101, 2), { ...cursor, next_page: 2 }).rows.length, 1);
});
test("quota and auth failures are errors, not empty success", () => {
  for (const code of ["010", "012", "020", "800", "900"]) assert.throws(() => validatePage({ status: code }, cursor), new RegExp(code));
});
test("provider errors cannot leak message containing key", () => {
  assert.throws(() => validatePage({ status: "020", message: "secret-key" }, cursor), { message: "DART_STATUS_020" });
});
test("request uses bounded receipt window and preserves corrections", async () => {
  const fake = (async (input: URL | RequestInfo) => {
    const u = new URL(String(input));
    assert.equal(u.hostname, "opendart.fss.or.kr");
    assert.equal(u.searchParams.get("last_reprt_at"), "N");
    assert.equal(u.searchParams.get("page_count"), "100");
    assert.equal(u.searchParams.get("bgn_de"), "20240101");
    return Response.json(body());
  }) as typeof fetch;
  const result = await fetchPage(cursor, "TEST_ONLY", fake);
  assert.match(result.responseHash, /^[0-9a-f]{64}$/);
});
test("transport exceptions do not echo credential URLs", async () => {
  const fake = (async () => { throw new Error("https://host/?crtfc_key=secret"); }) as typeof fetch;
  await assert.rejects(fetchPage(cursor, "TEST_ONLY", fake), { message: "DART_NETWORK_FAILURE" });
});
test("HTTP and invalid JSON fail closed", async () => {
  await assert.rejects(fetchPage(cursor, "TEST_ONLY", (async () => new Response("x", { status: 429 })) as typeof fetch), /DART_HTTP_429/);
  await assert.rejects(fetchPage(cursor, "TEST_ONLY", (async () => new Response("x")) as typeof fetch), /DART_INVALID_JSON/);
});
