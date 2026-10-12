import { createSupabaseServerClient } from "@/lib/supabase";

export interface StockRow {
  stock_code: string;
  stock_name: string;
  market: string;
  sector: string | null;
  is_active: boolean;
}

export async function getActiveStocks(): Promise<StockRow[]> {
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("stocks")
    .select("stock_code, stock_name, market, sector, is_active")
    .eq("is_active", true)
    .order("market", { ascending: true })
    .order("stock_code", { ascending: true });

  if (error) {
    throw new Error(`종목 조회 실패: ${error.message}`);
  }

  return data ?? [];
}