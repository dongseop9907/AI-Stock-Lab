import fs from "node:fs";
import path from "node:path";
import { createSupabaseServerClient } from "../lib/supabase";

function kstDateTime(iso: string) {
  const d = new Date(
    new Date(iso).getTime() + 9 * 60 * 60 * 1000,
  );
  return d.toISOString().replace("T", " ").replace("Z", " KST");
}

function kstDate(iso: string) {
  return kstDateTime(iso).slice(0, 10);
}

function priceVolumeScore(row: any): number | null {
  const dim = (row.dimensions ?? []).find(
    (item: any) => item.dimension === "priceVolume",
  );

  const effective = Number(dim?.effectiveScore);
  const quality = Number(row.quality);

  if (!Number.isFinite(effective) || !Number.isFinite(quality)) {
    return null;
  }

  return 0.5 + (effective - 0.5) * quality;
}

async function main() {
  const root = process.cwd();

  const replay = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        "logs",
        "alpha-v1-alpha-only-historical-replay-read-only.json",
      ),
      "utf8",
    ),
  );

  const top1Rows = (replay.replay ?? [])
    .map((day: any) => {
      const ranked = (day.rawRanking ?? [])
        .map((row: any) => ({
          stockCode: String(row.stockCode),
          v2Score: priceVolumeScore(row),
        }))
        .filter((row: any) => Number.isFinite(row.v2Score))
        .sort((a: any, b: any) => b.v2Score - a.v2Score);

      return ranked[0]
        ? {
            date: String(day.date),
            decisionAt: String(day.decisionAt),
            stockCode: ranked[0].stockCode,
            v2Score: ranked[0].v2Score,
          }
        : null;
    })
    .filter(Boolean) as Array<{
      date: string;
      decisionAt: string;
      stockCode: string;
      v2Score: number;
    }>;

  const stockCodes = [
    ...new Set(top1Rows.map((row) => row.stockCode)),
  ];

  const minMs = Math.min(
    ...top1Rows.map((row) => new Date(row.decisionAt).getTime()),
  );

  const maxMs =
    Math.max(
      ...top1Rows.map((row) => new Date(row.decisionAt).getTime()),
    ) +
    3 * 24 * 60 * 60 * 1000;

  const { data, error } = await createSupabaseServerClient()
    .from("market_snapshots")
    .select(
      "stock_code,observed_at,open_price,high_price,low_price,close_price,volume",
    )
    .in("stock_code", stockCodes)
    .gte("observed_at", new Date(minMs - 24 * 60 * 60 * 1000).toISOString())
    .lte("observed_at", new Date(maxMs).toISOString())
    .order("observed_at", { ascending: true })
    .limit(100000);

  if (error) throw error;

  const snapshots = data ?? [];

  const rows = top1Rows.map((alpha) => {
    const decisionMs = new Date(alpha.decisionAt).getTime();

    const sameDay = snapshots.filter(
      (s: any) =>
        String(s.stock_code) === alpha.stockCode &&
        kstDate(String(s.observed_at)) === alpha.date,
    );

    const beforeDecision = sameDay.filter(
      (s: any) =>
        new Date(String(s.observed_at)).getTime() < decisionMs,
    );

    const atOrAfterDecision = sameDay.filter(
      (s: any) =>
        new Date(String(s.observed_at)).getTime() >= decisionMs,
    );

    const afterDecisionAnyDate = snapshots.filter(
      (s: any) =>
        String(s.stock_code) === alpha.stockCode &&
        new Date(String(s.observed_at)).getTime() >= decisionMs,
    );

    const nextSnapshot = afterDecisionAnyDate[0] ?? null;

    return {
      date: alpha.date,
      stockCode: alpha.stockCode,
      v2Score: alpha.v2Score,
      decisionAtUtc: alpha.decisionAt,
      decisionAtKst: kstDateTime(alpha.decisionAt),
      sameDaySnapshotCount: sameDay.length,
      firstSameDaySnapshotKst:
        sameDay[0]
          ? kstDateTime(String(sameDay[0].observed_at))
          : null,
      lastSameDaySnapshotKst:
        sameDay.at(-1)
          ? kstDateTime(String(sameDay.at(-1).observed_at))
          : null,
      beforeDecisionCount: beforeDecision.length,
      atOrAfterDecisionCount: atOrAfterDecision.length,
      firstPostDecisionSnapshotKst:
        nextSnapshot
          ? kstDateTime(String(nextSnapshot.observed_at))
          : null,
      firstPostDecisionSnapshotDateKst:
        nextSnapshot
          ? kstDate(String(nextSnapshot.observed_at))
          : null,
      relation:
        sameDay.length === 0
          ? "NO_SAME_DAY_SNAPSHOT"
          : atOrAfterDecision.length > 0
            ? "SAME_DAY_ENTRY_REPLAY_POSSIBLE"
            : nextSnapshot
              ? "NEXT_AVAILABLE_SNAPSHOT_AFTER_DECISION"
              : "NO_POST_DECISION_SNAPSHOT",
    };
  });

  const counts = {
    totalAlphaTop1Dates: rows.length,
    sameDaySnapshotDates: rows.filter(
      (r) => r.sameDaySnapshotCount > 0,
    ).length,
    sameDayPostDecisionDates: rows.filter(
      (r) => r.atOrAfterDecisionCount > 0,
    ).length,
    sameDayOnlyBeforeDecisionDates: rows.filter(
      (r) =>
        r.sameDaySnapshotCount > 0 &&
        r.atOrAfterDecisionCount === 0,
    ).length,
    noSameDaySnapshotDates: rows.filter(
      (r) => r.sameDaySnapshotCount === 0,
    ).length,
    anyPostDecisionSnapshotDates: rows.filter(
      (r) => r.firstPostDecisionSnapshotKst !== null,
    ).length,
  };

  const result = {
    status:
      "ALPHA_V2_SNAPSHOT_DECISION_TIME_ALIGNMENT_DIAG_COMPLETE",
    counts,
    rows,
    interpretationHints: {
      sameDayOnlyBeforeDecision:
        "Alpha decisionAt occurs after available same-day snapshots; same-day Entry replay would be lookahead-invalid.",
      nextAvailableSnapshot:
        "If Alpha is intentionally decided after market close, Entry replay should begin from the next real snapshot/trading session rather than same-day snapshots.",
      noThresholdChange:
        true,
    },
    safety: {
      databaseReadsOnly: true,
      databaseWrites: 0,
      ordersCreated: 0,
      positionsChanged: 0,
    },
    nextGate:
      counts.sameDayOnlyBeforeDecisionDates > 0
        ? "DECIDE_NEXT_SESSION_ENTRY_ALIGNMENT"
        : "SAME_DAY_ENTRY_ALIGNMENT_VALID",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-snapshot-decision-time-alignment-diag.json",
    ),
    JSON.stringify(result, null, 2) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status: result.status,
        counts: result.counts,
        rows: result.rows.filter(
          (r) =>
            r.sameDaySnapshotCount > 0 ||
            r.firstPostDecisionSnapshotKst !== null,
        ),
        nextGate: result.nextGate,
        outputFile:
          "logs/alpha-v2-snapshot-decision-time-alignment-diag.json",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V2_SNAPSHOT_DECISION_TIME_ALIGNMENT_DIAG_FAILED",
        error: String(
          error instanceof Error
            ? error.message
            : error,
        ),
        databaseWrites: 0,
        ordersCreated: 0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
});
