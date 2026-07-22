const DART_BASE_URL = "https://opendart.fss.or.kr/api";

export interface DartDisclosureQuery {
  corpCode?: string;
  beginDate: string;
  endDate: string;
  pageCount?: number;
}

export async function listDartDisclosures(query: DartDisclosureQuery) {
  const apiKey = process.env.OPENDART_API_KEY;
  if (!apiKey) throw new Error("OPENDART_API_KEY is missing.");

  const params = new URLSearchParams({
    crtfc_key: apiKey,
    bgn_de: query.beginDate,
    end_de: query.endDate,
    page_count: String(query.pageCount ?? 100),
  });

  if (query.corpCode) params.set("corp_code", query.corpCode);

  const response = await fetch(`${DART_BASE_URL}/list.json?${params}`, {
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`OpenDART request failed: ${response.status}`);
  return response.json();
}
