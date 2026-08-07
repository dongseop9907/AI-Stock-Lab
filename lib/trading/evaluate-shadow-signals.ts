import { createSupabaseServerClient } from "@/lib/supabase";

interface EvaluateShadowSignalsInput {
  limit?: number;
}

interface ShadowTrackRecord {
  id: string;
  signal_id: string;
  stock_code: string;
  signal_status: string;

  signal_observed_at: string;

  reference_price:
    | number
    | string;

  price_30m:
    | number
    | string
    | null;

  observed_30m_at:
    | string
    | null;

  return_30m:
    | number
    | string
    | null;

  price_60m:
    | number
    | string
    | null;

  observed_60m_at:
    | string
    | null;

  return_60m:
    | number
    | string
    | null;

  close_price:
    | number
    | string
    | null;

  close_observed_at:
    | string
    | null;

  close_return:
    | number
    | string
    | null;

  evaluation_status: string;
}

interface MarketSnapshotRecord {
  id: number | string;
  observed_at: string;

  open_price:
    | number
    | string
    | null;

  high_price:
    | number
    | string
    | null;

  low_price:
    | number
    | string
    | null;

  close_price:
    | number
    | string
    | null;

  raw_payload: unknown;
}

export interface EvaluateShadowSignalsResult {
  analyzed: number;
  completed: number;
  partial: number;
  expired: number;
  invalid: number;
  unchanged: number;
}

function toNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function calculateReturn(
  price: number,
  referencePrice: number,
): number {
  return (
    price /
      referencePrice -
    1
  );
}

function getRawSource(
  value: unknown,
): string {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return "";
  }

  const source =
    (
      value as Record<
        string,
        unknown
      >
    ).source;

  return typeof source ===
    "string"
    ? source
    : "";
}

function isTestSnapshot(
  snapshot: MarketSnapshotRecord,
): boolean {
  const source =
    getRawSource(
      snapshot.raw_payload,
    ).toUpperCase();

  return (
    source.includes("TEST") ||
    source.includes("MOCK") ||
    source.includes("DUMMY")
  );
}

function getKoreaTradingWindow(
  value: string,
) {
  const signalDate =
    new Date(value);

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Seoul",

        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(signalDate);

  const values =
    Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ]),
    );

  const year =
    Number(values.year);

  const month =
    Number(values.month);

  const day =
    Number(values.day);

  const koreaOffsetMs =
    9 *
    60 *
    60 *
    1000;

  const marketOpen =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        9,
        0,
        0,
      ) -
        koreaOffsetMs,
    );

  const marketClose =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
        15,
        30,
        0,
      ) -
        koreaOffsetMs,
    );

  const expirationTime =
    new Date(
      marketClose.getTime() +
        18 *
          60 *
          60 *
          1000,
    );

  return {
    marketOpen,
    marketClose,
    expirationTime,
  };
}

function findFirstSnapshotAtOrAfter(
  snapshots: MarketSnapshotRecord[],
  targetTime: number,
): MarketSnapshotRecord | null {
  for (const snapshot of snapshots) {
    const observedTime =
      new Date(
        snapshot.observed_at,
      ).getTime();

    if (
      Number.isFinite(
        observedTime,
      ) &&
      observedTime >=
        targetTime
    ) {
      return snapshot;
    }
  }

  return null;
}

function getSnapshotPrice(
  snapshot:
    | MarketSnapshotRecord
    | null,
): number | null {
  if (!snapshot) {
    return null;
  }

  return toNumber(
    snapshot.close_price,
  );
}

function getDecisionLabel(
  signalStatus: string,
  evaluationStatus: string,
  closeReturn: number | null,
  maxReturn: number | null,
  minReturn: number | null,
):
  | "UNKNOWN"
  | "GOOD_SKIP"
  | "BAD_SKIP"
  | "GOOD_ENTRY"
  | "BAD_ENTRY" {
  if (
    evaluationStatus !==
    "COMPLETE"
  ) {
    return "UNKNOWN";
  }

  const normalizedStatus =
    signalStatus.toUpperCase();

  const wasSkipped =
    normalizedStatus ===
      "SKIPPED" ||
    normalizedStatus ===
      "REJECTED";

  const meaningfulRise =
    (
      closeReturn !== null &&
      closeReturn >= 0.01
    ) ||
    (
      maxReturn !== null &&
      maxReturn >= 0.02
    );

  const meaningfulFall =
    (
      closeReturn !== null &&
      closeReturn < 0
    ) ||
    (
      minReturn !== null &&
      minReturn <= -0.015
    );

  if (wasSkipped) {
    if (meaningfulRise) {
      return "BAD_SKIP";
    }

    if (
      meaningfulFall ||
      closeReturn !== null
    ) {
      return "GOOD_SKIP";
    }

    return "UNKNOWN";
  }

  if (meaningfulRise) {
    return "GOOD_ENTRY";
  }

  if (meaningfulFall) {
    return "BAD_ENTRY";
  }

  return "UNKNOWN";
}

export async function evaluateShadowSignals(
  input: EvaluateShadowSignalsInput = {},
): Promise<EvaluateShadowSignalsResult> {
  const supabase =
    createSupabaseServerClient();

  const limit =
    Math.min(
      1000,
      Math.max(
        1,
        Math.floor(
          input.limit ?? 300,
        ),
      ),
    );

  const {
    data,
    error,
  } = await supabase
    .from(
      "shadow_signal_tracks",
    )
    .select(`
      id,
      signal_id,
      stock_code,
      signal_status,
      signal_observed_at,
      reference_price,
      price_30m,
      observed_30m_at,
      return_30m,
      price_60m,
      observed_60m_at,
      return_60m,
      close_price,
      close_observed_at,
      close_return,
      evaluation_status
    `)
    .in(
      "evaluation_status",
      [
        "PENDING",
        "PARTIAL",
      ],
    )
    .order(
      "signal_observed_at",
      {
        ascending: true,
      },
    )
    .limit(limit);

  if (error) {
    throw new Error(
      `그림자 추적 대상 조회 실패: ${error.message}`,
    );
  }

  const tracks =
    (data ??
      []) as ShadowTrackRecord[];

  const now =
    new Date();

  let completed = 0;
  let partial = 0;
  let expired = 0;
  let invalid = 0;
  let unchanged = 0;

  for (const track of tracks) {
    const referencePrice =
      toNumber(
        track.reference_price,
      );

    const signalTime =
      new Date(
        track.signal_observed_at,
      );

    if (
      !referencePrice ||
      referencePrice <= 0 ||
      Number.isNaN(
        signalTime.getTime(),
      )
    ) {
      await supabase
        .from(
          "shadow_signal_tracks",
        )
        .update({
          evaluation_status:
            "INVALID",

          decision_label:
            "UNKNOWN",

          last_evaluated_at:
            now.toISOString(),

          completed_at:
            now.toISOString(),

          details: {
            reason:
              "INVALID_REFERENCE_OR_SIGNAL_TIME",
          },

          updated_at:
            now.toISOString(),
        })
        .eq(
          "id",
          track.id,
        );

      invalid += 1;
      continue;
    }

    if (
      signalTime.getTime() >
      now.getTime()
    ) {
      unchanged += 1;
      continue;
    }

    const {
      marketClose,
      expirationTime,
    } =
      getKoreaTradingWindow(
        track.signal_observed_at,
      );

    /*
     * 장 마감 10분 이후에 생성된 신호는
     * 정상적인 장중 그림자 평가 대상으로
     * 보기 어렵다.
     */
    /*
 * 장 마감까지 최소 30분이 남지 않은 신호는
 * 정상적인 사후 가격 평가가 불가능하다.
 */
const minimumForwardWindowMs =
  30 *
  60 *
  1000;

if (
  signalTime.getTime() >
  marketClose.getTime() -
    minimumForwardWindowMs
) {
  await supabase
    .from(
      "shadow_signal_tracks",
    )
    .update({
      price_30m: null,
      observed_30m_at: null,
      return_30m: null,

      price_60m: null,
      observed_60m_at: null,
      return_60m: null,

      close_price: null,
      close_observed_at: null,
      close_return: null,

      max_price: null,
      max_return: null,
      min_price: null,
      min_return: null,

      evaluation_status:
        "INVALID",

      decision_label:
        "UNKNOWN",

      last_evaluated_at:
        now.toISOString(),

      completed_at:
        now.toISOString(),

      details: {
        reason:
          "SIGNAL_TOO_CLOSE_TO_MARKET_CLOSE",

        minimumForwardMinutes:
          30,
      },

      updated_at:
        now.toISOString(),
    })
    .eq(
      "id",
      track.id,
    );

  invalid += 1;
  continue;
}

    const queryEndTime =
      new Date(
        Math.min(
          now.getTime(),
          marketClose.getTime(),
        ),
      );

    const {
      data: snapshotData,
      error: snapshotError,
    } = await supabase
      .from(
        "market_snapshots",
      )
      .select(`
        id,
        observed_at,
        open_price,
        high_price,
        low_price,
        close_price,
        raw_payload
      `)
      .eq(
        "stock_code",
        track.stock_code,
      )
      .gte(
        "observed_at",
        track.signal_observed_at,
      )
      .lte(
        "observed_at",
        queryEndTime.toISOString(),
      )
      .order(
        "observed_at",
        {
          ascending: true,
        },
      );

    if (snapshotError) {
      throw new Error(
        `${track.stock_code} 시세 조회 실패: ${snapshotError.message}`,
      );
    }

    const rawSnapshots =
      (
        snapshotData ?? []
      ) as MarketSnapshotRecord[];

    const snapshots =
      rawSnapshots.filter(
        (snapshot) => {
          const observedTime =
            new Date(
              snapshot.observed_at,
            ).getTime();

          return (
            Number.isFinite(
              observedTime,
            ) &&
            observedTime <=
              now.getTime() &&
            !isTestSnapshot(
              snapshot,
            ) &&
            (
              getSnapshotPrice(
                snapshot,
              ) ??
              0
            ) > 0
          );
        },
      );

    const excludedSnapshotCount =
      rawSnapshots.length -
      snapshots.length;

    if (
      snapshots.length === 0
    ) {
      if (
        now.getTime() >
        expirationTime.getTime()
      ) {
        await supabase
          .from(
            "shadow_signal_tracks",
          )
          .update({
            evaluation_status:
              "EXPIRED",

            decision_label:
              "UNKNOWN",

            last_evaluated_at:
              now.toISOString(),

            completed_at:
              now.toISOString(),

            details: {
              reason:
                "NO_VALID_MARKET_SNAPSHOT",

              excludedSnapshotCount,
            },

            updated_at:
              now.toISOString(),
          })
          .eq(
            "id",
            track.id,
          );

        expired += 1;
      } else {
        unchanged += 1;
      }

      continue;
    }

    const target30m =
      signalTime.getTime() +
      30 *
        60 *
        1000;

    const target60m =
      signalTime.getTime() +
      60 *
        60 *
        1000;

    const canEvaluate30m =
      target30m <=
      marketClose.getTime();

    const canEvaluate60m =
      target60m <=
      marketClose.getTime();

    const snapshot30m =
      canEvaluate30m
        ? findFirstSnapshotAtOrAfter(
            snapshots,
            target30m,
          )
        : null;

    const snapshot60m =
      canEvaluate60m
        ? findFirstSnapshotAtOrAfter(
            snapshots,
            target60m,
          )
        : null;

    const closeSnapshot =
      now.getTime() >=
      marketClose.getTime()
        ? (
            snapshots.at(-1) ??
            null
          )
        : null;

    const price30m =
      getSnapshotPrice(
        snapshot30m,
      ) ??
      toNumber(
        track.price_30m,
      );

    const price60m =
      getSnapshotPrice(
        snapshot60m,
      ) ??
      toNumber(
        track.price_60m,
      );

    const closePrice =
      getSnapshotPrice(
        closeSnapshot,
      ) ??
      toNumber(
        track.close_price,
      );

    const highPrices =
      snapshots
        .map(
          (snapshot) =>
            toNumber(
              snapshot.high_price,
            ) ??
            getSnapshotPrice(
              snapshot,
            ),
        )
        .filter(
          (
            value,
          ): value is number =>
            value !== null &&
            value > 0,
        );

    const lowPrices =
      snapshots
        .map(
          (snapshot) =>
            toNumber(
              snapshot.low_price,
            ) ??
            getSnapshotPrice(
              snapshot,
            ),
        )
        .filter(
          (
            value,
          ): value is number =>
            value !== null &&
            value > 0,
        );

    const maxPrice =
      highPrices.length > 0
        ? Math.max(
            ...highPrices,
          )
        : null;

    const minPrice =
      lowPrices.length > 0
        ? Math.min(
            ...lowPrices,
          )
        : null;

    const return30m =
      price30m !== null
        ? calculateReturn(
            price30m,
            referencePrice,
          )
        : null;

    const return60m =
      price60m !== null
        ? calculateReturn(
            price60m,
            referencePrice,
          )
        : null;

    const closeReturn =
      closePrice !== null
        ? calculateReturn(
            closePrice,
            referencePrice,
          )
        : null;

    const maxReturn =
      maxPrice !== null
        ? calculateReturn(
            maxPrice,
            referencePrice,
          )
        : null;

    const minReturn =
      minPrice !== null
        ? calculateReturn(
            minPrice,
            referencePrice,
          )
        : null;

    let evaluationStatus:
      | "PARTIAL"
      | "COMPLETE"
      | "EXPIRED";

    if (
      now.getTime() >=
        marketClose.getTime() &&
      closePrice !== null
    ) {
      evaluationStatus =
        "COMPLETE";
    } else if (
      now.getTime() >
      expirationTime.getTime()
    ) {
      evaluationStatus =
        "EXPIRED";
    } else {
      evaluationStatus =
        "PARTIAL";
    }

    const decisionLabel =
      getDecisionLabel(
        track.signal_status,
        evaluationStatus,
        closeReturn,
        maxReturn,
        minReturn,
      );

    const lastSnapshot =
      snapshots.at(-1) ??
      null;

    const {
      error: updateError,
    } = await supabase
      .from(
        "shadow_signal_tracks",
      )
      .update({
        price_30m:
          price30m,

        observed_30m_at:
          snapshot30m
            ?.observed_at ??
          track.observed_30m_at,

        return_30m:
          return30m,

        price_60m:
          price60m,

        observed_60m_at:
          snapshot60m
            ?.observed_at ??
          track.observed_60m_at,

        return_60m:
          return60m,

        close_price:
          closePrice,

        close_observed_at:
          closeSnapshot
            ?.observed_at ??
          track.close_observed_at,

        close_return:
          closeReturn,

        max_price:
          maxPrice,

        max_return:
          maxReturn,

        min_price:
          minPrice,

        min_return:
          minReturn,

        evaluation_status:
          evaluationStatus,

        decision_label:
          decisionLabel,

        last_snapshot_at:
          lastSnapshot
            ?.observed_at ??
          null,

        last_evaluated_at:
          now.toISOString(),

        completed_at:
          evaluationStatus ===
            "COMPLETE" ||
          evaluationStatus ===
            "EXPIRED"
            ? now.toISOString()
            : null,

        details: {
          snapshotCount:
            snapshots.length,

          excludedSnapshotCount,

          canEvaluate30m,
          canEvaluate60m,

          used30mSnapshot:
            Boolean(
              snapshot30m,
            ),

          used60mSnapshot:
            Boolean(
              snapshot60m,
            ),

          usedCloseSnapshot:
            Boolean(
              closeSnapshot,
            ),

          labelThresholds: {
            meaningfulCloseRise:
              0.01,

            meaningfulMaximumRise:
              0.02,

            meaningfulMinimumFall:
              -0.015,
          },
        },

        updated_at:
          now.toISOString(),
      })
      .eq(
        "id",
        track.id,
      );

    if (updateError) {
      throw new Error(
        `${track.stock_code} 그림자 평가 저장 실패: ${updateError.message}`,
      );
    }

    if (
      evaluationStatus ===
      "COMPLETE"
    ) {
      completed += 1;
    } else if (
      evaluationStatus ===
      "EXPIRED"
    ) {
      expired += 1;
    } else {
      partial += 1;
    }
  }

  return {
    analyzed:
      tracks.length,

    completed,
    partial,
    expired,
    invalid,
    unchanged,
  };
}