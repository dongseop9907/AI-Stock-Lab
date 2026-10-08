import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const ROOT =
  process.cwd();

const SOURCE =
  path.join(
    ROOT,
    "logs",
    "alpha-v3-forward-top1-sessions.json",
  );

const HISTORY =
  path.join(
    ROOT,
    "logs",
    "alpha-v3-forward-entry-compatible-history.json",
  );

const BOUNDARY =
  path.join(
    ROOT,
    "logs",
    "alpha-v3-forward-entry-compatible-boundary.json",
  );

const STATE =
  path.join(
    ROOT,
    "logs",
    "alpha-v3-forward-entry-prep-state.json",
  );

async function main() {
  if (
    !fs.existsSync(
      SOURCE,
    )
  ) {
    const result = {
      status:
        "ALPHA_V3_FORWARD_ENTRY_PREP_WAITING",

      readyForBatcher:
        false,

      reason:
        "FORWARD_TOP1_STATE_NOT_FOUND",

      eligibleSessions:
        0,
    };

    fs.writeFileSync(
      STATE,
      JSON.stringify(
        result,
        null,
        2,
      ) + "\n",
      "utf8",
    );

    console.log(
      JSON.stringify(
        result,
        null,
        2,
      ),
    );

    return;
  }

  const source =
    JSON.parse(
      fs.readFileSync(
        SOURCE,
        "utf8",
      ),
    );

  const strict =
    (
      source.sessions ??
      []
    )
      .filter(
        (row: any) =>
          row.integrity ===
            "STRICT_TRUE_OOS" &&
          row.targetSessionDate &&
          String(
            row.targetSessionDate,
          ) >
            "2026-10-07",
      )
      .sort(
        (
          a: any,
          b: any,
        ) =>
          `${a.targetSessionDate}|${a.top1?.stockCode ?? ""}`
            .localeCompare(
              `${b.targetSessionDate}|${b.top1?.stockCode ?? ""}`,
            ),
      );

  if (
    !strict.length
  ) {
    const result = {
      status:
        "ALPHA_V3_FORWARD_ENTRY_PREP_WAITING",

      readyForBatcher:
        false,

      reason:
        "NO_STRICT_BOUND_TARGET_SESSION_YET",

      eligibleSessions:
        0,
    };

    fs.mkdirSync(
      path.dirname(
        STATE,
      ),
      {
        recursive:
          true,
      },
    );

    fs.writeFileSync(
      STATE,
      JSON.stringify(
        result,
        null,
        2,
      ) + "\n",
      "utf8",
    );

    console.log(
      JSON.stringify(
        result,
        null,
        2,
      ),
    );

    return;
  }

  const supabase =
    createSupabaseServerClient();

  const targetDates =
    [
      ...new Set(
        strict.map(
          (row: any) =>
            String(
              row.targetSessionDate,
            ),
        ),
      ),
    ];

  const stockCodes =
    [
      ...new Set(
        strict.map(
          (row: any) =>
            String(
              row.top1.stockCode,
            ),
        ),
      ),
    ];

  const {
    data:
      availableBars,
    error:
      barError,
  } =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(
        "stock_code,trading_date,adjusted_price",
      )
      .in(
        "stock_code",
        stockCodes,
      )
      .in(
        "trading_date",
        targetDates,
      )
      .eq(
        "adjusted_price",
        true,
      )
      .limit(
        10000,
      );

  if (
    barError
  ) {
    throw barError;
  }

  const available =
    new Set(
      (
        availableBars ??
        []
      ).map(
        (row: any) =>
          `${String(row.trading_date)}|${String(row.stock_code)}`,
      ),
    );

  const readySessions =
    strict.filter(
      (row: any) =>
        available.has(
          `${String(row.targetSessionDate)}|${String(row.top1.stockCode)}`,
        ),
    );

  if (
    !readySessions.length
  ) {
    const result = {
      status:
        "ALPHA_V3_FORWARD_ENTRY_PREP_WAITING",

      readyForBatcher:
        false,

      reason:
        "TARGET_SESSION_DAILY_BAR_NOT_MATURE_YET",

      eligibleSessions:
        strict.length,

      matureTargetSessions:
        0,
    };

    fs.writeFileSync(
      STATE,
      JSON.stringify(
        result,
        null,
        2,
      ) + "\n",
      "utf8",
    );

    console.log(
      JSON.stringify(
        result,
        null,
        2,
      ),
    );

    return;
  }

  const start =
    String(
      readySessions[0]
        .targetSessionDate,
    );

  const end =
    String(
      readySessions.at(
        -1,
      )
        .targetSessionDate,
    );

  const history = {
    status:
      "ALPHA_V3_TRUE_FORWARD_TOP1_COMPATIBLE_HISTORY_READY",

    version:
      "ALPHA_V3_TRUE_FORWARD_TOP1_COMPATIBLE_HISTORY_V1",

    contract:
      source.contract,

    top1Rows:
      readySessions,
  };

  const boundary = {
    status:
      "ALPHA_V3_KIS_INTRADAY_RETENTION_BOUNDARY_COMPLETE",

    version:
      "ALPHA_V3_TRUE_FORWARD_COMPATIBLE_BOUNDARY_V1",

    boundary: {
      monotonicBoundaryValid:
        true,

      source:
        "TRUE_FORWARD_STRICT_OOS_TARGETS",
    },

    usableRange: {
      start,
      end,
      top1SessionCount:
        readySessions.length,
    },
  };

  const result = {
    status:
      "ALPHA_V3_FORWARD_ENTRY_PREP_READY",

    readyForBatcher:
      true,

    eligibleSessions:
      strict.length,

    matureTargetSessions:
      readySessions.length,

    start,
    end,

    historyFile:
      "logs/alpha-v3-forward-entry-compatible-history.json",

    boundaryFile:
      "logs/alpha-v3-forward-entry-compatible-boundary.json",
  };

  fs.writeFileSync(
    HISTORY,
    JSON.stringify(
      history,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  fs.writeFileSync(
    BOUNDARY,
    JSON.stringify(
      boundary,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  fs.writeFileSync(
    STATE,
    JSON.stringify(
      result,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_FORWARD_ENTRY_PREP_FAILED",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          databaseWrites:
            0,

          ordersCreated:
            0,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
