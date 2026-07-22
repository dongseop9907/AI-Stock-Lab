import { createSupabaseServerClient } from "@/lib/supabase";

interface StockRecord {
  stock_code: string;
  stock_name: string;
  market: string;
  sector: string | null;
}

interface SnapshotRecord {
  stock_code: string;
  observed_at: string;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number | null;
  volume: number | null;
  raw_payload: unknown;
}

interface KisRawPayload {
  output?: {
    prdy_ctrt?: string;
  };
}

export interface StockMarketRow {
  stockCode: string;
  stockName: string;
  market: string;
  sector: string | null;
  observedAt: string | null;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  closePrice: number | null;
  volume: number | null;
  changeRate: number | null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(String(value).replaceAll(",", ""));

  return Number.isFinite(parsed) ? parsed : null;
}

function getChangeRate(rawPayload: unknown): number | null {
  if (!rawPayload || typeof rawPayload !== "object") {
    return null;
  }

  const payload = rawPayload as KisRawPayload;

  return toNullableNumber(payload.output?.prdy_ctrt);
}

export async function getLatestStockMarketRows(): Promise<StockMarketRow[]> {
  const supabase = createSupabaseServerClient();

  const { data: stocks, error: stockError } = await supabase
    .from("stocks")
    .select("stock_code, stock_name, market, sector")
    .eq("is_active", true)
    .order("stock_code", { ascending: true });

  if (stockError) {
    throw new Error(`종목 조회 실패: ${stockError.message}`);
  }

  const { data: snapshots, error: snapshotError } = await supabase
    .from("market_snapshots")
    .select(
      `
        stock_code,
        observed_at,
        open_price,
        high_price,
        low_price,
        close_price,
        volume,
        raw_payload
      `,
    )
    .order("observed_at", { ascending: false })
    .limit(5000);

  if (snapshotError) {
    throw new Error(`시세 조회 실패: ${snapshotError.message}`);
  }

  const latestSnapshotByStock = new Map<string, SnapshotRecord>();

  for (const snapshot of (snapshots ?? []) as SnapshotRecord[]) {
    if (!latestSnapshotByStock.has(snapshot.stock_code)) {
      latestSnapshotByStock.set(snapshot.stock_code, snapshot);
    }
  }

  return ((stocks ?? []) as StockRecord[]).map((stock) => {
    const snapshot = latestSnapshotByStock.get(stock.stock_code);

    return {
      stockCode: stock.stock_code,
      stockName: stock.stock_name,
      market: stock.market,
      sector: stock.sector,
      observedAt: snapshot?.observed_at ?? null,
      openPrice: snapshot?.open_price ?? null,
      highPrice: snapshot?.high_price ?? null,
      lowPrice: snapshot?.low_price ?? null,
      closePrice: snapshot?.close_price ?? null,
      volume: snapshot?.volume ?? null,
      changeRate: getChangeRate(snapshot?.raw_payload),
    };
  });
}