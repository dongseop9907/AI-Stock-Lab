import { createSupabaseServerClient } from "@/lib/supabase";

function clampThreshold(
  value: number,
): number {
  return Math.min(
    0.9,
    Math.max(
      0.1,
      value,
    ),
  );
}

export async function getActiveEntryThreshold(): Promise<number> {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } = await supabase
    .from(
      "entry_signal_settings",
    )
    .select(`
      active_threshold
    `)
    .eq(
      "setting_key",
      "global",
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `활성 진입 기준점수 조회 실패: ${error.message}`,
    );
  }

  const databaseThreshold =
    Number(
      data?.active_threshold,
    );

  if (
    Number.isFinite(
      databaseThreshold,
    )
  ) {
    return clampThreshold(
      databaseThreshold,
    );
  }

  const environmentThreshold =
    Number(
      process.env
        .ENTRY_SIGNAL_THRESHOLD ??
        0.62,
    );

  return Number.isFinite(
    environmentThreshold,
  )
    ? clampThreshold(
        environmentThreshold,
      )
    : 0.62;
}