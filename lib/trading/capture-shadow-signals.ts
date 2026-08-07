import { createSupabaseServerClient } from "@/lib/supabase";

interface CaptureShadowSignalsInput {
  lookbackHours?: number;
  limit?: number;
}

interface EntrySignalRecord {
  id: string;
  model_id: string | null;
  stock_code: string;
  observed_at: string;
  status: string;
  score: number | string | null;
  recommended_entry_price:
    | number
    | string
    | null;
  error_message: string | null;
}

export interface CaptureShadowSignalsResult {
  analyzed: number;
  captured: number;
  skipped: number;
  signalIds: string[];
}

function toNumber(
  value: unknown,
): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

export async function captureShadowSignals(
  input: CaptureShadowSignalsInput = {},
): Promise<CaptureShadowSignalsResult> {
  const supabase =
    createSupabaseServerClient();

  const lookbackHours =
    Math.min(
      168,
      Math.max(
        1,
        Math.floor(
          input.lookbackHours ?? 48,
        ),
      ),
    );

  const limit =
    Math.min(
      2000,
      Math.max(
        1,
        Math.floor(
          input.limit ?? 500,
        ),
      ),
    );

  const since =
    new Date(
      Date.now() -
        lookbackHours *
          60 *
          60 *
          1000,
    ).toISOString();

  const {
    data,
    error,
  } = await supabase
    .from("ai_entry_signals")
    .select(`
      id,
      model_id,
      stock_code,
      observed_at,
      status,
      score,
      recommended_entry_price,
      error_message
    `)
    .gte("observed_at", since)
    .is("error_message", null)
    .order("observed_at", {
      ascending: false,
    })
    .limit(limit);

  if (error) {
    throw new Error(
      `진입 신호 조회 실패: ${error.message}`,
    );
  }

  const signals =
    (data ??
      []) as EntrySignalRecord[];

  const rows: Array<
    Record<string, unknown>
  > = [];

  let skipped = 0;

  for (const signal of signals) {
    const referencePrice =
      toNumber(
        signal.recommended_entry_price,
      );

    if (
      !signal.id ||
      !signal.stock_code ||
      !signal.observed_at ||
      !referencePrice ||
      referencePrice <= 0
    ) {
      skipped += 1;
      continue;
    }

    rows.push({
      signal_id:
        signal.id,

      model_id:
        signal.model_id,

      stock_code:
        signal.stock_code,

      signal_status:
        signal.status,

      signal_score:
        toNumber(
          signal.score,
        ),

      signal_observed_at:
        signal.observed_at,

      reference_price:
        referencePrice,

      updated_at:
        new Date().toISOString(),
    });
  }

  if (rows.length === 0) {
    return {
      analyzed:
        signals.length,

      captured: 0,
      skipped,

      signalIds: [],
    };
  }

  const {
    data: savedData,
    error: saveError,
  } = await supabase
    .from(
      "shadow_signal_tracks",
    )
    .upsert(
      rows,
      {
        onConflict:
          "signal_id",

        ignoreDuplicates:
          false,
      },
    )
    .select("signal_id");

  if (saveError) {
    throw new Error(
      `그림자 신호 저장 실패: ${saveError.message}`,
    );
  }

  return {
    analyzed:
      signals.length,

    captured:
      savedData?.length ??
      rows.length,

    skipped,

    signalIds:
      (
        savedData ?? []
      ).map(
        (row) =>
          String(
            row.signal_id,
          ),
      ),
  };
}