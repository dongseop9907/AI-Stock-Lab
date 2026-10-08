import { createHash } from "node:crypto";

export const ACTION_TYPES = ["STOCK_SPLIT", "REVERSE_SPLIT", "CASH_DIVIDEND", "STOCK_DIVIDEND", "RIGHTS_ISSUE", "SPIN_OFF", "MERGER"] as const;
export type Cursor = { chunk_start: string; chunk_end: string; corp_cls: "Y" | "K"; next_page: number };
export type Disclosure = Record<string, unknown> & { rcept_no: string; rcept_dt: string; corp_cls: string; corp_code: string; report_nm: string };

export function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_DATE");
  const parsed = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("INVALID_DATE");
  return value;
}
export function addDays(value: string, days: number) {
  const d = new Date(date(value) + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("INVALID_RUN_ID");
  return value;
}
export function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

// Candidate hints ONLY. A title cannot prove an executed action, its effective date,
// ratio, cancellation status or completeness. Preserve all rows, not just matches.
export function classifyTitle(title: string): string[] {
  const s = title.replace(/\s/g, "");
  const types: string[] = [];
  if (/주식분할/.test(s)) types.push("STOCK_SPLIT");
  if (/주식병합/.test(s)) types.push("REVERSE_SPLIT");
  if (/현금.*배당/.test(s)) types.push("CASH_DIVIDEND");
  if (/주식배당/.test(s)) types.push("STOCK_DIVIDEND");
  if (/유상증자|유무상증자/.test(s)) types.push("RIGHTS_ISSUE");
  if (/회사분할/.test(s)) types.push("SPIN_OFF");
  if (/회사합병|회사분할합병/.test(s)) types.push("MERGER");
  return types;
}
function integer(value: unknown): number {
  if (!(typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)))) throw new Error("DART_INVALID_PAGINATION");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("DART_INVALID_PAGINATION");
  return n;
}
export function validatePage(body: unknown, cursor: Cursor) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("DART_INVALID_RESPONSE");
  const b = body as Record<string, unknown>;
  if (b.status === "013") {
    // No data on page 2+ is a truncated/changed result, never a successful empty segment.
    if (cursor.next_page !== 1 || (b.list !== undefined && (!Array.isArray(b.list) || b.list.length !== 0)) ||
        (b.total_count !== undefined && integer(b.total_count) !== 0) ||
        (b.total_page !== undefined && integer(b.total_page) !== 0)) throw new Error("DART_UNEXPECTED_EMPTY_PAGE");
    return { totalCount: 0, totalPages: 0, rows: [] as Disclosure[], candidates: [] as Record<string, unknown>[] };
  }
  if (b.status !== "000") {
    const code = typeof b.status === "string" && /^\d{3}$/.test(b.status) ? b.status : "INVALID";
    throw new Error(`DART_STATUS_${code}`); // Do not echo provider text or a URL containing credentials.
  }
  const totalCount = integer(b.total_count), totalPages = integer(b.total_page);
  if (integer(b.page_no) !== cursor.next_page || integer(b.page_count) !== 100 ||
      totalCount < 1 || totalPages !== Math.ceil(totalCount / 100) || cursor.next_page > totalPages || !Array.isArray(b.list)) throw new Error("DART_INVALID_PAGINATION");
  const expected = Math.min(100, totalCount - (cursor.next_page - 1) * 100);
  if (b.list.length !== expected) throw new Error("DART_PAGE_ROW_COUNT_MISMATCH");
  const ids = new Set<string>();
  const rows = b.list.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("DART_INVALID_ROW");
    const r = item as Disclosure;
    if (typeof r.rcept_no !== "string" || !/^\d{14}$/.test(r.rcept_no) ||
        typeof r.corp_code !== "string" || !/^\d{8}$/.test(r.corp_code) ||
        typeof r.report_nm !== "string" || !r.report_nm.trim() || r.corp_cls !== cursor.corp_cls ||
        typeof r.rcept_dt !== "string" || !/^\d{8}$/.test(r.rcept_dt)) throw new Error("DART_INVALID_ROW");
    const receiptDate = date(`${r.rcept_dt.slice(0, 4)}-${r.rcept_dt.slice(4, 6)}-${r.rcept_dt.slice(6, 8)}`);
    if (receiptDate < cursor.chunk_start || receiptDate > cursor.chunk_end) throw new Error("DART_ROW_OUTSIDE_REQUEST");
    if (ids.has(r.rcept_no)) throw new Error("DART_DUPLICATE_RECEIPT");
    ids.add(r.rcept_no);
    return r;
  });
  const candidates = rows.flatMap(r => classifyTitle(r.report_nm).map(actionType => ({
    receiptNo: r.rcept_no, corpCode: r.corp_code, stockCode: r.stock_code ?? null,
    reportName: r.report_nm, receiptDate: r.rcept_dt, candidateActionType: actionType,
    needsDetailReview: true, correctionOrWithdrawalHint: /정정|철회/.test(r.report_nm + String(r.rm ?? "")),
  })));
  return { totalCount, totalPages, rows, candidates };
}
export async function fetchPage(cursor: Cursor, apiKey: string, fetcher: typeof fetch = fetch) {
  const url = new URL("https://opendart.fss.or.kr/api/list.json");
  url.search = new URLSearchParams({ crtfc_key: apiKey, bgn_de: cursor.chunk_start.replaceAll("-", ""),
    end_de: cursor.chunk_end.replaceAll("-", ""), corp_cls: cursor.corp_cls, last_reprt_at: "N",
    sort: "date", sort_mth: "asc", page_no: String(cursor.next_page), page_count: "100" }).toString();
  let response: Response;
  try { response = await fetcher(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45000) }); }
  catch { throw new Error("DART_NETWORK_FAILURE"); }
  if (!response.ok) throw new Error(`DART_HTTP_${response.status}`);
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new Error("DART_INVALID_JSON"); }
  return { ...validatePage(raw, cursor), raw, responseHash: fingerprint(raw) };
}
