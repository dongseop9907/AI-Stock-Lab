import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const ROOT =
  process.cwd();

const CHECKPOINT =
  path.join(
    ROOT,
    "logs",
    "alpha-v3-true-forward-entry-v3-checkpoint.json",
  );

function finite(
  value: unknown,
): value is number {
  return (
    typeof value ===
      "number" &&
    Number.isFinite(
      value,
    )
  );
}

async function main() {
  if (
    !fs.existsSync(
      CHECKPOINT,
    )
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_FORWARD_ENTRY_MATURITY_WAITING",

          reason:
            "FORWARD_ENTRY_CHECKPOINT_NOT_FOUND",

          updatedLabels:
            0,
        },
        null,
        2,
      ),
    );

    return;
  }

  const checkpoint =
    JSON.parse(
      fs.readFileSync(
        CHECKPOINT,
        "utf8",
      ),
    );

  const rows =
    checkpoint.results ??
    [];

  if (
    !rows.length
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_FORWARD_ENTRY_MATURITY_WAITING",

          reason:
            "NO_FORWARD_ENTRY_RESULTS",

          updatedLabels:
            0,
        },
        null,
        2,
      ),
    );

    return;
  }

  const stockCodes =
    [
      ...new Set(
        rows.map(
          (row: any) =>
            String(
              row.stockCode,
            ),
        ),
      ),
    ];

  const firstDate =
    rows
      .map(
        (row: any) =>
          String(
            row.targetSessionDate,
          ),
      )
      .sort()[0];

  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(
        "stock_code,trading_date,close_price,adjusted_price",
      )
      .in(
        "stock_code",
        stockCodes,
      )
      .eq(
        "adjusted_price",
        true,
      )
      .gte(
        "trading_date",
        firstDate,
      )
      .lte(
        "trading_date",
        new Date()
          .toISOString()
          .slice(
            0,
            10,
          ),
      )
      .order(
        "stock_code",
      )
      .order(
        "trading_date",
      )
      .limit(
        10000,
      );

  if (
    error
  ) {
    throw error;
  }

  const barsByStock =
    new Map<
      string,
      Array<{
        date: string;
        close: number;
      }>
    >();

  for (
    const bar
    of data ??
      []
  ) {
    const close =
      Number(
        bar.close_price,
      );

    if (
      !Number.isFinite(
        close,
      ) ||
      close <=
        0
    ) {
      continue;
    }

    const code =
      String(
        bar.stock_code,
      );

    const arr =
      barsByStock.get(
        code,
      ) ??
      [];

    arr.push({
      date:
        String(
          bar.trading_date,
        ),
      close,
    });

    barsByStock.set(
      code,
      arr,
    );
  }

  let updatedLabels =
    0;

  const matured = {
    r1: 0,
    r3: 0,
    r5: 0,
  };

  const horizonIndex = {
    r1: 0,
    r3: 2,
    r5: 4,
  } as const;

  for (
    const row
    of rows
  ) {
    const bars =
      (
        barsByStock.get(
          String(
            row.stockCode,
          ),
        ) ??
        []
      ).filter(
        (bar) =>
          bar.date >=
          String(
            row.targetSessionDate,
          ),
      );

    const applyReturns = (
      target:
        Record<
          "r1" |
          "r3" |
          "r5",
          number | null
        >,
      entryPrice:
        number,
    ) => {
      for (
        const horizon
        of [
          "r1",
          "r3",
          "r5",
        ] as const
      ) {
        if (
          finite(
            target[
              horizon
            ],
          )
        ) {
          matured[
            horizon
          ] +=
            1;

          continue;
        }

        const bar =
          bars[
            horizonIndex[
              horizon
            ]
          ];

        if (
          !bar
        ) {
          continue;
        }

        target[
          horizon
        ] =
          bar.close /
            entryPrice -
          1;

        matured[
          horizon
        ] +=
          1;

        updatedLabels +=
          1;
      }
    };

    if (
      row.correctedEntry
        ?.qualified ===
        true &&
      finite(
        row.correctedEntry
          ?.entryPrice,
      ) &&
      row.correctedEntry
        .entryPrice >
        0
    ) {
      row.correctedEntry
        .directReturns ??= {
          r1: null,
          r3: null,
          r5: null,
        };

      applyReturns(
        row.correctedEntry
          .directReturns,

        row.correctedEntry
          .entryPrice,
      );
    }

    for (
      const policy
      of row.limitPolicies ??
        []
    ) {
      if (
        Number(
          policy.maxPremium,
        ) !==
          0.01 ||
        policy.filled !==
          true ||
        !finite(
          policy.fillPrice,
        ) ||
        policy.fillPrice <=
          0
      ) {
        continue;
      }

      policy.returns ??= {
        r1: null,
        r3: null,
        r5: null,
      };

      applyReturns(
        policy.returns,
        policy.fillPrice,
      );
    }

    row.forwardMaturity = {
      checkedAt:
        new Date()
          .toISOString(),

      availableTradingBars:
        bars.length,
    };
  }

  fs.writeFileSync(
    CHECKPOINT,
    JSON.stringify(
      checkpoint,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_FORWARD_ENTRY_MATURITY_UPDATE_COMPLETE",

        resultRows:
          rows.length,

        updatedLabels,

        matured,

        checkpointFile:
          "logs/alpha-v3-true-forward-entry-v3-checkpoint.json",
      },
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
            "ALPHA_V3_FORWARD_ENTRY_MATURITY_UPDATE_FAILED",

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
